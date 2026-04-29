"""Puente al `core/` del proyecto MARU original.

Estrategia:
  1. Añadir `LiveChaosEngine_Refactored/` al sys.path (configurable con
     `MARU_CORE_ROOT`). Default: ../../LiveChaosEngine/LiveChaosEngine_Refactored.
  2. Re-mapear las constantes de `core.paths` para que apunten a las rutas
     nuevas de `maru_sidecar.runtime` (DATA_DIR, LOGS_DIR, TTS_CACHE_DIR, etc.).
  3. Lazy import: el core no se carga hasta que algún adapter lo necesita
     → arranque rápido y bajo consumo de memoria si TikTok no está conectado.

Esto permite reutilizar los módulos originales **sin tocarlos** y sin
mezclar runtime data del original con la app nueva.
"""

from __future__ import annotations

import contextvars
import os
import sys
import threading
from pathlib import Path
from typing import Any

from .logger import get_logger
from .runtime import (
    BACKUPS_DIR,
    CACHE_DIR,
    DATA_DIR,
    LOGS_DIR,
    RUNTIME_DIR,
    SECRETS_DIR,
    SPOTIFY_SECRETS_DIR,
    TTS_CACHE_DIR,
    ensure_runtime_dirs,
)

log = get_logger(__name__)
_LOCK = threading.Lock()
_INSTALLED = False


def _resolve_core_root() -> Path:
    env = os.environ.get("MARU_CORE_ROOT")
    if env:
        p = Path(env).expanduser().resolve()
        if not p.exists():
            raise FileNotFoundError(f"MARU_CORE_ROOT not found: {p}")
        return p

    candidates: list[Path] = []

    # Empaquetado con PyInstaller: el spec copia `core/` al root del
    # bundle (sys._MEIPASS). Buscamos ahí PRIMERO porque en producción
    # esa es la única ruta válida; en dev no existe `_MEIPASS` y caemos
    # a las heurísticas de repo abajo.
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidates.append(Path(meipass))

    # Dev: ../../LiveChaosEngine/LiveChaosEngine_Refactored relativo al sidecar
    candidates.extend([
        Path(__file__).resolve().parents[3] / "LiveChaosEngine" / "LiveChaosEngine_Refactored",
        Path(__file__).resolve().parents[3].parent / "LiveChaosEngine" / "LiveChaosEngine_Refactored",
    ])

    for c in candidates:
        if (c / "core" / "__init__.py").exists():
            return c
    raise FileNotFoundError(
        "core/ original no encontrado. Define MARU_CORE_ROOT o ajusta la ruta. "
        f"Buscado en: {', '.join(str(c) for c in candidates)}"
    )


def install() -> None:
    """Instala el bridge: agrega al sys.path y parche `core.paths`. Idempotente."""
    global _INSTALLED
    with _LOCK:
        if _INSTALLED:
            return
        ensure_runtime_dirs()
        core_root = _resolve_core_root()
        log.info("core bridge: root=%s", core_root)
        if str(core_root) not in sys.path:
            sys.path.insert(0, str(core_root))
        # Blindaje CRÍTICO: el `core/logger.py:configure_logging()` borra
        # TODOS los handlers del root logger (`for h in root.handlers:
        # root.removeHandler(h)`) y agrega los suyos apuntando a
        # `livechaos.log`. Eso secuestra los logs del sidecar. Hacemos un
        # snapshot ANTES de que nadie del core importe nada y lo
        # restauramos al final del install (idempotente).
        _root_logger = __import__("logging").getLogger()
        _saved_handlers = list(_root_logger.handlers)
        _saved_level = _root_logger.level
        _patch_core_paths()
        _patch_rule_engine_parse_entry()
        _patch_rule_role_conditions()
        _patch_games_logging()
        _patch_tiktok_worker_extras()
        _patch_sign_api_fatal()
        _apply_sign_api_key_from_env()
        # Restaurar los handlers del sidecar — algún módulo del core
        # llamó a `core.logger.configure_logging()` que los borró y
        # redirigió todo a `livechaos.log`. Reinstalamos los del sidecar
        # SIN remover los del core (sumamos en vez de reemplazar) para
        # que ambos archivos reciban los logs.
        _current = list(_root_logger.handlers)
        for h in _saved_handlers:
            if h not in _current:
                _root_logger.addHandler(h)
        if _root_logger.level == 0 or _root_logger.level > _saved_level:
            _root_logger.setLevel(_saved_level)
        log.info(
            "logger del sidecar restaurado tras install (handlers totales: %d)",
            len(_root_logger.handlers),
        )
        _INSTALLED = True


def _apply_sign_api_key_from_env() -> None:
    """Si el user define `TIKTOK_SIGN_API_KEY` en su entorno (o en un
    archivo `data/secrets/tiktok_sign.key`), la inyectamos en
    `WebDefaults.tiktok_sign_api_key` para que TikTokLive 6.6.5 use el
    plan paid de eulerstream (más conexiones simultáneas, sin rate limit
    agresivo del free tier que dispara SIGN_NOT_200)."""
    try:
        from TikTokLive.client.web.web_settings import WebDefaults  # type: ignore
    except ImportError:
        return
    key = os.environ.get("TIKTOK_SIGN_API_KEY", "").strip()
    if not key:
        # Fallback: archivo de secreto local.
        from .runtime import SECRETS_DIR
        key_file = SECRETS_DIR / "tiktok_sign.key"
        if key_file.is_file():
            try:
                key = key_file.read_text(encoding="utf-8").strip()
            except Exception:
                key = ""
    if key:
        WebDefaults.tiktok_sign_api_key = key
        log.info("TikTokLive sign API key cargada (fuente: env o archivo)")


def _patch_sign_api_fatal() -> None:
    """`SignAPIError` (TikTokLive 6.6.5 — falla del servicio externo
    `tiktok.eulerstream.com` que firma el WebSocket) NO debe reintentarse:
    cada intento gasta una conexión del rate limit gratuito (~1/min) y el
    loop de retry empeora el problema, no lo arregla.

    Antes el original solo detectaba "rate"/"limit" en el string del
    error — pero `SignAPIError.SIGN_NOT_200` puede ser rate limit, key
    inválida, o caída temporal del servicio. En todos los casos
    reintentar agresivamente es contraproducente.

    Patch: extender `_is_api_change_error` del worker para que también
    devuelva True ante SignAPIError → activa el branch que detiene
    reconnect y muestra mensaje claro al usuario."""
    try:
        import core.tiktok_client as tt  # type: ignore
    except ImportError:
        return

    Worker = tt.TikTokWorker
    if getattr(Worker, "_maru_sign_patched", False):
        return

    orig = Worker._is_api_change_error

    def patched_is_api_change_error(self, error):  # noqa: ANN001
        # Mantener detección original.
        if orig(self, error):
            return True
        err_str = str(error).lower()
        err_type = type(error).__name__.lower()
        # Indicadores específicos del Sign API externo.
        if "signapierror" in err_type or "sign_not_200" in err_str:
            return True
        if "eulerstream" in err_str or "sign api" in err_str:
            return True
        return False

    Worker._is_api_change_error = patched_is_api_change_error
    Worker._maru_sign_patched = True
    log.info("core.tiktok_client: SignAPIError detection added → para retries en rate limit")


# Contexto del evento actual durante `engine.process_event`. Se popula
# desde RuleDispatcher antes de llamar al engine y se lee dentro del
# `Rule.can_trigger` parchado para filtrar por rol/usuario.
_CURRENT_EVENT_INFO: contextvars.ContextVar[dict[str, Any]] = contextvars.ContextVar(
    "maru_current_event_info", default={}
)


def set_current_event_info(info: dict[str, Any]) -> contextvars.Token:
    """Empuja el dict de rangos+user del evento al contexto.
    Devuelve un token para `_CURRENT_EVENT_INFO.reset(token)` en el caller."""
    return _CURRENT_EVENT_INFO.set(info)


def reset_current_event_info(token: contextvars.Token) -> None:
    _CURRENT_EVENT_INFO.reset(token)


# Lista de "scopes" de rol soportados en `Rule.required_ranks` /
# `excluded_ranks`. El frontend usa esta misma lista para popular el
# selector. Cualquier valor fuera de esta lista se ignora.
RANK_KEYS: tuple[str, ...] = (
    "is_anchor", "is_moderator", "is_super_fan", "is_member",
    "is_top_gifter", "is_follower", "is_friend", "is_mutual_follow",
    "is_verified", "is_new_subscriber", "is_friends_badge",
    "is_first_recharge", "is_live_pro", "is_activity", "is_gift_giver",
)

# Etiquetas humano-legibles para describir rangos en el log del user.
RANK_LABELS: dict[str, str] = {
    "is_anchor": "🎙️ host",
    "is_moderator": "🛡️ mod",
    "is_super_fan": "⭐ superfan",
    "is_member": "🌸 miembro",
    "is_top_gifter": "🏆 top gifter",
    "is_follower": "➕ te sigue",
    "is_friend": "👥 amigo",
    "is_mutual_follow": "🤝 mutual",
    "is_verified": "✓ verificado",
    "is_new_subscriber": "🆕 nuevo sub",
    "is_friends_badge": "🫂 friends",
    "is_first_recharge": "💰 first recharge",
    "is_live_pro": "🎬 Live Pro",
    "is_activity": "🎯 activity",
    "is_gift_giver": "🎁 gifter",
}


def describe_user_ranks(info: dict[str, Any]) -> str:
    """Devuelve un texto humano-legible con los rangos activos del user.
    Ej: '🌸 miembro L2 · 🛡️ mod' para incluir en logs visuales del panel."""
    if not info:
        return ""
    parts: list[str] = []
    member_level = info.get("member_level")
    for k in RANK_KEYS:
        if not info.get(k):
            continue
        label = RANK_LABELS.get(k, k)
        if k == "is_member" and isinstance(member_level, int) and member_level > 0:
            parts.append(f"{label} L{member_level}")
        else:
            parts.append(label)
    return " · ".join(parts)


def _publish_role_filter(
    rule_name: str,
    user: str,
    kind: str,           # "required" | "excluded"
    flags: list[str],
    info: dict[str, Any],
) -> None:
    """Cuando una regla se descarta por filtro de rol, publica un push
    event al EventBus para que el log panel del frontend muestre el
    motivo. Sin esto el descarte era invisible — el user veía "@x mandó
    una rosa pero la regla no disparó" sin entender por qué."""
    try:
        from .event_bus import get_event_bus
    except ImportError:
        return
    try:
        labels = [RANK_LABELS.get(k, k).split(" ", 1)[-1] for k in flags]
        if kind == "required":
            reason = f"requiere {' o '.join(labels)}"
        else:
            reason = f"bloqueado por {' o '.join(labels)}"
        user_ranks = describe_user_ranks(info)
        suffix = f" — user: {user_ranks}" if user_ranks else " — user: sin rangos"
        msg = f"🚫 Regla '{rule_name}' descartada para @{user} ({reason}){suffix}"
        bus = get_event_bus()
        bus.publish(
            "log:entry",
            {
                "id": f"rf-{int(__import__('time').time() * 1000)}-{rule_name[:6]}",
                "ts": int(__import__('time').time() * 1000),
                "level": "INFO",
                "source": "rules",
                "category": "rule",
                "message": msg,
                "meta": {
                    "rule": rule_name,
                    "user": user,
                    "filterKind": kind,
                    "flags": flags,
                },
            },
        )
    except Exception:
        log.exception("publish_role_filter fallo")


def _patch_rule_role_conditions() -> None:
    """Extiende `Rule` con `required_ranks` / `excluded_ranks` (lista de
    flags como "is_super_fan", "is_moderator") y los chequea en
    `can_trigger`. Mantiene paridad con `allowed_users` (lista blanca por
    nombre) y agrega un nuevo eje (lista blanca/negra por rango).

    También extiende `to_dict`/`from_dict` para persistir los nuevos
    campos en `rules_<game>.json`."""
    try:
        import core.rule_engine as re_mod  # type: ignore
    except ImportError:
        log.warning("rule_engine no disponible — skip role conditions patch")
        return

    Rule = re_mod.Rule
    if getattr(Rule, "_maru_role_patched", False):
        return

    orig_to_dict = Rule.to_dict
    orig_from_dict = Rule.from_dict.__func__ if hasattr(Rule.from_dict, "__func__") else Rule.from_dict
    orig_can_trigger = Rule.can_trigger

    def patched_to_dict(self) -> dict[str, Any]:  # noqa: ANN001
        d = orig_to_dict(self)
        d["required_ranks"] = list(getattr(self, "required_ranks", []) or [])
        d["excluded_ranks"] = list(getattr(self, "excluded_ranks", []) or [])
        return d

    @classmethod
    def patched_from_dict(cls, d: dict[str, Any]):  # noqa: ANN001, ANN206
        rule = orig_from_dict(cls, d)
        rule.required_ranks = list(d.get("required_ranks") or [])
        rule.excluded_ranks = list(d.get("excluded_ranks") or [])
        return rule

    def patched_can_trigger(self, user: str = "") -> bool:  # noqa: ANN001
        # 1) Cooldown + allowed_users (lógica original).
        if not orig_can_trigger(self, user):
            return False
        # 2) Filtros nuevos por rol (leen contexto del evento actual).
        info = _CURRENT_EVENT_INFO.get() or {}
        required = list(getattr(self, "required_ranks", []) or [])
        excluded = list(getattr(self, "excluded_ranks", []) or [])
        rule_name = getattr(self, "name", None) or getattr(self, "id", "?")
        # required: el user debe tener AL MENOS UNO de los flags listados.
        if required:
            if not any(bool(info.get(k)) for k in required):
                _publish_role_filter(
                    rule_name, user or info.get("user", "?"),
                    "required", required, info,
                )
                return False
        # excluded: si el user tiene CUALQUIERA de estos flags, NO dispara.
        if excluded:
            blocking = [k for k in excluded if bool(info.get(k))]
            if blocking:
                _publish_role_filter(
                    rule_name, user or info.get("user", "?"),
                    "excluded", blocking, info,
                )
                return False
        return True

    Rule.to_dict = patched_to_dict
    Rule.from_dict = patched_from_dict
    Rule.can_trigger = patched_can_trigger
    Rule._maru_role_patched = True
    log.info("core.rule_engine.Rule extendido con required_ranks/excluded_ranks")


# Holder thread-local del worker actualmente ejecutando
# `_run_client_optimized`. Lo lee `TikTokLiveClient.__init__` (patched)
# para asociar el cliente recién creado con el worker correcto.
#
# Decisión: threading.local en vez de un list global. El __init__ del
# TikTokLiveClient se ejecuta sincronicamente DENTRO del mismo thread
# del Worker (Qt QThread) que ejecuta `_run_client_optimized`, asi que
# threading.local se ve correctamente y se aisla automaticamente de
# otros threads/workers que pudieran correr en paralelo.
#
# Antes era `_LATEST_WORKER: list[Any] = [None]` global del proceso —
# frágil ante reconexiones rápidas y sin garantía de aislamiento entre
# instancias del worker. La nueva variante es robusta y thread-safe.
_THREAD_WORKER = threading.local()


def _patch_tiktok_worker_extras() -> None:
    """Extiende `core.tiktok_client.TikTokWorker` con:
      1. Signal nueva `emote_image_detected(streamer, emote_id, image_url)`
         para suscribir `EmoteChatEvent` (TikTokLive 6.6.5+).
      2. Enriquecimiento del payload de `comment` con flags del usuario:
         `is_super_fan`, `is_moderator`, `is_top_gifter`, `member_level`,
         `gifter_level`, `is_friend`. El MARU original solo emitía
         `{text, user}` — sin info de membresía.

    Estrategia robusta (reescrita 2026-04-29):

    - **Subclase** `TikTokWorkerWithEmotes(Worker)` con dos pyqtSignal
      nuevas. Se reemplaza `core.tiktok_client.TikTokWorker` para que
      cualquier `from core.tiktok_client import TikTokWorker` posterior
      reciba la subclase.

    - **Override de `_run_client_optimized`** que envuelve al original:
      registra el worker en `_THREAD_WORKER.current` antes de llamar al
      original y lo limpia al salir (try/finally). Esto garantiza que el
      worker queda accesible durante toda la construcción del client +
      suscripción de handlers.

    - **Patch idempotente de `TikTokLiveClient.__init__`** que, justo
      tras construirse el cliente (línea `self._client = TikTokLiveClient(...)`
      del core), lee `_THREAD_WORKER.current` y suscribe nuestros
      handlers extras (EmoteChat / Comment enriquecido / RoomUserSeq /
      BizSticker). Si por algún motivo el worker no está disponible,
      loguea WARNING claro para diagnóstico.

    Estas son features NUEVAS sobre el original (no rompe paridad).
    Aprovechan datos que TikTokLive 6.6.5 ya expone gratis."""
    try:
        from PyQt6.QtCore import pyqtSignal  # type: ignore
        import core.tiktok_client as tt  # type: ignore
    except ImportError:
        log.warning("tiktok_client no disponible; saltando patch worker extras")
        return

    Worker = tt.TikTokWorker

    # Idempotencia: si ya extendimos Worker, salimos sin re-patchear.
    if hasattr(Worker, "emote_image_detected"):
        log.info("core.tiktok_client: extras ya instalados (idempotente)")
        return

    # 1) Subclase con signals extras. Las pyqtSignal solo pueden
    #    declararse en class body de Python.
    class TikTokWorkerWithEmotes(Worker):  # type: ignore[misc, valid-type]
        # (user, user_avatar_url, emote_id, image_url) — un emote por user.
        emote_image_detected = pyqtSignal(str, str, str, str)
        # (user, payload_dict) — comment enriquecido con flags de rango.
        comment_enriched = pyqtSignal(str, dict)

    # 2) Override de `_run_client_optimized` que registra al worker en
    #    threading.local ANTES de llamar al original — así el patch del
    #    `TikTokLiveClient.__init__` (abajo) lo encuentra al construirse
    #    el cliente.
    if hasattr(TikTokWorkerWithEmotes, "_run_client_optimized"):
        original_run_client = TikTokWorkerWithEmotes._run_client_optimized

        def run_client_with_emotes(self):  # noqa: ANN001
            _THREAD_WORKER.current = self
            try:
                return original_run_client(self)
            finally:
                # Limpiar el slot del thread — evita references colgantes
                # entre reconexiones (mismo thread, distinto worker).
                _THREAD_WORKER.current = None

        TikTokWorkerWithEmotes._run_client_optimized = run_client_with_emotes  # type: ignore[attr-defined]

    # 3) Reemplazar la clase exportada por el módulo del core. Cualquier
    #    `import` posterior de `TikTokWorker` recibe la subclase.
    tt.TikTokWorker = TikTokWorkerWithEmotes  # type: ignore[misc]

    # 4) Patch idempotente de `TikTokLiveClient.__init__`. Justo después
    #    de que el cliente se construya, leemos `_THREAD_WORKER.current`
    #    y suscribimos nuestros handlers extras. Si el worker no está
    #    disponible (no debería pasar — el override anterior lo setea),
    #    logueamos WARNING claro para diagnóstico en el sidecar.log.
    try:
        from TikTokLive import TikTokLiveClient  # type: ignore
    except ImportError:
        log.warning("TikTokLive no instalado — patch __init__ NO aplicado")
        log.info("core.tiktok_client: signals agregadas (sin patch __init__)")
        return

    if not getattr(TikTokLiveClient, "_maru_init_patched", False):
        _orig_client_init = TikTokLiveClient.__init__

        def _patched_init(self, *args, **kwargs):  # noqa: ANN001
            _orig_client_init(self, *args, **kwargs)
            worker = getattr(_THREAD_WORKER, "current", None)
            if worker is None:
                log.warning(
                    "TikTokLiveClient.__init__: _THREAD_WORKER.current es None "
                    "→ handlers extras NO se cablearán. Esto NO debería pasar; "
                    "indica que el __init__ se llamó fuera del scope del "
                    "_run_client_optimized override."
                )
                return
            try:
                _maybe_subscribe_emote_handlers(worker, client=self)
                log.info(
                    "TikTokLiveClient.__init__ patched: handlers extras "
                    "(EmoteChat/CommentEnriched/RoomUserSeq) attached "
                    "for worker=@%s",
                    getattr(worker, "username", "?"),
                )
            except Exception:
                log.exception("post-init subscribe handlers extras falló")

        TikTokLiveClient.__init__ = _patched_init  # type: ignore[method-assign]
        TikTokLiveClient._maru_init_patched = True  # type: ignore[attr-defined]
        log.info("TikTokLiveClient.__init__: patch idempotente instalado")

    log.info(
        "core.tiktok_client: subclase + signals "
        "(emote_image_detected, comment_enriched) instaladas"
    )


def _maybe_subscribe_emote_handlers(worker_self: Any, client: Any = None) -> None:
    """Suscribe handlers a EmoteChatEvent + CommentEvent enriquecido +
    RoomUserSeqEvent (viewers) en el cliente TikTokLive. También parchea
    `client.run` para pedir room_info y obtener avatar del streamer.

    `client` puede pasarse directamente (cuando `TikTokLiveClient.__init__`
    parchado nos llama justo tras construirse) o leerse de `worker_self`
    (camino legacy)."""
    try:
        from TikTokLive.events import (  # type: ignore
            EmoteChatEvent,
            CommentEvent,
            RoomUserSeqEvent,
        )
        # Eventos opcionales — pueden no existir en versiones más viejas.
        try:
            from TikTokLive.events import BizStickerEvent  # type: ignore
        except ImportError:
            BizStickerEvent = None  # type: ignore
    except ImportError:
        return

    if client is None:
        client = (
            getattr(worker_self, "_client", None)
            or getattr(worker_self, "client", None)
        )
    if client is None:
        return

    # Idempotencia: no resuscribir si ya cableamos este cliente.
    if getattr(client, "_maru_handlers_attached", False):
        return
    client._maru_handlers_attached = True  # type: ignore[attr-defined]
    log.info("core_bridge: handlers EmoteChat/Comment/RoomUserSeq registrados al client")

    # Parchar client.run para pedir room_info → habilita avatar streamer.
    # El `core/tiktok_client.py:478` llama `c.run()` sin kwargs; este
    # patch inyecta `fetch_room_info=True` sin tocar el core.
    if not getattr(client, "_maru_run_patched", False):
        original_run = client.run

        def run_with_room_info(*args, **kwargs):  # noqa: ANN001, ANN002, ANN003
            kwargs.setdefault("fetch_room_info", True)
            return original_run(*args, **kwargs)

        client.run = run_with_room_info  # type: ignore[method-assign]
        client._maru_run_patched = True  # type: ignore[attr-defined]

    # RoomUserSeqEvent → contador de viewers (hoy quedaba en 0).
    @client.on(RoomUserSeqEvent)
    async def _on_user_seq(e: Any) -> None:  # noqa: ANN401
        # Paridad con los handlers nativos del core: corta si el worker
        # ya no está corriendo (post-stop). Sin esto, el handler seguía
        # publicando viewers después del disconnect.
        if not getattr(worker_self, "_running", True):
            return
        try:
            total = int(getattr(e, "total_user", 0) or getattr(e, "total", 0) or 0)
            if total <= 0:
                return
            stats_sig = getattr(worker_self, "stats_updated", None)
            if stats_sig is not None:
                stats_sig.emit({"viewers": total})
        except Exception:
            log.exception("RoomUserSeq handler fallo")

    # BizStickerEvent — stickers comerciales que viewers/host envían al
    # live. Vienen en `event.biz_sticker: List[RoomSticker]` con `image`
    # y `name`. Los descargamos a la carpeta del streamer también.
    if BizStickerEvent is not None:
        @client.on(BizStickerEvent)
        async def _on_biz_sticker(e: Any) -> None:  # noqa: ANN401
            if not getattr(worker_self, "_running", True):
                return
            try:
                streamer = getattr(worker_self, "username", "") or "default"
                streamer_avatar = _streamer_avatar_url(worker_self)
                emit_sig = getattr(worker_self, "emote_image_detected", None)
                stickers = list(getattr(e, "biz_sticker", []) or [])
                for sk in stickers:
                    name = str(getattr(sk, "name", "") or "biz_sticker")
                    img = getattr(sk, "image", None) or getattr(sk, "nine_patch_image", None)
                    if img is None:
                        continue
                    urls = list(getattr(img, "m_urls", []) or [])
                    url = urls[0] if urls else (getattr(img, "m_uri", "") or "")
                    if url and emit_sig is not None:
                        emit_sig.emit(streamer, streamer_avatar, name, url)
                    log_sig = getattr(worker_self, "log_message", None)
                    if log_sig is not None:
                        log_sig.emit(f"🏷️ Sticker {name}")
            except Exception:
                log.exception("biz sticker handler fallo")

    @client.on(EmoteChatEvent)
    async def _on_emote_chat(e: Any) -> None:  # noqa: ANN401
        if not getattr(worker_self, "_running", True):
            return
        try:
            user_obj = getattr(e, "user", None)
            user = _resolve_username(user_obj)
            ranks = _extract_ranks(e, user_obj)
            # Carpeta per-STREAMER (host del live), no per-spectator.
            # `worker_self.username` es el handle al que estamos conectados.
            streamer = getattr(worker_self, "username", "") or "default"
            streamer_avatar = _streamer_avatar_url(worker_self)
            emotes = list(getattr(e, "emote_list", []) or [])
            for em in emotes:
                emote_id = str(getattr(em, "emote_id", "") or "")
                if not emote_id:
                    continue
                # Extraer URL: ImageModel.m_urls (lista, primero) o m_uri.
                img = getattr(em, "image", None)
                url = ""
                if img is not None:
                    urls = list(getattr(img, "m_urls", []) or [])
                    if urls:
                        url = urls[0]
                    else:
                        url = getattr(img, "m_uri", "") or ""
                if url:
                    # Signal: (streamer, streamer_avatar, emote_id, url).
                    sig = getattr(worker_self, "emote_image_detected", None)
                    if sig is not None:
                        sig.emit(streamer, streamer_avatar, emote_id, url)
                # Emit como evento normal (para reglas + log + frontend).
                ev_sig = getattr(worker_self, "event_received", None)
                if ev_sig is not None:
                    ev_sig.emit("emote", {
                        "user": user,
                        "emote_id": emote_id,
                        "image_url": url,
                        **ranks,
                    })
                # log_message: `usuario:emote_id` con prefijo de rangos
                # (paridad con la idea del user — si no se ven imágenes
                # en log, al menos el id del emote queda visible).
                log_sig = getattr(worker_self, "log_message", None)
                if log_sig is not None:
                    rank_prefix = _rank_prefix(ranks)
                    log_sig.emit(f"🎨 {rank_prefix}@{user}: {emote_id}")
        except Exception:
            log.exception("emote handler fallo")

    # Re-suscribir CommentEvent para enriquecer con flags Y emitir el
    # log con prefijo de rango. Antes este handler solo publicaba un push
    # event y el log seguía saliendo plano del core (`tiktok_client.py:445`).
    # Para evitar duplicados, marcamos los logs raw del core como
    # "supress" via `_maru_skip_raw_comment_log` y emitimos nosotros la
    # versión enriquecida con `[mod] @user: ...`.
    # Counter para confirmar que el handler está siendo invocado.
    worker_self.__dict__.setdefault("_maru_comment_count", 0)

    @client.on(CommentEvent)
    async def _on_comment_enriched(e: Any) -> None:  # noqa: ANN401
        if not getattr(worker_self, "_running", True):
            return
        try:
            worker_self._maru_comment_count = (
                getattr(worker_self, "_maru_comment_count", 0) + 1
            )
            user_obj = getattr(e, "user_info", None) or getattr(e, "user", None)
            user = _resolve_username(user_obj)
            text = str(getattr(e, "content", "") or getattr(e, "comment", "") or "").strip()
            ranks = _extract_ranks(e, user_obj)
            # Diagnóstico — emite UN log por user con todo el shape proto
            # relevante para debugging de detección member/super_fan.
            try:
                _diagnose_member_detection(user, user_obj, e, ranks)
            except Exception:
                pass
            avatar_url = _extract_user_avatar_url(user_obj)

            # ── Emotes inline (TikTokLive 6.6.5: `f315_emotes`) ─────────
            # Los miembros del fans club envían emotes embebidos en el
            # texto. Llegan en CommentEvent.f315_emotes (lista de
            # EmoteWithIndex con .emote_model). Hay que descargarlos
            # como cualquier sticker para que se reproduzca el sonido
            # asignado. Sin este branch, los emotes de miembros NUNCA se
            # detectaban — solo los stickers grandes (EmoteChatEvent).
            inline_emotes = list(getattr(e, "f315_emotes", []) or [])
            inline_ids: list[str] = []
            if inline_emotes:
                streamer = getattr(worker_self, "username", "") or "default"
                streamer_avatar = _streamer_avatar_url(worker_self)
                emit_sig = getattr(worker_self, "emote_image_detected", None)
                for it in inline_emotes:
                    em = getattr(it, "emote_model", None)
                    if em is None:
                        continue
                    eid = str(getattr(em, "emote_id", "") or "")
                    if not eid:
                        continue
                    img = getattr(em, "image", None)
                    url = ""
                    if img is not None:
                        urls = list(getattr(img, "m_urls", []) or [])
                        url = urls[0] if urls else (getattr(img, "m_uri", "") or "")
                    if url and emit_sig is not None:
                        emit_sig.emit(streamer, streamer_avatar, eid, url)
                    inline_ids.append(eid)

            payload = {
                "user": user,
                "text": text,
                "avatar_url": avatar_url,
                "emote_ids": inline_ids,
                **ranks,
            }
            sig = getattr(worker_self, "comment_enriched", None)
            if sig is not None:
                sig.emit(user, payload)
        except Exception:
            log.exception("comment_enriched handler fallo")


def _extract_ranks(event: Any, user_obj: Any) -> dict[str, Any]:
    """Extrae TODOS los rangos posibles de TikTokLive 6.6.5.

    Fuentes y cascada de fallbacks (importantes para detectar fans club):
      1. `event.user_identity` — flags relativas al ANCHOR del live.
      2. `event.f315_emotes` (CommentEvent only) — si tiene 1+ elementos,
         el sender ES miembro del fans club del anchor (señal 100% fiable
         porque solo miembros pueden enviarlos).
      3. `user.fans_club.prefer_data[<anchor_id>].level` — nivel exacto
         del fans club del anchor activo.
      4. `user.fans_club_info.fans_level` — fallback general del fans club.
      5. `user.badge_list` con `badge_scene == FANS` — level del
         `log_extra.level` (string) o del URL del `image_badge` con
         regex `fans_badge_icon_lv(\\d+)_v` (el oficial de TikTokLive).
      6. `user.is_*` flags directas (is_verified, is_following).

    Bug histórico arreglado: `_get_badge_level` oficial de TikTokLive
    descarta badges sin `log_extra.level` (filtro `if scene and badge_level`),
    lo que ocultaba TODOS los moderadores y miembros sin level explícito.
    """
    ui = getattr(event, "user_identity", None)
    is_super_fan = bool(getattr(ui, "is_subscriber_of_anchor", False)) if ui else False
    is_moderator = bool(getattr(ui, "is_moderator_of_anchor", False)) if ui else False
    is_follower = bool(getattr(ui, "is_follower_of_anchor", False)) if ui else False
    is_anchor = bool(getattr(ui, "is_anchor", False)) if ui else False
    is_gift_giver = bool(getattr(ui, "is_gift_giver_of_anchor", False)) if ui else False
    is_mutual = bool(getattr(ui, "is_mutual_following_with_anchor", False)) if ui else False

    # SubscribeInfo del User — fuente OFICIAL para super_fan del anchor
    # activo (más confiable que user_identity.is_subscriber_of_anchor).
    sub_info = getattr(user_obj, "subscribe_info", None) if user_obj else None
    if sub_info is not None:
        if bool(getattr(sub_info, "is_subscribed_to_current_anchor", False)):
            is_super_fan = True
        elif bool(getattr(sub_info, "is_subscribed", False)):
            is_super_fan = True

    badges = _parse_badges(user_obj)

    # Flags directas del User proto.
    is_verified = bool(getattr(user_obj, "is_verified", False)) if user_obj else False
    is_friend = bool(getattr(user_obj, "is_following", False)) if user_obj else False

    # Cascada de detección de miembro fans club:
    fans_level: int | None = None
    # (a) prefer_data[anchor_id] — la fuente más precisa.
    pd_level = _fans_club_prefer_data_level(user_obj)
    if pd_level is not None and pd_level > 0:
        fans_level = pd_level
    # (b) fans_club_info.fans_level
    if fans_level is None:
        fci_level = _fans_club_info_level(user_obj)
        if fci_level is not None and fci_level > 0:
            fans_level = fci_level
    # (c) badges (log_extra OR URL regex).
    if fans_level is None:
        bl = badges.get("fans_level")
        if isinstance(bl, int) and bl > 0:
            fans_level = bl
    # (d) f315_emotes presente → es miembro aunque no sepamos level.
    inline = list(getattr(event, "f315_emotes", []) or [])
    has_inline_emotes = len(inline) > 0
    is_member = bool(fans_level and fans_level > 0) or has_inline_emotes
    if is_member and not fans_level:
        fans_level = 1  # default mínimo

    return {
        # Identity flags
        "is_super_fan": is_super_fan or badges.get("subscriber", False),
        "is_moderator": is_moderator or badges.get("admin", False),
        "is_member": is_member,
        "is_follower": is_follower,
        "is_anchor": is_anchor or badges.get("anchor", False),
        "is_gift_giver": is_gift_giver,
        "is_mutual_follow": is_mutual,
        "is_verified": is_verified,
        "is_friend": is_friend,
        "is_new_subscriber": badges.get("new_subscriber", False),
        "is_friends_badge": badges.get("friends", False),
        "is_first_recharge": badges.get("first_recharge", False),
        "is_live_pro": badges.get("live_pro", False),
        "is_activity": badges.get("activity", False),
        "is_top_gifter": badges.get("rank_list", False),
        # Niveles
        "member_level": fans_level,
        "gifter_level": badges.get("user_grade_level"),
        "top_gifter_rank": badges.get("rank_list_level"),
    }


def _fans_club_prefer_data_level(user_obj: Any) -> int | None:
    """Lee `user.fans_club` y devuelve el nivel detectado:
      1. `fans_club.data.level` — datos del anchor activo (preferido).
      2. `fans_club.prefer_data` (Dict[str anchor_id → FansClubData]) —
         max level de cualquier club al que pertenezca."""
    if user_obj is None:
        return None
    fc = getattr(user_obj, "fans_club", None)
    if fc is None:
        return None
    # (1) data directa (anchor activo).
    data = getattr(fc, "data", None)
    if data is not None:
        lv = getattr(data, "level", 0)
        if isinstance(lv, int) and lv > 0:
            return lv
    # (2) prefer_data — dict por anchor_id.
    pd = getattr(fc, "prefer_data", None)
    if isinstance(pd, dict) and pd:
        best = 0
        for v in pd.values():
            lv = getattr(v, "level", 0)
            if isinstance(lv, int) and lv > best:
                best = lv
        if best > 0:
            return best
    return None


# Cache de users ya diagnosticados — evita inundar log con repeats.
_DIAG_SEEN: set[str] = set()


def _diagnose_member_detection(
    user: str, user_obj: Any, event: Any, ranks: dict[str, Any]
) -> None:
    """Loguea el shape PROTO real del primer comment de cada user para
    poder diagnosticar por qué la detección de miembro/super_fan falla
    en producción. Solo emite UN log por user para no inundar."""
    if user in _DIAG_SEEN:
        return
    if user_obj is None:
        return
    _DIAG_SEEN.add(user)
    # Recolectar pistas
    badges = getattr(user_obj, "badge_list", None) or []
    fc = getattr(user_obj, "fans_club", None)
    fci = getattr(user_obj, "fans_club_info", None)
    f315 = list(getattr(event, "f315_emotes", []) or [])
    # Resumen de cada badge
    badge_summary = []
    for b in badges:
        scene = getattr(b, "badge_scene", None)
        scene_name = (getattr(scene, "name", None) or str(scene or "?")).upper()
        log_extra = getattr(b, "log_extra", None)
        lv = getattr(log_extra, "level", None) if log_extra else None
        img = getattr(b, "image_badge", None)
        urls = []
        if img is not None:
            im = getattr(img, "image_model", None) or getattr(img, "image", None)
            if im is not None:
                urls = list(getattr(im, "m_urls", []) or [])[:1]
        badge_summary.append(f"{scene_name}(level={lv!r},urls={urls})")
    fc_summary = "None"
    if fc is not None:
        data = getattr(fc, "data", None)
        pd = getattr(fc, "prefer_data", None)
        fc_summary = (
            f"data.level={getattr(data, 'level', None)!r} "
            f"data.club={getattr(data, 'club_name', '')!r} "
            f"prefer_data_keys={list(pd.keys()) if isinstance(pd, dict) else 'N/A'}"
        )
    fci_summary = "None"
    if fci is not None:
        fci_summary = (
            f"fans_level={getattr(fci, 'fans_level', None)!r} "
            f"club_name={getattr(fci, 'fans_club_name', '')!r}"
        )
    sub = getattr(user_obj, "subscribe_info", None)
    sub_summary = "None"
    if sub is not None:
        sub_summary = (
            f"is_subscribed={getattr(sub, 'is_subscribed', None)} "
            f"to_current={getattr(sub, 'is_subscribed_to_current_anchor', None)}"
        )
    log.debug(
        "[DIAG @%s] detected{member=%s superfan=%s mod=%s level=%s} "
        "f315=%d badges=%s fans_club={%s} fci={%s} sub={%s}",
        user,
        ranks.get("is_member"), ranks.get("is_super_fan"),
        ranks.get("is_moderator"), ranks.get("member_level"),
        len(f315), "|".join(badge_summary) if badge_summary else "EMPTY",
        fc_summary, fci_summary, sub_summary,
    )


def _fans_club_info_level(user_obj: Any) -> int | None:
    """`user.fans_club_info.fans_level` (int64) — fallback al fans club
    "preferido" del user (puede no ser el del anchor activo, pero al
    menos confirma membresía)."""
    if user_obj is None:
        return None
    fci = getattr(user_obj, "fans_club_info", None)
    if fci is None:
        return None
    lv = getattr(fci, "fans_level", 0)
    if isinstance(lv, int) and lv > 0:
        return lv
    return None


def _parse_badges(user_obj: Any) -> dict[str, Any]:
    """Recorre `user.badge_list` y devuelve un dict con todos los badges
    detectados — paridad con `BadgeSceneType` enum del proto:
      ADMIN, FIRST_RECHARGE, FRIENDS, SUBSCRIBER, ACTIVITY, RANK_LIST,
      NEW_SUBSCRIBER, USER_GRADE, FANS, LIVE_PRO, ANCHOR.

    Bugs corregidos:
      - `PrivilegeLogExtra.level` es STRING en el proto (no int) — antes
        `isinstance(lv, int)` nunca matcheaba y `is_member` quedaba False.
      - `badge_scene` puede ser None o UNKNOWN; caemos al `text_badge.text`
        / `string_badge` para detectar el badge por contenido textual.
    """
    out: dict[str, Any] = {}
    if user_obj is None:
        return out
    badges = getattr(user_obj, "badge_list", None) or []
    for b in badges:
        try:
            scene = getattr(b, "badge_scene", None)
            scene_name = (getattr(scene, "name", None) or str(scene or "")).upper()
            # TikTokLive 6.6.5+ exporta los enums como
            # `BADGE_SCENE_TYPE_FANS`, `BADGE_SCENE_TYPE_ADMIN`, etc.
            # Versiones más viejas usaban `FANS`, `ADMIN`. Normalizamos
            # quitando el prefijo para matchear ambas convenciones.
            # Sin esto, TODOS los miembros con badge FANS quedaban
            # `member=False` porque el match `== "FANS"` nunca disparaba.
            if scene_name.startswith("BADGE_SCENE_TYPE_"):
                scene_name = scene_name[len("BADGE_SCENE_TYPE_"):]
            level = _parse_level(getattr(b, "log_extra", None))

            # Fallback: si scene_name no es útil, mirar el text_badge para
            # heurística por contenido (TikTok a veces no marca scene).
            if scene_name in ("", "UNKNOWN", "NONE"):
                hinted = _scene_from_text_badge(b)
                if hinted:
                    scene_name = hinted

            if scene_name == "ADMIN":
                out["admin"] = True
            elif scene_name == "SUBSCRIBER":
                out["subscriber"] = True
            elif scene_name == "NEW_SUBSCRIBER":
                out["new_subscriber"] = True
            elif scene_name == "FRIENDS":
                out["friends"] = True
            elif scene_name == "FIRST_RECHARGE":
                out["first_recharge"] = True
            elif scene_name == "ACTIVITY":
                out["activity"] = True
            elif scene_name == "LIVE_PRO":
                out["live_pro"] = True
            elif scene_name == "ANCHOR":
                out["anchor"] = True
            elif scene_name == "FANS":
                # Cascada para level: log_extra (string) → URL del image_badge
                # (regex `fans_badge_icon_lv(\d+)_v`) → default 1.
                if level is None:
                    level = _level_from_image_urls(b, _FANS_BADGE_LEVEL_RE)
                out["fans_level"] = level if level is not None else 1
            elif scene_name == "USER_GRADE":
                if level is None:
                    level = _level_from_image_urls(b, _USER_GRADE_LEVEL_RE)
                if level is not None:
                    out["user_grade_level"] = level
            elif scene_name == "RANK_LIST":
                out["rank_list"] = True
                if level is not None:
                    out["rank_list_level"] = level
        except Exception:
            continue

    # Plan B: detectar fans_club via fans_club / fans_club_info del User
    # (campos directos del proto, independientes del badge_list).
    if "fans_level" not in out:
        fc_level = _fans_club_level(user_obj)
        if fc_level is not None and fc_level > 0:
            out["fans_level"] = fc_level
    return out


def _parse_level(log_extra: Any) -> int | None:
    """`PrivilegeLogExtra.level` es STRING. Convertir a int si parsea."""
    if log_extra is None:
        return None
    lv = getattr(log_extra, "level", None)
    if isinstance(lv, int) and lv > 0:
        return lv
    if isinstance(lv, str):
        s = lv.strip()
        if s.isdigit():
            n = int(s)
            return n if n > 0 else None
    return None


# Regex oficial de TikTokLive (`proto_utils.py:84`) para extraer el nivel
# del URL de la imagen del badge cuando `log_extra.level` viene vacío.
import re as _re  # noqa: E402

_FANS_BADGE_LEVEL_RE = _re.compile(r"fans_badge_icon_lv(\d+)_v")
_USER_GRADE_LEVEL_RE = _re.compile(r"grade(\d+)|gifter_lv(\d+)")


def _level_from_image_urls(badge: Any, pattern: _re.Pattern) -> int | None:
    """Extrae el level del URL de `image_badge.image_model.m_urls`.
    Fallback usado cuando `log_extra.level` viene vacío — el nivel
    se codifica en el path del PNG del badge."""
    img_badge = getattr(badge, "image_badge", None)
    if img_badge is None:
        return None
    img_model = getattr(img_badge, "image_model", None) or getattr(img_badge, "image", None)
    if img_model is None:
        return None
    urls = list(getattr(img_model, "m_urls", []) or [])
    if not urls:
        uri = getattr(img_model, "m_uri", "")
        urls = [uri] if isinstance(uri, str) and uri else []
    for u in urls:
        if not isinstance(u, str):
            continue
        m = pattern.search(u)
        if m:
            for grp in m.groups():
                if grp and grp.isdigit():
                    n = int(grp)
                    if n > 0:
                        return n
    return None


def _scene_from_text_badge(badge: Any) -> str | None:
    """Heurística por texto del badge: si contiene palabras clave del fans
    club o subscriber, devolvemos el scene_name correspondiente."""
    text_badge = getattr(badge, "text_badge", None) or getattr(badge, "string_badge", None)
    if text_badge is None:
        return None
    txt = ""
    for attr in ("text", "default_pattern"):
        v = getattr(text_badge, attr, None)
        if isinstance(v, str) and v:
            txt = v.lower()
            break
        # text_badge puede tener pattern_ref con default_pattern
        pat_ref = getattr(text_badge, "pattern_ref", None)
        if pat_ref is not None:
            dp = getattr(pat_ref, "default_pattern", None)
            if isinstance(dp, str) and dp:
                txt = dp.lower()
                break
    if not txt:
        return None
    if "subscrib" in txt:
        return "SUBSCRIBER"
    if "moderat" in txt or "admin" in txt or txt == "mod":
        return "ADMIN"
    # Fans club: TikTok suele mostrar "L1", "L2", "MARU LV3", o el nombre del fan club.
    import re as _re
    if _re.search(r"\bl\d+\b|lv\d+|level\s*\d+|fan", txt):
        return "FANS"
    return None


def _fans_club_level(user_obj: Any) -> int | None:
    """Plan B: User proto expone `fans_club` y `fans_club_info` con nivel.
    A veces TikTok no incluye el badge FANS pero sí estos campos."""
    for attr in ("fans_club", "fans_club_info"):
        fc = getattr(user_obj, attr, None)
        if fc is None:
            continue
        # Buscar campo "level" en cualquier subnivel.
        for path in ("level", "user_fans_club_data.level", "data.level", "badge_level"):
            obj = fc
            ok = True
            for p in path.split("."):
                obj = getattr(obj, p, None)
                if obj is None:
                    ok = False
                    break
            if not ok:
                continue
            if isinstance(obj, int) and obj > 0:
                return obj
            if isinstance(obj, str) and obj.strip().isdigit():
                n = int(obj.strip())
                if n > 0:
                    return n
    return None


# Compat: el handler de emotes llamaba a esta función con otro nombre.
_extract_ranks_from_emote = _extract_ranks


def _resolve_username(user_obj: Any) -> str:
    """Mirror de `core/tiktok_client.py:_get_username_fast`. En TikTokLive
    6.6.5 el campo del proto es `username` (NO `unique_id`). Antes
    usábamos solo `unique_id` → la mayoría de comments quedaban como `?`.
    Prioridad: username → unique_id → uniqueId → display_id → nick_name."""
    if user_obj is None:
        return "?"
    for attr in ("username", "unique_id", "uniqueId", "display_id"):
        v = getattr(user_obj, attr, None)
        if isinstance(v, str):
            clean = v.strip()
            if clean and clean.lower() != "viewer" and not clean.lower().startswith("viewer_"):
                return clean.lower()
    nick = getattr(user_obj, "nick_name", None) or getattr(user_obj, "nickname", None)
    if isinstance(nick, str) and nick.strip():
        return nick.strip().lower()
    return "?"


def _streamer_avatar_url(worker_self: Any) -> str:
    """Recupera el avatar del STREAMER (host del live) desde el room_info
    que TikTokLive 6.6.5 expone tras `client.run(fetch_room_info=True)`.
    Probamos varias rutas porque el shape del dict cambia entre versiones.
    """
    client = getattr(worker_self, "_client", None) or getattr(worker_self, "client", None)
    if client is None:
        return ""
    info = (
        getattr(client, "room_info", None)
        or getattr(client, "_room_info", None)
        or {}
    )
    if not isinstance(info, dict):
        return ""
    owner = info.get("owner") or info.get("anchor") or {}
    if isinstance(owner, dict):
        for key in ("avatar_thumb", "avatar_medium", "avatar_large"):
            img = owner.get(key)
            if isinstance(img, dict):
                urls = img.get("urls") or img.get("url_list") or []
                if isinstance(urls, list) and urls:
                    return str(urls[0])
                uri = img.get("uri")
                if isinstance(uri, str) and uri:
                    return uri
    # Fallback: top-level "avatar" del room.
    img = info.get("cover") or info.get("avatar")
    if isinstance(img, dict):
        urls = img.get("urls") or img.get("url_list") or []
        if isinstance(urls, list) and urls:
            return str(urls[0])
    return ""


def _extract_user_avatar_url(user_obj: Any) -> str:
    """Devuelve el primer URL de la mejor avatar disponible. Probamos en
    orden: avatar_thumb → avatar_medium → avatar_large → avatar_jpg.
    Cada uno es un `ImageModel` con `m_urls: List[str]` y `m_uri: str`.

    Para que el header del live y la galería de emotes muestren la foto
    sin pegarle URL al frontend (lo descarga el sidecar)."""
    if user_obj is None:
        return ""
    for attr in ("avatar_thumb", "avatar_medium", "avatar_large", "avatar_jpg"):
        img = getattr(user_obj, attr, None)
        if img is None:
            continue
        urls = list(getattr(img, "m_urls", []) or [])
        if urls:
            return str(urls[0])
        uri = getattr(img, "m_uri", "")
        if uri:
            return str(uri)
    return ""


def _rank_prefix(ranks: dict[str, Any]) -> str:
    """Construye el prefijo `[superfan]` / `[mod]` / `[topgifter]` / `[L3]`
    para mostrar en el log antes del username."""
    badges: list[str] = []
    if ranks.get("is_super_fan"):
        badges.append("superfan")
    if ranks.get("is_moderator"):
        badges.append("mod")
    if ranks.get("is_top_gifter"):
        badges.append("topgifter")
    ml = ranks.get("member_level")
    if ml:
        badges.append(f"L{ml}")
    return f"[{':'.join(badges)}] " if badges else ""


def _patch_games_logging() -> None:
    """Logging-only patch para ValheimGame/TerrariaGame.

    NO cambia el comportamiento del original (fire-and-forget con
    `EX.submit` + return True inmediato). SÓLO loguea qué request HTTP
    se envía y qué respuesta llega — para diagnosticar cuando el mod
    no spawnea sin afectar el flujo que ya funcionaba en el MARU viejo.

    El comportamiento del usuario es idéntico al original. Lo único
    nuevo: el panel de log muestra `→ POST http://127.0.0.1:5000/spawn/
    ... HTTP 200` o el error del mod.
    """
    try:
        import core.games as cg  # type: ignore
        from core.games import EX, _get_session  # type: ignore
    except ImportError:
        log.warning("core.games no se pudo importar; saltando logging")
        return

    def _post_with_log(url: str, body: dict, label: str) -> None:
        """Misma llamada que el original pero loguea outcome. Corre en
        thread del EX como el original."""
        try:
            r = _get_session().post(url, json=body, timeout=0.5)
            log.info("%s → %s HTTP %d", label, url, r.status_code)
        except Exception as ex:
            log.warning("%s → %s ERROR: %s", label, url, ex)

    # ── Valheim: spawn = give_item = POST /spawn ; event = POST /event ──
    def valheim_spawn(self, entity: str, amount: int, user: str = ""):
        EX.submit(
            _post_with_log,
            f"{self.url}/spawn",
            {"entity_name": entity, "amount": amount},
            f"🐉 valheim spawn {entity} x{amount}",
        )
        return True, f"🐉 {amount}x {entity}"

    def valheim_give_item(self, item: str, amount: int, user: str = ""):
        EX.submit(
            _post_with_log,
            f"{self.url}/spawn",
            {"entity_name": item, "amount": amount},
            f"📦 valheim give {item} x{amount}",
        )
        return True, f"📦 {amount}x {item}"

    def valheim_trigger_event(self, event: str, user: str = ""):
        parts = event.split(" ", 1)
        name = parts[0]
        try:
            value = int(parts[1]) if len(parts) > 1 else 0
        except ValueError:
            value = 0
        EX.submit(
            _post_with_log,
            f"{self.url}/event",
            {"event_name": name, "value": value},
            f"⚡ valheim event {name}",
        )
        return True, f"⚡ {event}"

    # ── Terraria: spawn = give_item = POST /spawn/ ; event = POST /command/ ──
    def terraria_spawn(self, entity: str, amount: int, user: str = ""):
        EX.submit(
            _post_with_log,
            f"{self.url}/spawn/",
            {"entity_name": entity, "amount": amount},
            f"🐉 terraria spawn {entity} x{amount}",
        )
        return True, f"🐉 {amount}x {entity}"

    def terraria_give_item(self, item: str, amount: int, user: str = ""):
        EX.submit(
            _post_with_log,
            f"{self.url}/spawn/",
            {"entity_name": item, "amount": amount},
            f"📦 terraria give {item} x{amount}",
        )
        return True, f"📦 {amount}x {item}"

    def terraria_trigger_event(self, event: str, user: str = ""):
        parts = event.split(" ", 1)
        cmd = parts[0]
        value = parts[1] if len(parts) > 1 else ""
        EX.submit(
            _post_with_log,
            f"{self.url}/command/",
            {"command": cmd, "value": value},
            f"⚡ terraria cmd {cmd}",
        )
        return True, f"⚡ {event}"

    if hasattr(cg, "ValheimGame"):
        cg.ValheimGame.spawn = valheim_spawn
        cg.ValheimGame.give_item = valheim_give_item
        cg.ValheimGame.trigger_event = valheim_trigger_event
    if hasattr(cg, "TerrariaGame"):
        cg.TerrariaGame.spawn = terraria_spawn
        cg.TerrariaGame.give_item = terraria_give_item
        cg.TerrariaGame.trigger_event = terraria_trigger_event

    # ── CustomGame: agregar logging respetando endpoints/payloads del usuario ──
    if hasattr(cg, "CustomGame"):
        original_custom_spawn = cg.CustomGame.spawn
        original_custom_give = cg.CustomGame.give_item
        original_custom_event = cg.CustomGame.trigger_event

        def custom_spawn_logged(self, entity, amount, user=""):
            log.info(
                "🐉 custom[%s] spawn %s x%s → %s%s",
                self.game_id, entity, amount, self.url, self.spawn_endpoint,
            )
            return original_custom_spawn(self, entity, amount, user)

        def custom_give_logged(self, item, amount, user=""):
            log.info(
                "📦 custom[%s] give %s x%s → %s%s",
                self.game_id, item, amount, self.url, self.item_endpoint,
            )
            return original_custom_give(self, item, amount, user)

        def custom_event_logged(self, event, user=""):
            log.info(
                "⚡ custom[%s] event %s → %s%s",
                self.game_id, event, self.url, self.event_endpoint,
            )
            return original_custom_event(self, event, user)

        cg.CustomGame.spawn = custom_spawn_logged
        cg.CustomGame.give_item = custom_give_logged
        cg.CustomGame.trigger_event = custom_event_logged

    log.info("core.games: logging activo (mismo flujo fire-and-forget original)")


def _patch_rule_engine_parse_entry() -> None:
    """Hace que `core.rule_engine.parse_entry` acepte tanto el formato
    legacy `"NombreVisible:Comando"` como el nuevo `{"name", "command"}`
    (objeto persistido por `data.upsert` del sidecar).

    Sin este patch, las reglas no encuentran el `command` y mandan el
    nombre con emoji al mod del juego → el mod recibe un nombre ilegible
    y no spawnea nada. Bug raíz reportado el 2026-04-28."""
    try:
        import core.rule_engine as re_mod  # type: ignore
    except ImportError:
        log.warning("core.rule_engine no se pudo importar; saltando patch")
        return

    original = re_mod.parse_entry

    def parse_entry_compat(entry: Any) -> tuple[str, str]:
        # Formato nuevo: dict con `name`/`command` (o `display`/`cmd`).
        if isinstance(entry, dict):
            name = (
                entry.get("name")
                or entry.get("display")
                or entry.get("displayName")
                or ""
            )
            cmd = (
                entry.get("command")
                or entry.get("cmd")
                or entry.get("value")
                or name
            )
            return str(name).strip(), str(cmd).strip()
        # Formato legacy o cualquier otro: delegar al original.
        return original(entry)

    re_mod.parse_entry = parse_entry_compat
    log.info("core.rule_engine.parse_entry parcheado para soportar dict")


def _patch_core_paths() -> None:
    """Sustituye los constantes de `core.paths` por las nuestras (runtime).

    Hacemos override del módulo ANTES de que cualquier otro módulo de core lo
    importe, para que `from core.paths import DATA_DIR` ya devuelva nuestra ruta.
    """
    try:
        import core.paths as cp  # type: ignore
    except ImportError:
        log.warning("core.paths no se pudo importar; continuando sin patch")
        return

    overrides = {
        "ROOT_DIR": RUNTIME_DIR,
        "DATA_DIR": DATA_DIR,
        "LOGS_DIR": LOGS_DIR,
        "BACKUPS_DIR": BACKUPS_DIR,
        "CACHE_DIR": CACHE_DIR,
        "TTS_CACHE_DIR": TTS_CACHE_DIR,
        "SECRETS_DIR": SECRETS_DIR,
        "SPOTIFY_SECRETS_DIR": SPOTIFY_SECRETS_DIR,
    }
    patched: list[str] = []
    for name, new_value in overrides.items():
        if hasattr(cp, name):
            setattr(cp, name, new_value)
            patched.append(name)

    # ensure_runtime_dirs en core.paths queda apuntando al nuestro si existe
    if hasattr(cp, "ensure_runtime_dirs"):
        cp.ensure_runtime_dirs = ensure_runtime_dirs  # type: ignore[attr-defined]
        patched.append("ensure_runtime_dirs")

    log.info("core.paths parcheado: %s", ", ".join(patched) if patched else "(ninguno)")


def import_core(module_name: str) -> Any:
    """Lazy import de un módulo de `core/` con install() automático."""
    install()
    return __import__(f"core.{module_name}", fromlist=[module_name])
