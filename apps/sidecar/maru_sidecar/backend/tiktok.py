"""Adapter `tiktok.*` — wrap del `core.tiktok_client.TikTokWorker` (PyQt) sin Qt.

Estrategia para evitar cargar PyQt6 en el sidecar:
  - Importamos el cliente real solo si el usuario llama `tiktok.connect`.
  - Si PyQt está instalado en el entorno, usamos `TikTokWorker` y conectamos
    sus señales a `EventBus.publish('tiktok:event'|'tiktok:stats'|...)`.
  - Si NO está disponible (sidecar en modo lite), se devuelve error claro.

F4 puede sustituir esto por un wrapper directo a `TikTokLiveClient` sin Qt
para reducir la huella de RAM, pero F1 reusa el código probado del original.
"""

from __future__ import annotations

import threading
import time
from typing import Any

from ..event_bus import get_event_bus
from ..logger import get_logger

log = get_logger(__name__)


def _rank_prefix(info: dict[str, Any]) -> str:
    """Prefijo con TODOS los rangos detectados, en orden de prioridad:
      [streamer] · es el host
      [mod]      · moderador
      [superfan] · suscriptor del live
      [topgifter] · top en ranking de regalos
      [L3]       · nivel del fans club
      [G5]       · nivel de gifter (user_grade)
      [vip]      · verificado
      [follower] · te sigue
    """
    badges: list[str] = []
    if info.get("is_anchor"):
        badges.append("streamer")
    if info.get("is_moderator"):
        badges.append("mod")
    if info.get("is_super_fan"):
        badges.append("superfan")
    if info.get("is_top_gifter"):
        rank = info.get("top_gifter_rank")
        badges.append(f"top{rank}" if isinstance(rank, int) and rank > 0 else "topgifter")
    # member_level (FANS badge) → si tiene nivel, lo mostramos como L#
    # y con la palabra "member" si no es ya super_fan (super fan ya es
    # un nivel más alto que member, así no duplicamos el etiquetado).
    ml = info.get("member_level")
    if isinstance(ml, int) and ml > 0:
        if not info.get("is_super_fan"):
            badges.append(f"member L{ml}")
        else:
            badges.append(f"L{ml}")
    elif info.get("is_member"):
        # Por si llega is_member sin level (raro pero defensivo).
        badges.append("member")
    gl = info.get("gifter_level")
    if isinstance(gl, int) and gl > 0:
        badges.append(f"G{gl}")
    if info.get("is_verified"):
        badges.append("✓")
    if info.get("is_new_subscriber"):
        badges.append("new")
    if info.get("is_friends_badge") or info.get("is_mutual_follow"):
        badges.append("friend")
    if info.get("is_follower") and not info.get("is_super_fan"):
        badges.append("follower")
    if not badges:
        return ""
    return "".join(f"[{b}]" for b in badges) + " "


# Backoff schedule (segundos) — paridad con MARU original que reintenta
# después de drops de network. Evitamos hammering: 5, 10, 30, 60, luego
# se queda en 60.
_RECONNECT_BACKOFF = (5, 10, 30, 60)


class TikTokService:
    def __init__(
        self,
        donations: Any | None = None,
        logs: Any | None = None,
        emotes: Any | None = None,
    ) -> None:
        self._worker: Any = None
        self._username: str | None = None
        self._connected = False
        self._lock = threading.Lock()
        self._stats: dict[str, int] = {"viewers": 0, "likes": 0, "diamonds": 0, "followers": 0, "shares": 0}
        # Cache de rangos por user (lower) — alimentado por comment_enriched
        # y consumido al re-emitir gift/follow/like para que las reglas
        # filtren por rol incluso en eventos sin user_identity.
        self._user_ranks_cache: dict[str, dict[str, Any]] = {}
        # Reconnect machinery
        self._auto_reconnect = True
        self._reconnect_attempts = 0
        self._reconnect_thread: threading.Thread | None = None
        self._user_initiated_disconnect = False
        # Inyección para hooks que el worker dispara
        self._donations = donations
        self._logs = logs
        self._emotes = emotes
        self._spotify: Any = None
        # Último mensaje de error (para diagnóstico desde el botón
        # "TikTok API" del sidebar). Se refresca con cada error fatal del
        # worker (`_on_error` / `_on_log_message` con SignAPIError).
        self._last_error: str = ""
        # Throttle del log de joins (v1.0.48) — al iniciar el live llegan
        # decenas de joins por segundo. Mantenemos el evento (para reglas)
        # pero solo publicamos UN log entry cada 1.5s.
        self._last_join_log_ts: float = 0.0

    def attach_donations(self, donations: Any) -> None:
        self._donations = donations

    def attach_logs(self, logs: Any) -> None:
        self._logs = logs

    def attach_emotes(self, emotes: Any) -> None:
        self._emotes = emotes

    def attach_spotify(self, spotify: Any) -> None:
        """SpotifyService — `_cache_ranks` notifica cuando ve un comment
        con `is_super_fan=True/False` para sincronizar la lista de
        usuarios prioritarios !playfan."""
        self._spotify = spotify

    def _extract_avatar_url(self) -> str:
        """Lee la URL del avatar del streamer desde `client._room_info`.

        TikTokLive 6.6.5 popula `client._room_info["owner"]["avatar_thumb"]
        ["url_list"]` cuando se llama con `fetch_room_info=True` (lo que
        hacemos via patch en core_bridge). Probamos varias keys posibles
        de la API porque a veces TikTok renombra los campos."""
        worker = self._worker
        if worker is None:
            return ""
        client = getattr(worker, "_client", None) or getattr(worker, "client", None)
        if client is None:
            return ""
        room_info = getattr(client, "_room_info", None) or getattr(
            client, "room_info", None
        )
        if not isinstance(room_info, dict):
            return ""
        owner = room_info.get("owner") or {}
        if not isinstance(owner, dict):
            return ""
        # Probar avatar_thumb → avatar_medium → avatar_large.
        for key in ("avatar_thumb", "avatar_medium", "avatar_large"):
            holder = owner.get(key) or {}
            if isinstance(holder, dict):
                urls = holder.get("url_list") or holder.get("urls") or []
                if isinstance(urls, list) and urls:
                    return str(urls[0])
        return ""

    def status(self, _params: dict[str, Any]) -> dict[str, Any]:
        # Versión de TikTokLive instalada — debe ser un STRING como
        # "6.6.5", no el repr de un módulo. En TikTokLive 6.6+ el
        # atributo `__version__` es un SUBMÓDULO (TikTokLive/__version__.py)
        # con el string adentro como atributo `version`/`__version__`.
        # Por eso `getattr(TikTokLive, "__version__")` devolvía
        # `<module 'TikTokLive.__version__' from '...'>` literal en la UI.
        version = ""
        try:
            import importlib.metadata as _md
            version = str(_md.version("TikTokLive") or "")
        except Exception:
            try:
                import TikTokLive as _tl  # type: ignore
                v_attr = getattr(_tl, "__version__", None)
                # Si v_attr es un módulo, intentar extraer el string
                # interno (.version o .__version__ del submódulo).
                if hasattr(v_attr, "version"):
                    version = str(v_attr.version)
                elif hasattr(v_attr, "__version__"):
                    version = str(v_attr.__version__)
                elif isinstance(v_attr, str):
                    version = v_attr
                else:
                    version = ""
            except Exception:
                version = ""
        # Sanitizar: si el resultado contiene "<module" significa que
        # algo del flow dejó pasar el repr — descartarlo silenciosamente.
        if "<module" in version or len(version) > 32:
            version = ""
        # Reconectando + último error visible para el botón "TikTok API"
        # del sidebar (sin esto el alert solo decía "Conectado/
        # Desconectado" y el user no podía diagnosticar nada).
        sign_key_present = False
        try:
            from ..runtime import SECRETS_DIR
            key_file = SECRETS_DIR / "tiktok_sign.key"
            sign_key_present = key_file.is_file() and bool(
                key_file.read_text(encoding="utf-8").strip()
            )
        except Exception:
            pass
        return {
            "connected": self._connected,
            "username": self._username,
            "stats": dict(self._stats),
            "version": version,
            "reconnectAttempts": self._reconnect_attempts,
            "autoReconnect": self._auto_reconnect,
            "signKeyConfigured": sign_key_present,
            "lastError": getattr(self, "_last_error", "") or "",
        }

    def sign_key_get(self, _params: dict[str, Any]) -> dict[str, Any]:
        """Lee la API key de eulerstream del archivo de secretos. Devuelve
        sólo si está configurada (sin exponer su contenido en logs)."""
        from ..runtime import SECRETS_DIR
        key_file = SECRETS_DIR / "tiktok_sign.key"
        if not key_file.is_file():
            return {"hasKey": False, "key": ""}
        try:
            content = key_file.read_text(encoding="utf-8").strip()
        except Exception:
            return {"hasKey": False, "key": ""}
        # Devolver SOLO los últimos 6 chars enmascarados para confirmar
        # que algo está guardado, sin exponer la key entera.
        masked = ("*" * 8 + content[-6:]) if len(content) > 6 else "********"
        return {"hasKey": bool(content), "key": masked}

    def sign_key_set(self, params: dict[str, Any]) -> dict[str, Any]:
        """Guarda la API key de eulerstream a `secrets/tiktok_sign.key` y
        la aplica al runtime de TikTokLive sin reiniciar el sidecar."""
        from ..runtime import SECRETS_DIR
        key = str(params.get("key") or "").strip()
        SECRETS_DIR.mkdir(parents=True, exist_ok=True)
        key_file = SECRETS_DIR / "tiktok_sign.key"
        if not key:
            # Borrar la key configurada.
            try:
                if key_file.is_file():
                    key_file.unlink()
            except Exception:
                pass
            try:
                from TikTokLive.client.web.web_settings import WebDefaults  # type: ignore
                WebDefaults.tiktok_sign_api_key = None
            except ImportError:
                pass
            return {"ok": True, "cleared": True}
        try:
            key_file.write_text(key, encoding="utf-8")
            try:
                from TikTokLive.client.web.web_settings import WebDefaults  # type: ignore
                WebDefaults.tiktok_sign_api_key = key
            except ImportError:
                pass
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "message": str(exc)}

    def connect(self, params: dict[str, Any]) -> dict[str, Any]:
        username = params.get("username")
        if not isinstance(username, str) or not username.strip():
            return {"ok": False, "error": "username requerido"}
        with self._lock:
            self._user_initiated_disconnect = False
            if self._connected:
                return {"ok": True}
            try:
                from .. import core_bridge
                core_bridge.install()
                from core.tiktok_client import TikTokWorker  # type: ignore
            except Exception as exc:
                log.warning("tiktok: core no disponible: %s", exc)
                return {"ok": False, "error": f"core no disponible: {exc}"}

            try:
                self._worker = TikTokWorker(username.strip())
                self._wire_signals(self._worker)
                self._worker.start()
                self._username = username.strip()
                # connected=True real lo emite la señal; lo dejamos en False
                # hasta entonces. Publicamos status=connecting para que el
                # frontend muestre el spinner.
                get_event_bus().publish(
                    "tiktok:status",
                    {"connected": False, "connecting": True, "username": username.strip()},
                )
                if self._logs is not None:
                    try:
                        self._logs.publish(
                            f"🔌 Iniciando conexión a @{username.strip()}",
                            level="INFO",
                            source="tiktok",
                            category="tiktok",
                        )
                    except Exception:
                        pass
                return {"ok": True}
            except Exception as exc:
                log.exception("tiktok connect error")
                return {"ok": False, "error": str(exc)}

    def disconnect(self, _params: dict[str, Any]) -> dict[str, Any]:
        """Desconexión TOTAL e INMEDIATA del live.

        Garantías:
          1. Flag `_user_initiated_disconnect = True` ANTES de tocar el
             worker — evita reconexión automática.
          2. Setear `worker._running = False` directamente (sin esperar
             a `worker.stop()`) — corta inmediatamente todos los handlers
             que chequean `_running` (nativos del core + extras del bridge).
          3. **Desconectar TODAS las señales** del worker antes de
             detenerlo — silencia cualquier evento que estuviera en
             vuelo entre el thread del worker y este thread del backend.
          4. Forzar cierre asíncrono del client en SU PROPIO loop con
             `run_coroutine_threadsafe` (el `client.disconnect()` original
             del worker.stop creaba un loop NUEVO que no tenía relación
             con el del client → no cerraba realmente el WS).
          5. `worker.stop()` finaliza el thread con `quit()+wait()`.
          6. Limpiar refs y publicar status `connected: false`.
        """
        with self._lock:
            self._user_initiated_disconnect = True
            self._reconnect_attempts = 0
            worker = self._worker
            saved_username = self._username
            self._worker = None
            self._connected = False
            self._username = None

        # Log inmediato al panel del usuario — antes el disconnect manual
        # era silencioso (solo aparecía el `📺 Stream finalizado` del WS
        # un par de segundos después). Ahora hay confirmación al instante.
        if self._logs is not None:
            try:
                user_label = saved_username or "live"
                self._logs.publish(
                    f"🛑 Desconectado de @{user_label} (manual)",
                    level="INFO",
                    source="tiktok",
                    category="tiktok",
                )
            except Exception:
                log.exception("no pude publicar log de disconnect manual")

        if worker is not None:
            # (2) Marcar parado YA — los handlers checan esto y cortan.
            try:
                worker._running = False
                worker._should_reconnect = False
            except Exception:
                pass

            # (2.5) Liberar caches in-memory acumulados durante el live.
            # En sesiones largas estos diccionarios crecen hasta varios
            # MB (gift streaks de cientos de users, like_milestones,
            # ranks cache de cada chatter visto). Al desconectar ya no
            # los necesitamos — los limpiamos para que la app en reposo
            # quede liviana.
            try:
                if hasattr(worker, "_streaks"):
                    worker._streaks.clear()
                if hasattr(worker, "_like_milestones"):
                    worker._like_milestones.clear()
                if hasattr(worker, "_maru_comment_count"):
                    worker._maru_comment_count = 0
            except Exception:
                pass
            self._user_ranks_cache.clear()
            # Limpiar el set de users diagnosticados (DIAG @user) — vuelve
            # a emitir DIAG en el próximo connect si algo cambió.
            try:
                from .. import core_bridge
                if hasattr(core_bridge, "_DIAG_SEEN"):
                    core_bridge._DIAG_SEEN.clear()
            except Exception:
                pass

            # (3) Silenciar señales: desconectar todos los slots del
            # worker. Si una señal sigue emitiendo desde el thread
            # interno (ej. comment_enriched al procesar el último batch
            # del WS antes de cerrar), no llega a ningún slot del backend.
            for sig_name in (
                "connected", "disconnected", "event_received",
                "log_message", "error", "api_error", "stats_updated",
                "gift_image_detected", "emote_image_detected",
                "comment_enriched",
            ):
                sig = getattr(worker, sig_name, None)
                if sig is None:
                    continue
                try:
                    sig.disconnect()
                except (TypeError, RuntimeError):
                    # No hay slots conectados — OK.
                    pass
                except Exception:
                    log.exception("error al desconectar señal %s", sig_name)

            # (4) Forzar cierre del WebSocket del cliente en su loop.
            try:
                client = getattr(worker, "_client", None)
                if client is not None:
                    self._force_client_disconnect(client)
            except Exception:
                log.exception("force_client_disconnect fallo")

            # (5) Detener el thread del worker.
            try:
                worker.stop()
            except Exception as exc:
                log.warning("error al detener worker: %s", exc)

        # (6) Notificar al frontend que desconectamos definitivamente.
        get_event_bus().publish(
            "tiktok:status",
            {"connected": False, "willReconnect": False},
        )

        # (7) GC explícito — al desconectar liberamos cientos de KB de
        # objetos (worker, client, handlers, callbacks, ranks). Sin esto
        # Python espera al siguiente ciclo del GC generacional para
        # liberar y la RSS no baja en idle. Con `gc.collect()` la app
        # vuelve a su baseline mínima en ~10ms.
        try:
            import gc as _gc
            _gc.collect()
        except Exception:
            pass

        return {"ok": True}

    @staticmethod
    def _force_client_disconnect(client: Any) -> None:
        """Cierra el WebSocket del TikTokLiveClient sin importar en qué
        loop estaba corriendo. Estrategia robusta:
          - Si el client tiene un atributo de loop (`_loop`, `loop`),
            programa `client.disconnect()` en ese loop con
            `run_coroutine_threadsafe` y espera hasta 2s.
          - Si no, cae al fallback de `worker.stop()` (loop nuevo).
        """
        import asyncio as _asyncio
        loop = (
            getattr(client, "_loop", None)
            or getattr(client, "loop", None)
        )
        if loop is None or not getattr(loop, "is_running", lambda: False)():
            return  # worker.stop() se encarga
        try:
            fut = _asyncio.run_coroutine_threadsafe(client.disconnect(), loop)
            try:
                fut.result(timeout=2.0)
            except _asyncio.TimeoutError:
                log.warning("force_client_disconnect: timeout 2s — el WS puede tardar más en cerrar")
            except Exception:
                log.exception("client.disconnect fallo en su loop")
        except RuntimeError:
            # loop ya cerrado — OK.
            pass

    # ── Reconnect logic ───────────────────────────────────────────────────

    def _schedule_reconnect(self) -> None:
        """Lanza thread de reconexión con backoff. Idempotente."""
        with self._lock:
            if self._reconnect_thread and self._reconnect_thread.is_alive():
                return
            if self._user_initiated_disconnect or not self._auto_reconnect:
                return
            if not self._username:
                return
            target_user = self._username

        def _worker():
            while True:
                with self._lock:
                    if self._user_initiated_disconnect or self._connected:
                        log.info("auto-reconnect: cancelado (user_disc=%s connected=%s)",
                                 self._user_initiated_disconnect, self._connected)
                        return
                    attempt = self._reconnect_attempts
                    self._reconnect_attempts += 1

                delay = _RECONNECT_BACKOFF[
                    min(attempt, len(_RECONNECT_BACKOFF) - 1)
                ]
                log.info(
                    "tiktok: reintentando conexión en %ds (intento %d, user=%s)",
                    delay, attempt + 1, target_user,
                )
                get_event_bus().publish(
                    "tiktok:status",
                    {
                        "connected": False,
                        "reconnecting": True,
                        "nextRetryIn": delay,
                        "attempt": attempt + 1,
                    },
                )
                time.sleep(delay)

                with self._lock:
                    if self._user_initiated_disconnect or self._connected:
                        return

                # Intento de reconexión
                res = self.connect({"username": target_user})
                if res.get("ok"):
                    log.info("tiktok: reconexión iniciada — esperando confirmación de señal")
                    # Damos margen para que llegue la señal de connected.
                    # Si no llega, en el próximo _on_disconnected se vuelve a llamar.
                    time.sleep(8)
                    with self._lock:
                        if self._connected:
                            self._reconnect_attempts = 0
                            log.info("tiktok: reconexión exitosa")
                            return
                else:
                    log.warning("tiktok: intento %d falló: %s",
                                attempt + 1, res.get("error"))
                    # seguir loop con próximo backoff

        t = threading.Thread(
            target=_worker, name="tiktok-reconnect", daemon=True,
        )
        with self._lock:
            self._reconnect_thread = t
        t.start()

    # ── Wiring de señales PyQt → EventBus ────────────────────────────────────

    def _wire_signals(self, worker: Any) -> None:
        bus = get_event_bus()

        # CRÍTICO: el sidecar NO tiene QApplication corriendo, así que
        # forzamos Qt.DirectConnection en TODOS los `connect()`. Sin eso,
        # los slots Python NUNCA se invocan (queueada esperando un event
        # loop Qt que no existe) → no llegarían logs, eventos, ni la señal
        # de disconnected. DirectConnection invoca el slot inmediatamente
        # en el thread del worker, sin pasar por queue.
        try:
            from PyQt6.QtCore import Qt  # type: ignore
            _DIRECT = Qt.ConnectionType.DirectConnection
        except Exception:
            _DIRECT = None  # tipo: ignore[assignment]

        def _connect(signal: Any, handler: Any) -> None:
            # Idempotente: si re-wire del mismo worker (reconexión rápida,
            # race), desconectamos primero el handler antes de re-añadirlo.
            # Sin esto, un solo CommentEvent disparaba el TTS 2x si el worker
            # quedó con 2 slots conectados al mismo signal.
            try:
                signal.disconnect(handler)
            except (TypeError, RuntimeError):
                # No estaba conectado todavía — caso normal en primer wire.
                pass
            if _DIRECT is not None:
                signal.connect(handler, _DIRECT)
            else:
                signal.connect(handler)

        def _on_connected(name: str) -> None:
            self._connected = True
            self._username = name
            self._reconnect_attempts = 0
            self._user_initiated_disconnect = False
            # Extraer avatar URL del room_info para incluirlo en el
            # status — el header global y la card TikTok lo usan para
            # mostrar la foto real del streamer en vez del placeholder.
            avatar_url = self._extract_avatar_url() or ""
            bus.publish("tiktok:status", {
                "connected": True,
                "username": name,
                "avatarUrl": avatar_url,
            })
            # Auto-crear carpeta del streamer en emotes (paridad MARU
            # original — sigue cacheando el avatar a disco para galería
            # de emotes).
            if self._emotes is not None:
                try:
                    self._emotes.set_streamer_avatar({
                        "username": name,
                        "displayName": name,
                        "avatarUrl": avatar_url,
                    })
                except Exception:
                    log.exception("emote auto-create streamer fallo")

        def _on_disconnected() -> None:
            was_connected = self._connected
            self._connected = False
            # Si el worker decidió internamente NO reconectar (error fatal:
            # offline / rate limit / user not found / API change), respetarlo.
            worker_should_reconnect = bool(
                getattr(self._worker, "_should_reconnect", True)
            )
            will_reconnect = (
                was_connected
                and not self._user_initiated_disconnect
                and self._auto_reconnect
                and worker_should_reconnect
            )
            bus.publish(
                "tiktok:status",
                {
                    "connected": False,
                    "willReconnect": will_reconnect,
                },
            )
            if will_reconnect:
                log.warning("tiktok: conexión perdida, programando reintento")
                self._schedule_reconnect()
            else:
                # Limpiar worker para que el siguiente connect arranque fresh.
                if self._worker is not None and not worker_should_reconnect:
                    log.info("tiktok: error fatal del worker → no reintentar")
                    self._worker = None
                    self._username = None
                    self._reconnect_attempts = 0

        def _on_event(event_type: str, data: dict[str, Any]) -> None:
            # Mergear ranks recientes del user (cacheados desde el último
            # comment_enriched) en `data` para que las reglas puedan
            # filtrar por rol — paridad con la nueva feature
            # required_ranks/excluded_ranks de Rule.
            user = str(data.get("user") or "?")
            ranks = self._user_ranks_cache.get(user.lower())
            merged = dict(data)
            if ranks:
                for k, v in ranks.items():
                    merged.setdefault(k, v)
            payload = {
                "type": event_type,
                "user": user,
                "nickname": data.get("nickname"),
                "avatar": data.get("avatar"),
                "timestamp": data.get("timestamp"),
                "data": merged,
            }
            bus.publish("tiktok:event", payload)
            # Log INDIVIDUAL por cada gift recibido (1 entry por evento,
            # no resumen por streak). El worker emite N events para un
            # streak de N rosas → vemos N entries "@user envió: rose"
            # secuenciales en vez del summary "envió 3 rosas" que
            # confunde cuando se actualiza a "envió 5 rosas".
            # skip_dedupe=True porque message es idéntico entre los N
            # events del streak — sin esto, el dedupe colapsaría a 1.
            if event_type == "gift" and self._logs is not None:
                gift_name = (
                    data.get("gift_name")
                    or data.get("giftName")
                    or data.get("gift_id")
                    or "gift"
                )
                rank_pref = _rank_prefix(merged)
                try:
                    self._logs.publish(
                        f"🎁 {rank_pref}@{user} envió: {gift_name}",
                        level="INFO",
                        source="tiktok",
                        category="gift",
                        skip_dedupe=True,
                    )
                except Exception:
                    pass

            # Joins (v1.0.48) — un viewer entra al live. En lives grandes
            # llegan en avalancha al inicio; emitimos solo si pasaron >2s
            # desde el último join logueado para no inundar. La regla
            # `join` igual sigue disparando para todos los joins (eso lo
            # decide el RuleEngine, no el log).
            if event_type == "join" and self._logs is not None:
                import time as _t
                now = _t.time()
                if now - self._last_join_log_ts > 1.5:
                    self._last_join_log_ts = now
                    nick = str(data.get("nickname") or user)
                    # `merged` ya incluye los rangos cacheados desde
                    # comment-enriched. _rank_prefix maneja "" si no hay
                    # ningún flag activo. ANTES filtrábamos por
                    # `merged.get("rank")` — esa key NO existe nunca, por
                    # lo que el prefijo SIEMPRE salía vacío y las badges
                    # de mod/superfan/member nunca se mostraban en el log
                    # de joins/likes/gifts.
                    rank_pref = _rank_prefix(merged)
                    # Meta enriquecida para que el LogPanel pueda pintar
                    # el badge de rol con el mismo formato que comments.
                    meta_payload: dict[str, Any] = {
                        "user": user,
                        "nickname": nick,
                        "kind": "join",
                    }
                    for k in (
                        "is_super_fan", "is_moderator", "is_top_gifter",
                        "is_follower", "is_member", "is_anchor",
                        "is_verified", "is_new_subscriber",
                        "is_friends_badge", "member_level", "gifter_level",
                        "top_gifter_rank",
                    ):
                        if merged.get(k):
                            meta_payload[k] = merged[k]
                    try:
                        self._logs.publish(
                            f"👋 {rank_pref}@{user} entró al live",
                            level="INFO",
                            source="tiktok",
                            category="join",
                            skip_dedupe=True,
                            meta=meta_payload,
                        )
                    except Exception:
                        pass

            # Likes (v1.0.46) — emitimos UN log:entry POR EVENTO con su
            # count real (el worker ya batchea por TikTok WS, típicamente
            # 50-200 likes por evento). NO usamos batcher local — eso
            # fragmentaba un stream natural en N entries pequeños y el
            # front-end no podía re-agrupar si había otros usuarios en
            # medio. Ahora cada evento → 1 entry con meta.count = N. El
            # front-end agrupa todos los entries del mismo user que
            # estén dentro de la ventana de cohesión (60s) — INCLUSO si
            # hay entries intercalados de otros users.
            if event_type == "like" and self._logs is not None:
                try:
                    count = int(data.get("count") or 1)
                except (TypeError, ValueError):
                    count = 1
                if count > 0:
                    rank_pref = _rank_prefix(merged)
                    label = "like" if count == 1 else "likes"
                    try:
                        self._logs.publish(
                            f"❤️ {rank_pref}@{user} dio {count} {label}",
                            level="INFO",
                            source="tiktok",
                            category="like",
                            skip_dedupe=True,
                            meta={"user": user, "count": count},
                        )
                    except Exception:
                        pass

        def _on_stats(stats: dict[str, Any]) -> None:
            self._stats.update({k: int(v) for k, v in stats.items() if isinstance(v, (int, float))})
            bus.publish("tiktok:stats", dict(self._stats))

        def _on_error(message: str) -> None:
            bus.publish("tiktok:error", {"message": message})
            # Guardar el último error para que el botón "TikTok API" del
            # sidebar lo muestre en el modal de diagnóstico.
            self._last_error = str(message)[:200]
            # Loggear errores también al panel de logs para visibilidad
            # inmediata (paridad con `worker.log_message`).
            try:
                if self._logs is not None:
                    self._logs.publish(
                        str(message),
                        level="ERROR",
                        source="tiktok",
                        category="error",
                    )
            except Exception:
                pass

        def _on_log_message(message: str) -> None:
            """worker.log_message — detalle granular de conexión (reintentos,
            backoff, errores API). Vía LogsService → push event `log:entry`
            (única ruta para evitar duplicados en el panel).

            FILTROS:
            - `💬 @user: text` y `⌨️ !cmd de @user`: suprimidos para
              evitar duplicado con la versión enriquecida del
              `_on_comment_enriched` (que trae rangos).
            - `🎁 @user envió: rose xN` (streak summary): suprimidos
              también — el user pidió ver UN entry por cada gift
              recibido (no la suma del streak), así que generamos
              esos logs individualmente desde `_on_event(type=gift)`
              que sí dispara una vez por cada repeat. Sin esto, el
              user veía "envió 3 rosas" → segundos después "envió 5
              rosas" sumando, cuando lo que quería era 5 entries
              individuales "envió 1 rosa".

            Categoría: NO la forzamos a "tiktok". Pasamos category=None y
            dejamos que `LogsService.detect_category` clasifique por el
            emoji-prefix del mensaje.
            """
            if self._logs is None:
                return
            msg = str(message)
            # Suprimir comments / commands (versión enriched los maneja)
            # y gift summaries por streak (los emitimos individuales).
            if msg.startswith("💬 @") or msg.startswith("⌨️ !"):
                return
            if msg.startswith("🎁 @"):
                # Suprimimos el summary del worker (puede traer "x3" al final).
                # Los logs individuales por cada gift los emite _on_event.
                return
            # v1.0.45: suprimir likes individuales del worker. El batcher
            # en _on_event los emite agrupados como "@user dio N likes".
            # También suprimimos el log de "Likes iniciales" (calibración).
            if msg.startswith("❤️ @") or msg.startswith("❤️ Likes iniciales"):
                return
            # Suprimir mensajes de progreso de conexión muy verbosos
            # (reintentos numerados, backoff intervals) — quedan en stderr
            # del sidecar para diagnóstico técnico, no en el LogPanel del
            # streamer. Mantenemos errores fatales (SignAPIError, offline).
            low = msg.lower()
            if any(
                fragment in low
                for fragment in (
                    "intento ",
                    "reintentando en",
                    "backoff",
                    "retrying in",
                )
            ):
                return
            try:
                self._logs.publish(
                    msg,
                    level="INFO",
                    source="tiktok",
                    category=None,
                )
            except Exception:
                log.exception("no pude reenviar log_message")
            # Detectar SignAPIError → publicar mensaje claro al usuario.
            # Aunque ya marcamos `_should_reconnect=False` en el patch del
            # worker, conviene explicar QUÉ pasa porque el error genérico
            # confunde — no es bug nuestro, es rate limit del servicio
            # externo de firma de TikTokLive 6.6.5.
            low = msg.lower()
            if "sign_not_200" in low or "signapierror" in low:
                helper = (
                    "ℹ️ El servidor de firma de TikTok Live (eulerstream.com) está "
                    "rate-limiteando la conexión. Esperá ~1 minuto antes de "
                    "reconectar. Para más conexiones simultáneas se necesita una "
                    "API key de eulerstream (gratis hasta cierto límite)."
                )
                try:
                    self._logs.publish(
                        helper, level="WARNING", source="tiktok", category="error",
                    )
                except Exception:
                    pass

        def _on_gift_image(
            gift_id: str,
            gift_name: str,
            image_url: str,
            coins: int,
        ) -> None:
            """worker.gift_image_detected — auto-descarga PNG de gifts nuevos.
            Sin esto, las donaciones nuevas que aparezcan en el live no se
            agregan a la galería con su imagen oficial."""
            if self._donations is None:
                log.warning("gift_image_detected sin DonationsService inyectado")
                return
            try:
                self._donations.on_gift_image_detected(
                    gift_id, gift_name, image_url, int(coins or 0)
                )
            except Exception:
                log.exception("auto-descarga gift falló: %s", gift_name)

        def _on_emote_image(
            streamer: str,
            streamer_avatar_url: str,
            emote_id: str,
            image_url: str,
        ) -> None:
            """Signal de TikTokLive 6.6.5: `(streamer, streamer_avatar, emote_id, image_url)`.
            El EmotesService crea carpeta per-STREAMER (host del live):
              emotes/<streamer>/avatar.png + emotes/<streamer>/<emote_id>.png
            (NO per-spectator — corrige bug donde se capturaban fotos de todos)."""
            if self._emotes is None:
                return
            try:
                self._emotes.on_emote_detected(
                    streamer, streamer_avatar_url, emote_id, image_url,
                )
            except Exception:
                log.exception("emote auto-download fallo: %s", emote_id)

        def _cache_ranks(user: str, info: dict[str, Any]) -> None:
            """Guarda los flags del user para que el siguiente evento del
            mismo user (gift/follow/like) ya traiga los rangos en
            `data.<flag>` y las reglas puedan filtrar.

            Side effect: si el comment trae el flag `is_super_fan`
            EXPLÍCITO (no None), notifica a `SpotifyService` para que la
            lista de PlayFan se sincronice automáticamente con el rol
            real del live."""
            if not user or user == "?":
                return
            keep = {
                k: info.get(k)
                for k in (
                    "is_super_fan", "is_moderator", "is_member", "is_follower",
                    "is_anchor", "is_gift_giver", "is_mutual_follow",
                    "is_verified", "is_friend", "is_new_subscriber",
                    "is_friends_badge", "is_first_recharge", "is_live_pro",
                    "is_activity", "is_top_gifter", "member_level",
                    "gifter_level", "top_gifter_rank",
                )
                if k in info
            }
            self._user_ranks_cache[user.lower()] = keep
            # Sync con SpotifyService.priority_users si tiene el flag.
            if self._spotify is not None and "is_super_fan" in info:
                try:
                    display = (
                        info.get("nickname")
                        or info.get("display_name")
                        or user
                    )
                    self._spotify.notify_super_fan(
                        user, bool(info.get("is_super_fan")), str(display),
                    )
                except Exception:
                    log.exception("notify_super_fan fallo (user=%s)", user)

        def _on_comment_enriched(user: str, info: dict[str, Any]) -> None:
            """Comment con flags super_fan/moderator/top_gifter/etc.

            Hace 3 cosas:
              1. Publica `tiktok:comment-enriched` al bus (ChatDispatcher
                 puede dar prioridad por rango).
              2. Emite el log enriquecido con prefijo `[mod]`/`[superfan]`
                 (la versión raw del core fue suprimida en _on_log_message).
              3. Si trae `avatar_url`, lo pasa al EmotesService para crear
                 la carpeta del user con su foto.
            """
            info = info or {}
            _cache_ranks(user, info)
            # `kind=="join"` viene del handler enriquecido de JoinEvent en
            # core_bridge: solo nos interesa CACHEAR los ranks (para que
            # el log de join inmediato siguiente los pinte) — NO debemos
            # emitir un comment-enriched ni un log "💬 @user:" porque el
            # user no comentó.
            is_join_only = info.get("kind") == "join"
            try:
                bus.publish(
                    "tiktok:comment-enriched",
                    {"user": user, **info},
                )
            except Exception:
                pass
            if is_join_only:
                return
            # Log enriquecido al panel.
            try:
                if self._logs is not None:
                    text = str(info.get("text") or "").strip()
                    prefix = _rank_prefix(info)
                    emote_ids = info.get("emote_ids") or []
                    # Si el comment trae emotes inline (fans club members),
                    # mostrarlos al final del log: `💬 @user: hola 🎨 [id1, id2]`.
                    # Si el texto está vacío (solo emotes), mostrar solo
                    # los IDs — antes salía espacio en blanco.
                    emote_suffix = ""
                    if emote_ids:
                        ids_str = ", ".join(str(x) for x in emote_ids[:5])
                        emote_suffix = f" 🎨 [{ids_str}]"
                    is_command = bool(text and text[0] == "!" and len(text) > 1)
                    if is_command:
                        cmd = text[1:].split()[0].lower()
                        line = f"⌨️ {prefix}!{cmd} de @{user}"
                    elif not text and emote_ids:
                        # Comment SIN texto y CON emotes (típico de miembros).
                        line = f"💬 {prefix}@{user}: 🎨 emote(s): {', '.join(emote_ids[:5])}"
                    else:
                        line = f"💬 {prefix}@{user}: {text[:50]}{emote_suffix}"
                    # Categoría dinámica: comandos van al pill "Comandos",
                    # comentarios al pill "Comentarios". Antes era hardcoded
                    # "comment" → el pill de Comandos quedaba huérfano para
                    # los `!cmd` que llegaban del live.
                    self._logs.publish(
                        line,
                        level="INFO",
                        source="tiktok",
                        category="command" if is_command else "comment",
                    )
            except Exception:
                log.exception("comment enriched log fallo")
            # No descargamos avatares de espectadores (bug previo). El
            # avatar del STREAMER lo bajamos al conectar via room_info.

        # Las señales de TikTokWorker son PyQt. Usamos DirectConnection
        # para que los slots se invoquen sin necesidad de event loop Qt.
        _connect(worker.connected, _on_connected)
        _connect(worker.disconnected, _on_disconnected)
        _connect(worker.event_received, _on_event)
        _connect(worker.stats_updated, _on_stats)
        _connect(worker.error, _on_error)
        _connect(worker.api_error, _on_error)
        # Señales que estaban sin cablear y dejaban features muertas:
        if hasattr(worker, "log_message"):
            _connect(worker.log_message, _on_log_message)
        if hasattr(worker, "gift_image_detected"):
            _connect(worker.gift_image_detected, _on_gift_image)
        # Signals nuevas (Fase emotes — agregadas via core_bridge):
        if hasattr(worker, "emote_image_detected"):
            _connect(worker.emote_image_detected, _on_emote_image)
        if hasattr(worker, "comment_enriched"):
            _connect(worker.comment_enriched, _on_comment_enriched)
