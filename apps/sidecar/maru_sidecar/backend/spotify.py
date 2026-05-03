"""Adapter `spotify.*` — wrap completo de `core.spotify_client.SpotifyClient` (G14).

Capacidades MARU original (paridad sección O · 23 ítems):
  - OAuth server local :8888.
  - Multi-cuenta (`accounts.json`).
  - Throttling 3s/call + 8/30s, recovery mode 10min cache 120s.
  - play_request cola random priority + playfan_request cuota diaria.
  - skip / pause / resume / toggle / get_devices / device_id.
  - Comandos enabled (5: play/skip/cola/pause/playfan).
  - Priority users + playfan_uses persistente.

Persistencia propia (G14):
  - `data/spotify.json` con `{credentials, config, priority_users}`.
  - Cuentas guardadas: delegado a `SpotifyClient` original (acccounts.json
    en su lugar) cuando exista; sino se persiste localmente.

Tolerante a `core.spotify_client` no disponible: todas las operaciones
devuelven shape válido sin crashear.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from pathlib import Path
from typing import Any

from ..event_bus import get_event_bus
from ..logger import get_logger
from ..runtime import DATA_DIR

log = get_logger(__name__)


DEFAULT_CONFIG: dict[str, Any] = {
    "enabled": False,
    "max_queue": 5,
    "tts_enabled": True,
    "device_id": "",
    "enabled_commands": ["play", "skip", "cola", "pause", "playfan"],
    # priority_users guardadas como dict username (lower) → daily_uses.
    # Sincronizado AUTOMÁTICAMENTE desde super_fans del live (TikTok
    # `is_super_fan` flag). El usuario solo edita `uses/día`; la
    # membresía es manejada por el backend al detectar/perder el rol.
    "priority_users": {},
    # Default de usos diarios al detectar un nuevo super fan.
    "playfan_default_uses": 5,
    # Mapa de super fans vistos en el live.
    #   { username_lower: { "displayName": str,
    #                       "firstSeenMs": int,
    #                       "lastSeenMs": int } }
    # Persistente entre sesiones para que la lista no se vacíe al
    # reiniciar la app sin estar en vivo. Cuando el sidecar ve un
    # comment-enriched con `is_super_fan=False`, el user se quita
    # inmediatamente; cuando ve `is_super_fan=True` se actualiza
    # `lastSeenMs`.
    "super_fans": {},
    # Credenciales OAuth — se persisten para que tras reiniciar la app
    # `try_auto_connect()` funcione sin reabrir el flow del navegador.
    # Paridad MARU original (`gui.py:9392-9398` que también las guardaba).
    "client_id": "",
    "client_secret": "",
    # Persistencia del contador de !playfan consumido HOY por usuario.
    # Antes vivía solo en memoria del SpotifyClient → cualquier reinicio
    # (auto-update incluido) reseteaba la cuota y `!playfan` se volvía
    # "infinito" desde la perspectiva del streamer.
    # Shape: { "username_lower": int }, junto con `playfan_used_date` (YYYY-MM-DD).
    "playfan_used": {},
    "playfan_used_date": "",
}


def _config_path() -> Path:
    return DATA_DIR / "spotify.json"


def _accounts_path() -> Path:
    """Lista de cuentas guardadas. La persistimos NOSOTROS bajo
    `data/spotify_accounts.json` (atomic write, errores explícitos) en
    vez de delegar al `SpotifyClient.save_accounts_list` original que
    swallowea excepciones silencioso → el user clickeaba Guardar y nada
    se persistía sin feedback visible."""
    return DATA_DIR / "spotify_accounts.json"


def _read_accounts() -> list[dict[str, Any]]:
    p = _accounts_path()
    if not p.exists():
        return []
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return raw if isinstance(raw, list) else []


def _write_accounts(accounts: list[dict[str, Any]]) -> None:
    p = _accounts_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps(accounts, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    tmp.replace(p)


def _coerce_config(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {**DEFAULT_CONFIG, "priority_users": {}}
    out = {**DEFAULT_CONFIG, "priority_users": {}}
    out["enabled"] = bool(raw.get("enabled", False))
    try:
        out["max_queue"] = max(1, min(50, int(raw.get("max_queue") or 5)))
    except (TypeError, ValueError):
        out["max_queue"] = 5
    out["tts_enabled"] = bool(raw.get("tts_enabled", True))
    out["device_id"] = str(raw.get("device_id") or "")
    cmds = raw.get("enabled_commands")
    if isinstance(cmds, list):
        out["enabled_commands"] = [
            c for c in cmds if isinstance(c, str) and c in DEFAULT_CONFIG["enabled_commands"]
        ]
    pu = raw.get("priority_users") or {}
    if isinstance(pu, dict):
        out["priority_users"] = {
            str(k).lower(): max(0, min(50, int(v) or 0))
            for k, v in pu.items()
            if isinstance(k, str)
        }
    try:
        out["playfan_default_uses"] = max(
            1, min(50, int(raw.get("playfan_default_uses") or 5))
        )
    except (TypeError, ValueError):
        out["playfan_default_uses"] = 5
    sf = raw.get("super_fans") or {}
    if isinstance(sf, dict):
        coerced_sf: dict[str, dict[str, Any]] = {}
        for k, v in sf.items():
            if not isinstance(k, str) or not isinstance(v, dict):
                continue
            try:
                coerced_sf[k.lower()] = {
                    "displayName": str(v.get("displayName") or k),
                    "firstSeenMs": int(v.get("firstSeenMs") or 0),
                    "lastSeenMs": int(v.get("lastSeenMs") or 0),
                }
            except (TypeError, ValueError):
                continue
        out["super_fans"] = coerced_sf
    out["client_id"] = str(raw.get("client_id") or "").strip()
    out["client_secret"] = str(raw.get("client_secret") or "").strip()
    pfu = raw.get("playfan_used") or {}
    if isinstance(pfu, dict):
        cleaned: dict[str, int] = {}
        for k, v in pfu.items():
            if not isinstance(k, str):
                continue
            try:
                n = int(v)
            except (TypeError, ValueError):
                continue
            if n > 0:
                cleaned[k.strip().lower()] = n
        out["playfan_used"] = cleaned
    out["playfan_used_date"] = str(raw.get("playfan_used_date") or "").strip()
    return out


class SpotifyService:
    def __init__(self) -> None:
        self._client: Any = None
        self._lock = threading.Lock()
        self._poll_task: asyncio.Task[None] | None = None
        self._social_svc: Any = None
        self._last_pushed_track: str | None = None
        self._bus_subscribed: bool = False
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._config = self._read_config()
        # Suscribirse al bus para capturar comment-enriched de
        # CUALQUIER fuente — worker real Y simulator. Antes
        # `notify_super_fan` solo se invocaba desde
        # `tiktok._cache_ranks` que solo corre con la señal del
        # worker → al simular un super fan desde el simulador,
        # la lista PlayFan no se actualizaba.
        self._install_bus_listener()

    def _install_bus_listener(self) -> None:
        if self._bus_subscribed:
            return
        try:
            bus = get_event_bus()
            bus.subscribe(
                "tiktok:comment-enriched", self._on_comment_enriched_bus,
            )
            # NUEVO v1.0.44: warm-start de Spotify cuando se conecta el live.
            # Antes había que esperar al scheduler de 8s post-boot o que el
            # user clickeara "Conectar Spotify" manual. Ahora, apenas el
            # streamer arranca el live, si hay credenciales guardadas en
            # spotify.json el cliente intenta auto-connect en background.
            bus.subscribe(
                "tiktok:status", self._on_tiktok_status_bus,
            )
            self._bus_subscribed = True
        except Exception:
            log.exception("spotify._install_bus_listener fallo")

    def _on_tiktok_status_bus(self, payload: dict[str, Any]) -> None:
        """Cuando TikTok pasa a connected, intenta warm-start de Spotify
        (no-op si ya está conectado o si no hay credenciales). Se ejecuta
        en thread del bus → usamos un thread aparte para no bloquear el
        loop con un posible HTTP del OAuth refresh."""
        if not isinstance(payload, dict):
            return
        if not payload.get("connected"):
            return
        # Si ya tenemos cliente conectado, no hay nada que hacer.
        if self._client is not None and getattr(self._client, "is_connected", False):
            return
        # Solo intentamos si hay credenciales persistidas (sino el
        # `_ensure_client` no podrá conectar y solo gastará un HTTP en vano).
        if not self._config.get("client_id") or not self._config.get("client_secret"):
            return

        def _warm() -> None:
            try:
                self._ensure_client()
            except Exception:
                log.exception("spotify warm-start tras tiktok:connected fallo")

        threading.Thread(target=_warm, name="spotify-warmup", daemon=True).start()

    def _on_comment_enriched_bus(self, payload: dict[str, Any]) -> None:
        """Listener del bus — captura comment-enriched de simulator y
        worker. Llama notify_super_fan SOLO cuando is_super_fan está
        EXPLÍCITO en el payload (True o False). Idempotente +
        throttled internamente."""
        if not isinstance(payload, dict):
            return
        if "is_super_fan" not in payload:
            return
        user = str(payload.get("user") or "").strip()
        if not user or user == "?":
            return
        try:
            self.notify_super_fan(
                user,
                bool(payload.get("is_super_fan")),
                str(payload.get("nickname") or payload.get("display_name") or user),
            )
        except Exception:
            log.exception("spotify._on_comment_enriched_bus fallo")

    def attach_social(self, social_svc: Any) -> None:
        """Cablea SocialService para que después de `connect`/`config_set`
        re-sincronicemos `social._sys.spotify`."""
        self._social_svc = social_svc

    def _notify_social(self) -> None:
        if self._social_svc is None:
            return
        try:
            self._social_svc.refresh_spotify_link()
        except Exception:
            log.exception("spotify._notify_social fallo")

    # ── Persistencia ─────────────────────────────────────────────────────

    def _read_config(self) -> dict[str, Any]:
        path = _config_path()
        if not path.exists():
            return _coerce_config({})
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.error("spotify.json corrupto — usando defaults")
            return _coerce_config({})
        return _coerce_config(raw if isinstance(raw, dict) else {})

    def _write_config(self) -> None:
        path = _config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {**self._config, "updatedAt": int(time.time() * 1000)}
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)

    # ── Lazy client ──────────────────────────────────────────────────────

    def _ensure_client(self) -> Any:
        if self._client is not None:
            return self._client
        try:
            from .. import core_bridge

            core_bridge.install()
            from core.spotify_client import SpotifyClient  # type: ignore
        except Exception as exc:
            log.warning("spotify: core no disponible: %s", exc)
            return None
        try:
            self._client = SpotifyClient()
            # Registrar el callback ANTES de cualquier acción que pueda
            # tocar `_playfan_used` (el reset diario también lo dispara).
            try:
                self._client.on_playfan_state_changed = self._on_playfan_state_changed
            except Exception:
                log.exception("spotify: no se pudo registrar callback playfan")
            # Restaurar credenciales guardadas. Sin esto `try_auto_connect`
            # falla silencioso porque `client_id`/`client_secret` están en
            # blanco después de reiniciar la app.
            cid = self._config.get("client_id") or ""
            csec = self._config.get("client_secret") or ""
            if cid and csec:
                try:
                    if hasattr(self._client, "configure"):
                        # `configure` es la API original — preserva max_queue,
                        # device_id y priority_users si las pasamos.
                        self._client.configure(
                            client_id=cid,
                            client_secret=csec,
                            device_id=self._config.get("device_id", ""),
                            max_queue=self._config.get("max_queue", 5),
                            priority_users=list(
                                self._config.get("priority_users", {}).keys()
                            ),
                        )
                    elif hasattr(self._client, "set_credentials"):
                        self._client.set_credentials(cid, csec)
                    else:
                        self._client.client_id = cid
                        self._client.client_secret = csec
                except Exception:
                    log.exception("spotify: aplicar credenciales guardadas")
            # CRÍTICO: `configure` arriba pasa SOLO los nombres de
            # priority_users. El cuota por usuario (`playfan_uses`) queda
            # vacía → `playfan_request` ve max_uses=0 y rechaza con "no
            # tienes usos configurados". Aplicarlo explícitamente acá
            # cierra ese bug raíz: el cliente ahora arranca con la cuota
            # real de cada super fan.
            try:
                self._apply_priority_users_to_client()
            except Exception:
                log.exception("spotify: apply_priority_users_to_client tras configure")
            # Restaurar el contador de usos consumidos HOY (persistido en
            # spotify.json). Si la fecha persistida es de ayer o anterior,
            # el cliente lo descarta automáticamente — equivale al reset
            # diario.
            try:
                self._client.restore_playfan_state(
                    dict(self._config.get("playfan_used") or {}),
                    str(self._config.get("playfan_used_date") or "") or None,
                )
            except Exception:
                log.exception("spotify: restore_playfan_state fallo")
            try:
                self._client.try_auto_connect()
            except Exception:
                pass
            return self._client
        except Exception as exc:
            log.exception("spotify init error: %s", exc)
            return None

    # ── RPC: status / now-playing ────────────────────────────────────────

    def status(self, _params: dict[str, Any]) -> dict[str, Any]:
        c = self._ensure_client()
        if c is None:
            return {"connected": False, "available": False}
        try:
            connected = bool(getattr(c, "is_connected", False))
            account = c.get_account_info() if connected else None
        except Exception as exc:
            log.warning("spotify status: %s", exc)
            return {"connected": False, "available": True}
        return {
            "connected": connected,
            "available": True,
            "account": account,
            "rateLimited": bool(
                getattr(c, "_is_rate_limited", lambda: False)()
                if hasattr(c, "_is_rate_limited")
                else False
            ),
        }

    def now_playing(self, _params: dict[str, Any]) -> dict[str, Any]:
        c = self._ensure_client()
        if c is None or not getattr(c, "is_connected", False):
            return {"isPlaying": False}
        try:
            np = c.get_now_playing() or {}
        except Exception:
            return {"isPlaying": False}
        return self._serialize_now_playing(np)

    # ── RPC: control de reproducción ─────────────────────────────────────

    def play_request(self, params: dict[str, Any]) -> dict[str, Any]:
        c = self._ensure_client()
        if c is None:
            return {"ok": False, "message": "spotify no disponible"}
        user = params.get("user", "?")
        query = params.get("query", "")
        priority = bool(params.get("priority"))
        try:
            ok, msg = (
                c.playfan_request(user, query)
                if priority
                else c.play_request(user, query)
            )
        except Exception as exc:
            return {"ok": False, "message": str(exc)}
        return {"ok": bool(ok), "message": str(msg)}

    def skip(self, _params: dict[str, Any]) -> dict[str, Any]:
        c = self._ensure_client()
        if c is None:
            return {"ok": False}
        try:
            c.skip_current()
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "message": str(exc)}

    def toggle_playback(self, _params: dict[str, Any]) -> dict[str, Any]:
        c = self._ensure_client()
        if c is None:
            return {"ok": False, "message": "spotify no disponible"}
        try:
            ok, msg = c.toggle_playback()
        except Exception as exc:
            return {"ok": False, "message": str(exc)}
        return {"ok": bool(ok), "message": str(msg)}

    # ── RPC: queue / devices (G14) ───────────────────────────────────────

    def queue_list(self, _params: dict[str, Any]) -> dict[str, Any]:
        c = self._ensure_client()
        if c is None or not getattr(c, "is_connected", False):
            return {"items": [], "total": 0}
        try:
            raw = (
                c.get_queue_list()
                if hasattr(c, "get_queue_list")
                else []
            )
        except Exception:
            return {"items": [], "total": 0}
        items: list[dict[str, Any]] = []
        for r in raw or []:
            if not isinstance(r, dict):
                continue
            # SpotifyClient guarda los entries como
            #   {"user": <str>, "track": {"uri","name","artist","id",...},
            #    "priority": <bool>, "added_at": <ts>}
            # El mapper anterior buscaba `r.get("name")` directo → siempre
            # None → la UI mostraba "--" en cada fila de la cola.
            track = r.get("track") if isinstance(r.get("track"), dict) else {}
            name = track.get("name") or r.get("name") or r.get("trackName") or ""
            artist = track.get("artist") or r.get("artist") or ""
            track_id = (
                track.get("id")
                or track.get("trackId")
                or r.get("track_id")
                or r.get("trackId")
                or ""
            )
            items.append(
                {
                    "trackName": str(name),
                    "artist": str(artist),
                    "requestedBy": str(r.get("user") or r.get("requested_by") or "?"),
                    "isPriority": bool(r.get("priority", False)),
                    "trackId": str(track_id),
                }
            )
        return {"items": items, "total": len(items)}

    def queue_clear(self, _params: dict[str, Any]) -> dict[str, Any]:
        c = self._ensure_client()
        if c is None:
            return {"ok": False, "message": "spotify no disponible"}
        try:
            if hasattr(c, "clear_queue"):
                c.clear_queue()
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "message": str(exc)}

    def queue_remove(self, params: dict[str, Any]) -> dict[str, Any]:
        c = self._ensure_client()
        if c is None:
            return {"ok": False}
        track_id = params.get("trackId")
        if not isinstance(track_id, str) or not track_id:
            raise TypeError("trackId requerido")
        try:
            if hasattr(c, "remove_from_queue"):
                c.remove_from_queue(track_id)
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "message": str(exc)}

    def devices(self, _params: dict[str, Any]) -> dict[str, Any]:
        c = self._ensure_client()
        if c is None or not getattr(c, "is_connected", False):
            return {"devices": []}
        try:
            raw = (
                c.get_devices()
                if hasattr(c, "get_devices")
                else []
            )
        except Exception:
            return {"devices": []}
        out: list[dict[str, Any]] = []
        for d in raw or []:
            if not isinstance(d, dict):
                continue
            out.append(
                {
                    "id": str(d.get("id") or ""),
                    "name": str(d.get("name") or ""),
                    "type": str(d.get("type") or "unknown"),
                    "isActive": bool(d.get("is_active", False)),
                    "volumePercent": int(d.get("volume_percent") or 0),
                }
            )
        return {"devices": out}

    # ── RPC: cuentas guardadas (G14) ─────────────────────────────────────
    # Las APIs reales del SpotifyClient original (`spotify_client.py:472-548`):
    #   - load_saved_accounts() → list[{name, client_id, client_secret}]   (@staticmethod)
    #   - save_account(name, client_id, client_secret) → bool              (@staticmethod)
    #   - delete_account(client_id) → bool                                  (@staticmethod)
    #   - switch_account(client_id, client_secret)                          (instance, desconecta+limpia cache+autentica)
    # Antes llamábamos a `list_accounts/save_current_account/load_account/delete_account(name)`
    # que no existen — por eso en la UI no salía ninguna cuenta y "Guardar"
    # parecía no hacer nada.

    def _client_class(self) -> Any:
        c = self._ensure_client()
        return type(c) if c is not None else None

    def accounts_list(self, _params: dict[str, Any]) -> dict[str, Any]:
        # Persistencia propia (atomic write en data/spotify_accounts.json).
        # Antes delegábamos a SpotifyClient.load_saved_accounts() que lee
        # de un path estático calculado a tiempo de import del core ANTES
        # de patchear core.paths → posible mismatch. Además
        # save_accounts_list silenciaba IOError → user clickea Guardar y
        # nada se persiste sin feedback.
        accounts = _read_accounts()
        c = self._client
        current_id = (
            str(getattr(c, "client_id", "") or "") if c is not None else ""
        )
        is_connected = bool(getattr(c, "is_connected", False)) if c is not None else False

        out: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for a in accounts:
            if not isinstance(a, dict):
                continue
            cid = str(a.get("client_id") or "")
            name = str(a.get("name") or cid or "?")
            seen_ids.add(cid)
            out.append({
                "name": name,
                "displayName": name,
                "isCurrent": is_connected and bool(current_id) and cid == current_id,
                "saved": True,
            })

        # Si hay un client conectado pero su client_id NO está en el archivo
        # de cuentas guardadas (caso reportado: user conectó con creds frescas
        # y nunca clickeó Guardar), igual lo mostramos arriba con `saved=false`
        # para que la UI ofrezca un botón "💾 Guardar esta" sin tener que
        # adivinar qué cuenta es.
        if is_connected and current_id and current_id not in seen_ids:
            account_name = (
                str(getattr(c, "account_name", "") or "").strip()
                or f"Spotify {current_id[-6:]}"
            )
            out.insert(0, {
                "name": account_name,
                "displayName": account_name + " (sin guardar)",
                "isCurrent": True,
                "saved": False,
            })
        return {"accounts": out}

    def accounts_save(self, params: dict[str, Any]) -> dict[str, Any]:
        c = self._ensure_client()
        name = params.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("name requerido")
        # Obtener credenciales actuales — preferir las del client conectado,
        # caer al config persistido si no hay cliente.
        cid = str(getattr(c, "client_id", "") or "") if c is not None else ""
        csec = str(getattr(c, "client_secret", "") or "") if c is not None else ""
        if not cid or not csec:
            cid = str(self._config.get("client_id") or "")
            csec = str(self._config.get("client_secret") or "")
        if not cid or not csec:
            return {
                "ok": False,
                "message": "primero conectá Spotify para tener credenciales",
            }
        try:
            with self._lock:
                accounts = _read_accounts()
                # Update si ya existe por client_id, sino append.
                updated = False
                for acc in accounts:
                    if acc.get("client_id") == cid:
                        acc["name"] = name.strip()
                        acc["client_secret"] = csec
                        updated = True
                        break
                if not updated:
                    accounts.append({
                        "name": name.strip(),
                        "client_id": cid,
                        "client_secret": csec,
                    })
                _write_accounts(accounts)
            log.info("spotify.accounts_save: '%s' guardada (total=%d)", name.strip(), len(accounts))
            return {"ok": True}
        except Exception as exc:
            log.exception("spotify.accounts_save fallo")
            return {"ok": False, "message": str(exc)}

    def accounts_load(self, params: dict[str, Any]) -> dict[str, Any]:
        """Cambiar a una cuenta guardada — usa switch_account(cid, csec).
        Persistimos las credenciales nuevas en spotify.json y notificamos
        al SocialSystem para que social._sys.spotify apunte a la nueva."""
        c = self._ensure_client()
        if c is None:
            return {"ok": False, "message": "spotify no disponible"}
        name = params.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("name requerido")
        accounts = _read_accounts()
        target = next(
            (a for a in accounts if isinstance(a, dict) and a.get("name") == name.strip()),
            None,
        )
        if target is None:
            return {"ok": False, "message": f"cuenta '{name}' no encontrada"}
        cid = str(target.get("client_id") or "")
        csec = str(target.get("client_secret") or "")
        if not cid or not csec:
            return {"ok": False, "message": "cuenta sin credenciales válidas"}
        try:
            if hasattr(c, "switch_account"):
                c.switch_account(cid, csec)
            elif hasattr(c, "configure"):
                c.configure(client_id=cid, client_secret=csec)
            else:
                c.client_id = cid
                c.client_secret = csec
            if hasattr(c, "try_auto_connect"):
                try:
                    c.try_auto_connect()
                except Exception:
                    pass
            self._persist_credentials(cid, csec)
            self._notify_social()
            log.info("spotify.accounts_load: cuenta '%s' activada", name.strip())
            return {"ok": True}
        except Exception as exc:
            log.exception("spotify.accounts_load fallo")
            return {"ok": False, "message": str(exc)}

    def accounts_delete(self, params: dict[str, Any]) -> dict[str, Any]:
        name = params.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("name requerido")
        try:
            with self._lock:
                accounts = _read_accounts()
                before = len(accounts)
                accounts = [
                    a for a in accounts
                    if isinstance(a, dict) and a.get("name") != name.strip()
                ]
                _write_accounts(accounts)
            log.info("spotify.accounts_delete: '%s' (removed=%d)", name.strip(), before - len(accounts))
            return {"ok": True, "removed": before > len(accounts)}
        except Exception as exc:
            log.exception("spotify.accounts_delete fallo")
            return {"ok": False, "message": str(exc)}

    # ── RPC: connect / disconnect / credentials ──────────────────────────

    def connect(self, params: dict[str, Any]) -> dict[str, Any]:
        """Inicia OAuth flow del SpotifyClient (paridad MARU original).

        El método del core se llama `authenticate()`, retorna `(ok: bool,
        message: str)`. Antes se llamaba `c.connect()` que NO EXISTE → fallo
        silencioso. Ahora ejecutamos el auth real:
          1. Set credentials si vinieron por params.
          2. Llamar `authenticate()` que abre navegador + servidor OAuth :8888.
          3. Devolver resultado al frontend.

        Como `authenticate()` puede tardar hasta 90s (espera del usuario),
        lo corremos en thread aparte vía run_in_executor para no bloquear
        el loop del sidecar."""
        c = self._ensure_client()
        if c is None:
            return {"ok": False, "message": "spotify no disponible"}
        client_id = str(params.get("clientId") or "").strip()
        client_secret = str(params.get("clientSecret") or "").strip()
        try:
            if client_id and client_secret and hasattr(c, "set_credentials"):
                c.set_credentials(client_id, client_secret)
            elif client_id and client_secret:
                # Fallback: setear directamente si el método no existe.
                c.client_id = client_id
                c.client_secret = client_secret

            if not hasattr(c, "authenticate"):
                return {
                    "ok": False,
                    "message": "core.spotify_client.authenticate no disponible",
                }
            res = c.authenticate()
            # `authenticate()` retorna (ok: bool, message: str).
            if isinstance(res, tuple) and len(res) == 2:
                ok, msg = bool(res[0]), str(res[1])
                if ok:
                    self._persist_credentials(client_id, client_secret)
                    self._auto_save_connected_account(c)
                    # Wire SpotifyClient en el SocialSystem para que `!play`
                    # encuentre `self.spotify` no-None y anuncie por TTS.
                    self._notify_social()
                return {"ok": ok, "message": msg}
            if bool(res):
                self._persist_credentials(client_id, client_secret)
                self._auto_save_connected_account(c)
                self._notify_social()
            return {"ok": bool(res)}
        except Exception as exc:
            log.exception("spotify.connect fallo")
            return {"ok": False, "message": str(exc)}

    def _persist_credentials(self, client_id: str, client_secret: str) -> None:
        """Guarda client_id/client_secret en `data/spotify.json` para que
        `try_auto_connect` funcione tras reiniciar la app. También marca
        `enabled=True` para que la próxima vez se respete el toggle."""
        if not client_id or not client_secret:
            return
        with self._lock:
            self._config["client_id"] = client_id
            self._config["client_secret"] = client_secret
            self._config["enabled"] = True
            self._write_config()

    def _auto_save_connected_account(self, c: Any) -> None:
        """Auto-añade la cuenta recién conectada a `spotify_accounts.json`
        usando su display name de Spotify. Sin esto, el user veía
        "🟢 Conectado" arriba pero la lista de cuentas guardadas estaba
        vacía y no podía cambiar entre cuentas. Idempotente: si ya existe
        por client_id, solo actualiza el nombre/secret."""
        try:
            cid = str(getattr(c, "client_id", "") or "")
            csec = str(getattr(c, "client_secret", "") or "")
            name = str(getattr(c, "account_name", "") or "").strip()
            if not cid or not csec:
                return
            if not name:
                # Fallback: usar últimos 6 caracteres del client_id como tag.
                name = f"Spotify {cid[-6:]}"
            with self._lock:
                accounts = _read_accounts()
                updated = False
                for acc in accounts:
                    if acc.get("client_id") == cid:
                        acc["name"] = name
                        acc["client_secret"] = csec
                        updated = True
                        break
                if not updated:
                    accounts.append({
                        "name": name,
                        "client_id": cid,
                        "client_secret": csec,
                    })
                _write_accounts(accounts)
            log.info(
                "spotify._auto_save: '%s' (total=%d, updated=%s)",
                name, len(accounts), updated,
            )
        except Exception:
            log.exception("spotify._auto_save fallo")

    def disconnect(self, _params: dict[str, Any]) -> dict[str, Any]:
        c = self._client  # no forzar init si no estaba.
        if c is None:
            return {"ok": True}
        try:
            if hasattr(c, "disconnect"):
                c.disconnect()
            return {"ok": True}
        except Exception:
            return {"ok": True}

    # ── RPC: config (G14) ───────────────────────────────────────────────

    def config_get(self, _params: dict[str, Any]) -> dict[str, Any]:
        return {"config": dict(self._config)}

    def config_set(self, params: dict[str, Any]) -> dict[str, Any]:
        patch = params.get("patch") or {}
        if not isinstance(patch, dict):
            raise TypeError("patch requerido")
        with self._lock:
            merged = {**self._config, **patch}
            self._config = _coerce_config(merged)
            self._write_config()
            # Aplicar al client si tiene API.
            c = self._client
            if c is not None:
                try:
                    if hasattr(c, "set_max_queue"):
                        c.set_max_queue(self._config["max_queue"])
                    if hasattr(c, "set_device_id"):
                        c.set_device_id(self._config["device_id"])
                    if hasattr(c, "set_priority_users"):
                        c.set_priority_users(dict(self._config["priority_users"]))
                except Exception as exc:
                    log.warning("config_set apply: %s", exc)
        # Re-sincronizar con SocialSystem (tts_enabled puede haber cambiado).
        self._notify_social()
        return {"ok": True, "config": dict(self._config)}

    def priority_user_set(self, params: dict[str, Any]) -> dict[str, Any]:
        """Editar el contador `uses/día` de un user prioritario.

        IMPORTANTE: ya no acepta usuarios arbitrarios — solo permite editar
        super fans existentes. Si el user no es super fan actual, devuelve
        error. La membresía se sincroniza desde TikTok (`is_super_fan` flag).
        """
        username = params.get("username")
        if not isinstance(username, str) or not username.strip():
            raise ValueError("username requerido")
        uname = username.strip().lower()
        uses = params.get("uses")
        try:
            uses_n = max(0, min(50, int(uses or 0)))
        except (TypeError, ValueError):
            uses_n = 2
        with self._lock:
            if uname not in self._config["super_fans"]:
                return {
                    "ok": False,
                    "message": (
                        "Solo se puede editar usos de super fans actuales. "
                        "La lista se sincroniza automáticamente desde el live."
                    ),
                }
            self._config["priority_users"][uname] = uses_n
            self._write_config()
            self._apply_priority_users_to_client()
        return {"ok": True, "username": uname, "uses": uses_n}

    def priority_user_remove(self, params: dict[str, Any]) -> dict[str, Any]:
        """DEPRECATED — la membresía es automática. Devuelve no-op."""
        return {
            "ok": False,
            "message": (
                "La lista PlayFan se sincroniza automáticamente con los super "
                "fans del live. No se puede quitar manualmente."
            ),
        }

    # ── RPC: super fans (sync con TikTok is_super_fan) ──────────────────

    def super_fans_list(self, _params: dict[str, Any]) -> dict[str, Any]:
        """Devuelve los super fans actuales con su cuota y consumo de hoy.

        Shape: `{ items: [{username, displayName, lastSeenMs, firstSeenMs,
        uses, usedToday, remaining}], defaultUses, total, dateIso }`.
        Ordenados por lastSeenMs descendente (los más recientes arriba).
        """
        items: list[dict[str, Any]] = []
        with self._lock:
            sf = dict(self._config["super_fans"])
            pu = dict(self._config["priority_users"])
            default_uses = int(self._config.get("playfan_default_uses") or 5)
            persisted_used = dict(self._config.get("playfan_used") or {})
            persisted_date = str(self._config.get("playfan_used_date") or "")
        # Si el cliente está vivo lo consultamos directo (verdad-en-vivo).
        # Si no, fallback al snapshot persistido en spotify.json.
        used_today: dict[str, int] = {}
        date_iso = persisted_date
        c = self._client
        if c is not None and hasattr(c, "get_playfan_used_today"):
            try:
                used_today = c.get_playfan_used_today()
                pf_date = getattr(c, "_playfan_date", None)
                if pf_date is not None:
                    date_iso = pf_date.isoformat()
            except Exception:
                used_today = persisted_used
        else:
            used_today = persisted_used
        for uname, meta in sf.items():
            uses = int(pu.get(uname, default_uses))
            ut = int(used_today.get(uname, 0))
            items.append({
                "username": uname,
                "displayName": meta.get("displayName") or uname,
                "firstSeenMs": int(meta.get("firstSeenMs") or 0),
                "lastSeenMs": int(meta.get("lastSeenMs") or 0),
                "uses": uses,
                "usedToday": ut,
                "remaining": max(0, uses - ut),
            })
        items.sort(key=lambda i: i["lastSeenMs"], reverse=True)
        return {
            "items": items,
            "defaultUses": default_uses,
            "total": len(items),
            "dateIso": date_iso,
        }

    def super_fan_set_uses(self, params: dict[str, Any]) -> dict[str, Any]:
        """Alias semántico de `priority_user_set` con la misma validación."""
        return self.priority_user_set(params)

    def super_fan_remove(self, params: dict[str, Any]) -> dict[str, Any]:
        """Borra manualmente a un usuario de super_fans + priority_users.

        El auto-add/remove desde TikTok (`notify_super_fan`) sigue activo:
        si el user vuelve a comentar con `is_super_fan=True`, se vuelve a
        agregar automáticamente. Sirve para limpiar entradas que quedaron
        de un default viejo o usuarios fantasma.
        """
        username = params.get("username")
        if not isinstance(username, str) or not username.strip():
            raise TypeError("username requerido")
        uname = username.strip().lower()
        removed_sf = False
        removed_pu = False
        with self._lock:
            if uname in self._config["super_fans"]:
                self._config["super_fans"].pop(uname, None)
                removed_sf = True
            if uname in self._config["priority_users"]:
                self._config["priority_users"].pop(uname, None)
                removed_pu = True
            if removed_sf or removed_pu:
                self._write_config()
                self._apply_priority_users_to_client()
        return {
            "ok": True,
            "username": uname,
            "removedFromSuperFans": removed_sf,
            "removedFromPriorityUsers": removed_pu,
        }

    def playfan_default_set(self, params: dict[str, Any]) -> dict[str, Any]:
        """Setea el `uses/día` por defecto que se asigna a los super fans
        nuevos cuando se detectan automáticamente. No afecta los usos ya
        configurados de los super fans existentes."""
        try:
            n = max(1, min(50, int(params.get("uses") or 5)))
        except (TypeError, ValueError):
            n = 5
        with self._lock:
            self._config["playfan_default_uses"] = n
            self._write_config()
        return {"ok": True, "defaultUses": n}

    def notify_super_fan(
        self,
        username: str,
        is_super_fan: bool,
        display_name: str | None = None,
    ) -> None:
        """Hook llamado desde TikTokService cuando un comment-enriched
        trae el flag `is_super_fan` explícito.

          - `is_super_fan=True` → agrega/refresca el user en super_fans
            y lo sincroniza a priority_users con `playfan_default_uses`
            (si no existía ya con un valor distinto).
          - `is_super_fan=False` → elimina al user de super_fans y
            de priority_users (perdió el rol).

        Idempotente. Persiste solo cuando hay cambios reales (no escribe
        spotify.json en cada comment).
        """
        if not isinstance(username, str):
            return
        uname = username.strip().lower()
        if not uname or uname == "?":
            return
        now_ms = int(time.time() * 1000)
        changed = False
        with self._lock:
            sf = self._config["super_fans"]
            pu = self._config["priority_users"]
            default_uses = int(self._config.get("playfan_default_uses") or 5)
            if is_super_fan:
                existing = sf.get(uname)
                if existing is None:
                    sf[uname] = {
                        "displayName": display_name or username.strip() or uname,
                        "firstSeenMs": now_ms,
                        "lastSeenMs": now_ms,
                    }
                    changed = True
                else:
                    # Solo re-escribimos disco si pasaron >5min desde el
                    # último update — evita escribir spotify.json a cada
                    # comment de un super fan activo.
                    if now_ms - int(existing.get("lastSeenMs") or 0) > 5 * 60 * 1000:
                        existing["lastSeenMs"] = now_ms
                        changed = True
                    if display_name and existing.get("displayName") != display_name:
                        existing["displayName"] = display_name
                        changed = True
                if uname not in pu:
                    pu[uname] = default_uses
                    changed = True
            else:
                if uname in sf:
                    sf.pop(uname, None)
                    changed = True
                if uname in pu:
                    pu.pop(uname, None)
                    changed = True
            if changed:
                self._write_config()
                self._apply_priority_users_to_client()

    def _on_playfan_state_changed(
        self, used: dict[str, int], date_iso: str | None
    ) -> None:
        """Hook que dispara el SpotifyClient legacy tras incrementar
        `_playfan_used` (o tras reset diario). Persiste en spotify.json y
        emite `spotify:playfan-state` para que la UI repinte el badge sin
        esperar al próximo refresh manual.

        Idempotente: solo escribe si el shape cambió. Atómico (`_lock`)
        para no chocar con `config_set` corriendo en otro thread.
        """
        try:
            cleaned: dict[str, int] = {}
            if isinstance(used, dict):
                for k, v in used.items():
                    if not isinstance(k, str):
                        continue
                    try:
                        n = int(v)
                    except (TypeError, ValueError):
                        continue
                    if n > 0:
                        cleaned[k.strip().lower()] = n
            new_date = str(date_iso or "")
            with self._lock:
                changed = (
                    cleaned != (self._config.get("playfan_used") or {})
                    or new_date != str(self._config.get("playfan_used_date") or "")
                )
                if not changed:
                    return
                self._config["playfan_used"] = cleaned
                self._config["playfan_used_date"] = new_date
                self._write_config()
            try:
                bus = get_event_bus()
                bus.publish("spotify:playfan-state", {
                    "used": cleaned,
                    "date": new_date,
                })
            except Exception:
                pass
        except Exception:
            log.exception("spotify._on_playfan_state_changed fallo")

    def _apply_priority_users_to_client(self) -> None:
        """Re-aplica priority_users + playfan_uses al SpotifyClient en
        vivo. Antes el branch `set_priority_users` solo actualizaba la
        membresía y dejaba `playfan_uses` vacío → cuota inválida y
        `!playfan` rechazado con "no tienes usos configurados". Ahora
        ambas estructuras se mantienen sincronizadas siempre.
        """
        c = self._client
        if c is None:
            return
        pu = dict(self._config["priority_users"])
        try:
            if hasattr(c, "set_priority_users"):
                c.set_priority_users(pu)
            c.priority_users = set(pu.keys())
            if hasattr(c, "playfan_uses"):
                c.playfan_uses = dict(pu)
        except Exception:
            log.exception("apply_priority_users fallo")

    # ── Polling para push event `spotify:now-playing` ───────────────────

    def poll_now_playing_for_push(self) -> dict[str, Any] | None:
        """Devuelve el payload serializado SOLO cuando cambia el track o el
        estado de reproducción. El scheduler en `__main__` usa esto para
        emitir `spotify:now-playing` sin saturar la WS.

        También dispara el monitor `check_and_advance` (paridad
        `gui.py:9421` que usa un QTimer cada 30s para restaurar contexto
        post-playfan).

        Warm-start: si `_client` aún no fue inicializado, llamamos a
        `_ensure_client()` para que `try_auto_connect()` corra en background
        y el header global empiece a mostrar la canción sin que el usuario
        tenga que abrir el diálogo."""
        if self._client is None:
            try:
                self._ensure_client()
            except Exception:
                pass
        if self._client is None or not getattr(self._client, "is_connected", False):
            # Si pasamos de conectado a desconectado, emitimos un cambio.
            if self._last_pushed_track is not None:
                self._last_pushed_track = None
                return {"isPlaying": False}
            return None
        try:
            # Trigger del monitor de cola/contexto (paridad MARU).
            try:
                if hasattr(self._client, "check_and_advance"):
                    self._client.check_and_advance()
            except Exception:
                pass
            np = self._client.get_now_playing() or {}
        except Exception:
            return None
        payload = self._serialize_now_playing(np)
        # Clave de cambio: track + estado playing.
        track = payload.get("track") or {}
        key = (
            f"{bool(payload.get('isPlaying'))}|"
            f"{track.get('name','')}|{track.get('artist','')}"
        )
        if key == self._last_pushed_track:
            return None
        self._last_pushed_track = key
        return payload

    # ── Helpers ─────────────────────────────────────────────────────────

    @staticmethod
    def _serialize_now_playing(np: dict[str, Any]) -> dict[str, Any]:
        if not np or not np.get("is_playing"):
            return {"isPlaying": False}
        return {
            "isPlaying": True,
            "track": {
                "name": np.get("name", ""),
                "artist": np.get("artist", ""),
                "album": np.get("album"),
                "durationMs": int(np.get("duration_ms") or 0),
                "positionMs": int(np.get("progress_ms") or 0),
            },
            "requestedBy": np.get("requested_by"),
        }
