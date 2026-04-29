"""Adapter `social.*` — wrap completo de `core.social_system.SocialSystem` (G7).

Réplica de `social_config.py` (2464 líneas) en RPC. Cubre 5 tabs:
  General · Comandos · Usuarios · Taps Globales · Estadísticas.

(Spotify e IA tienen sus propios services — `spotify.py` / `ia.py`.)

Arquitectura:
  - `SocialService` envuelve `SocialSystem` del core. Lazy-init via
    `core_bridge` para no fallar si el core no está disponible (test
    environments).
  - Todos los métodos son tolerantes: si el sistema no está, devuelven
    el shape vacío del DTO en vez de crashear.
  - Las mutaciones llaman a admin_* del core y persisten via el
    `_save_data()` interno del SocialSystem.

CATEGORIES (paridad MARU):
  sistema, duelo, interaccion, relacion, respuesta, utilidad, musica, ia.

35 comandos en 7 grupos:
  DUEL: golpe batalla pelea patada cachetada duelo
  ACCEPT: beso abrazo caricia saludo morder bailar regalo flor cafe pizza
          palmada novios casarse mejoresamigos rival
  RESPONSE: dado aceptar rechazar
  UTILITY: decision mesa racha divorciar terminar perfil amistad paz
           ranking top likes tarot
  MUSIC: play skip cola pause playfan
  IA: ia
  SYSTEM: register
"""

from __future__ import annotations

import threading
import time
from typing import Any

from ..logger import get_logger

log = get_logger(__name__)

# ── Defaults usados cuando core no está disponible ───────────────────────


DEFAULT_CONFIG: dict[str, Any] = {
    "enabled": True,
    "require_register": True,
    "cooldown_seconds": 5,
    "timeout_seconds": 90,
    "volume": 80,
    "voice": "",
    "enabled_commands": [],
}

DEFAULT_STATS: dict[str, Any] = {
    "total_users": 0,
    "registered_users": 0,
    "total_duelos": 0,
    "total_interacciones": 0,
    "total_matrimonios": 0,
    "total_divorcios": 0,
    "total_noviazgos": 0,
    "total_rupturas": 0,
    "active_marriages": 0,
    "active_partnerships": 0,
    "active_friendships": 0,
    "active_rivalries": 0,
    "top_streak": None,
}

# Hardcoded fallback de la taxonomía cuando el core no está disponible.
# Espejo de `social_system.py:CATEGORIES + COMMANDS_INFO`.
FALLBACK_COMMANDS_META: dict[str, dict[str, Any]] = {
    "sistema": {
        "name": "Sistema",
        "icon": "⚙️",
        "desc": "Comandos del sistema",
        "commands": [
            {"cmd": "register", "name": "Registrarse", "icon": "📝"},
        ],
    },
    "duelo": {
        "name": "Duelos",
        "icon": "⚔️",
        "desc": "Batallas con dados — ambos tiran",
        "commands": [
            {"cmd": "golpe", "name": "Golpe", "icon": "👊"},
            {"cmd": "batalla", "name": "Batalla", "icon": "⚔️"},
            {"cmd": "pelea", "name": "Pelea", "icon": "🥊"},
            {"cmd": "patada", "name": "Patada", "icon": "🦵"},
            {"cmd": "cachetada", "name": "Cachetada", "icon": "✋"},
            {"cmd": "duelo", "name": "Duelo", "icon": "🤺"},
        ],
    },
    "interaccion": {
        "name": "Interacciones",
        "icon": "💫",
        "desc": "Acciones que requieren aceptar/rechazar",
        "commands": [
            {"cmd": "beso", "name": "Beso", "icon": "💋"},
            {"cmd": "abrazo", "name": "Abrazo", "icon": "🤗"},
            {"cmd": "caricia", "name": "Caricia", "icon": "🫶"},
            {"cmd": "saludo", "name": "Saludo", "icon": "👋"},
            {"cmd": "morder", "name": "Morder", "icon": "🦷"},
            {"cmd": "bailar", "name": "Bailar", "icon": "💃"},
            {"cmd": "regalo", "name": "Regalo", "icon": "🎁"},
            {"cmd": "flor", "name": "Flor", "icon": "🌹"},
            {"cmd": "cafe", "name": "Café", "icon": "☕"},
            {"cmd": "pizza", "name": "Pizza", "icon": "🍕"},
            {"cmd": "palmada", "name": "Palmada", "icon": "🖐️"},
        ],
    },
    "relacion": {
        "name": "Relaciones",
        "icon": "❤️",
        "desc": "Formar vínculos (1 por tipo)",
        "commands": [
            {"cmd": "novios", "name": "Pedir noviazgo", "icon": "💕"},
            {"cmd": "casarse", "name": "Casarse", "icon": "💍"},
            {"cmd": "mejoresamigos", "name": "Mejores amigos", "icon": "🤝"},
            {"cmd": "rival", "name": "Rival", "icon": "😤"},
        ],
    },
    "respuesta": {
        "name": "Respuestas",
        "icon": "💬",
        "desc": "Responder a acciones pendientes",
        "commands": [
            {"cmd": "dado", "name": "Tirar dado", "icon": "🎲"},
            {"cmd": "aceptar", "name": "Aceptar", "icon": "✅"},
            {"cmd": "rechazar", "name": "Rechazar", "icon": "❌"},
        ],
    },
    "utilidad": {
        "name": "Utilidades",
        "icon": "🛠️",
        "desc": "Comandos útiles",
        "commands": [
            {"cmd": "decision", "name": "Decisión", "icon": "🤔"},
            {"cmd": "mesa", "name": "Mesa", "icon": "🪑"},
            {"cmd": "racha", "name": "Mi racha", "icon": "🔥"},
            {"cmd": "divorciar", "name": "Divorciar", "icon": "💔"},
            {"cmd": "terminar", "name": "Terminar", "icon": "💔"},
            {"cmd": "perfil", "name": "Perfil", "icon": "👤"},
            {"cmd": "amistad", "name": "Romper amistad", "icon": "🤝"},
            {"cmd": "paz", "name": "Hacer las paces", "icon": "🕊️"},
            {"cmd": "ranking", "name": "Ranking", "icon": "🏆"},
            {"cmd": "top", "name": "Top", "icon": "📊"},
            {"cmd": "likes", "name": "Likes", "icon": "❤️"},
            {"cmd": "tarot", "name": "Tarot", "icon": "🔮"},
        ],
    },
    "musica": {
        "name": "Música",
        "icon": "🎵",
        "desc": "Control de Spotify",
        "commands": [
            {"cmd": "play", "name": "Play", "icon": "▶️"},
            {"cmd": "skip", "name": "Skip", "icon": "⏭️"},
            {"cmd": "cola", "name": "Cola", "icon": "📋"},
            {"cmd": "pause", "name": "Pause", "icon": "⏸️"},
            {"cmd": "playfan", "name": "PlayFan", "icon": "⭐"},
        ],
    },
    "ia": {
        "name": "Inteligencia Artificial",
        "icon": "🤖",
        "desc": "Preguntas a la IA",
        "commands": [
            {"cmd": "ia", "name": "Preguntar IA", "icon": "🤖"},
        ],
    },
}


def _user_to_dto(username: str, raw: Any) -> dict[str, Any]:
    """Coerce un usuario del SocialSystem al DTO del renderer."""
    if not isinstance(raw, dict):
        return {
            "username": username,
            "registered": False,
            "racha": 0,
            "record_racha": 0,
            "auto_racha": None,
            "marriage": None,
            "partner": None,
            "best_friend": None,
            "rival": None,
            "duelos_ganados": 0,
            "duelos_perdidos": 0,
            "registered_at": None,
        }
    auto = raw.get("auto_racha") or raw.get("racha_auto")
    return {
        "username": username,
        "registered": bool(raw.get("registered", False)),
        "racha": int(raw.get("racha", 0) or 0),
        "record_racha": int(raw.get("record_racha", 0) or 0),
        "auto_racha": (
            {
                "active": bool(auto.get("active", False)),
                "total_days": int(auto.get("total_days", 0) or 0),
                "remaining_days": int(auto.get("remaining_days", 0) or 0),
                "started_at": auto.get("started_at"),
            }
            if isinstance(auto, dict)
            else None
        ),
        "marriage": raw.get("marriage") or raw.get("casado") or None,
        "partner": raw.get("partner") or raw.get("novio") or None,
        "best_friend": raw.get("best_friend") or raw.get("mejor_amigo") or None,
        "rival": raw.get("rival") or None,
        "duelos_ganados": int(raw.get("duelos_ganados", 0) or 0),
        "duelos_perdidos": int(raw.get("duelos_perdidos", 0) or 0),
        "registered_at": raw.get("registered_at") or raw.get("fecha_registro"),
    }


def _stats_to_dto(stats: Any, total_users: int, registered_users: int, top_streak: dict | None) -> dict[str, Any]:
    base = dict(DEFAULT_STATS)
    base["total_users"] = total_users
    base["registered_users"] = registered_users
    base["top_streak"] = top_streak
    if isinstance(stats, dict):
        for k in (
            "total_duelos",
            "total_interacciones",
            "total_matrimonios",
            "total_divorcios",
            "total_noviazgos",
            "total_rupturas",
            "active_marriages",
            "active_partnerships",
            "active_friendships",
            "active_rivalries",
        ):
            if k in stats:
                base[k] = int(stats.get(k) or 0)
    return base


# ── Service ──────────────────────────────────────────────────────────────


class SocialService:
    def __init__(self, tts: Any | None = None) -> None:
        self._sys: Any = None
        self._lock = threading.Lock()
        self._tts = tts
        self._spotify_svc: Any = None
        self._logs: Any = None

    def attach_logs(self, logs: Any) -> None:
        """Cablea LogsService para que `SocialSystem.log()` (la que el core
        usa internamente para `🎵 !play por @user: ✅ canción`) llegue al
        panel del frontend, no solo al stderr de Python."""
        self._logs = logs

    def attach_tts(self, tts: Any) -> None:
        """Permite cablear TTS después de construir el servicio."""
        self._tts = tts
        # Si el core ya estaba inicializado, re-cablear el callback en vivo.
        if self._sys is not None:
            try:
                self._sys.tts_callback = self._tts_callback
            except Exception:
                pass

    def attach_spotify(self, spotify_svc: Any) -> None:
        """Cablea SpotifyService → `SocialSystem.spotify` (paridad
        `gui.py:9400` original). Sin esto `_cmd_music` cae en el branch
        `if not self.spotify: return` y `!play`/`!skip` no responden ni
        anuncian por TTS."""
        self._spotify_svc = spotify_svc
        if self._sys is not None:
            self.refresh_spotify_link()

    def refresh_spotify_link(self) -> None:
        """Re-sincroniza `social._sys.spotify` y `spotify_tts` desde el
        SpotifyService. Llamar después de `spotify.connect`/`config_set`
        para que la siguiente vez que llegue `!play` el SocialSystem ya
        tenga la referencia activa."""
        if self._sys is None or self._spotify_svc is None:
            return
        try:
            client = self._spotify_svc._ensure_client()
            self._sys.spotify = client
            cfg = getattr(self._spotify_svc, "_config", None) or {}
            self._sys.spotify_tts = bool(cfg.get("tts_enabled", True))
            # Aplicar enabled_commands al client (paridad `gui.py:9408`).
            if client is not None:
                cmds = cfg.get("enabled_commands") or [
                    "play", "skip", "cola", "pause", "playfan",
                ]
                try:
                    client.enabled_commands = set(cmds)
                except Exception:
                    pass
        except Exception:
            log.exception("refresh_spotify_link fallo")

    def _log_callback(self, *args: Any, **_kwargs: Any) -> None:
        """Reemplaza `log_callback=log.info` para reenviar al LogsService
        (panel del frontend). Sin esto, `🎵 !play por @user` solo aparecía
        en el stderr de Python y nunca en la UI."""
        try:
            text = str(args[0]) if args else ""
        except Exception:
            text = ""
        if not text:
            return
        # Heurística de category por emoji inicial (paridad con cómo
        # categoriza el log el frontend).
        cat = "social"
        if text.startswith("🎵") or text.startswith("⭐") or "play" in text[:20].lower():
            cat = "music"
        if self._logs is not None:
            try:
                self._logs.publish(text, level="INFO", source="social", category=cat)
            except Exception:
                pass
        # Mantener log Python para debug.
        log.info(text)

    def _patch_music_speak(self) -> None:
        """Sobreescribe `SocialSystem._music_speak` para usar la ruta TTS
        rápida (`speak_now`, canal chat) en vez de `speak_social` (cola
        social que demora ~3-5s). El TTS de música tiene que ser
        ÁGIL — el viewer ya esperó la búsqueda + add_to_queue de Spotify."""
        if self._sys is None or self._tts is None:
            return
        social_self = self._sys
        tts_svc = self._tts

        def _fast_music_speak(text: str) -> None:
            if not getattr(social_self, "spotify_tts", True):
                return
            if not text:
                return
            voice = getattr(social_self, "voice", None) or None
            try:
                # Canal chat con `speak_now` → bypass de cola social.
                # El user dijo "demora muchísimo" → este es el fix.
                e = tts_svc._ensure() if hasattr(tts_svc, "_ensure") else None
                if e is not None and hasattr(e, "speak_now"):
                    e.speak_now(text, voice=voice)
                else:
                    # Fallback: speak normal canal social.
                    tts_svc.speak({"text": text, "channel": "social", **({"voice": voice} if voice else {})})
            except Exception:
                log.exception("fast_music_speak fallo")

        try:
            social_self._music_speak = _fast_music_speak  # type: ignore[method-assign]
        except Exception:
            log.exception("monkey-patch _music_speak fallo")

    def _tts_callback(self, *args: Any, **kwargs: Any) -> None:
        """Bridge SocialSystem.tts_callback → TtsService.speak (canal social).

        El SocialSystem original llama `self.tts_speak(text, volume)` con
        `volume` como INT/float — NO pasa la voz. La voz está en
        `self._sys.voice` (settable via `social.config.set` desde el
        SocialConfigDialog). Acá la leemos y la pasamos a TtsService para
        que cuando el user cambia la voz social, sí se aplique.

        Detección de args: segundo positional puede ser volume (int/float)
        o voice (str)."""
        if self._tts is None:
            return
        text = ""
        voice: str | None = None
        user: str | None = None
        if args:
            text = str(args[0]) if args[0] is not None else ""
            if len(args) >= 2 and args[1] is not None:
                if isinstance(args[1], (int, float)):
                    pass  # volume — ignorar
                else:
                    voice = str(args[1])
            if len(args) >= 3 and args[2] is not None:
                user = str(args[2])
        text = text or str(kwargs.get("text") or "")
        voice = voice or kwargs.get("voice")
        user = user or kwargs.get("user")
        # Si no llegó voice explícita, leer la voz configurada del
        # SocialSystem — paridad MARU original donde el dropdown de voz
        # del SocialConfigDialog actualizaba `social.voice`.
        if not voice and self._sys is not None:
            sv = getattr(self._sys, "voice", None)
            if isinstance(sv, str) and sv.strip():
                voice = sv
        if not text.strip():
            return
        try:
            params: dict[str, Any] = {"text": text, "channel": "social"}
            if voice:
                params["voice"] = voice
            if user:
                params["user"] = user
            self._tts.speak(params)
        except Exception:
            log.exception("social tts_callback fallo")

    def _ensure(self) -> Any:
        if self._sys is not None:
            return self._sys
        try:
            from .. import core_bridge

            core_bridge.install()
            from core.social_system import SocialSystem  # type: ignore
            from ..runtime import DATA_DIR
        except Exception as exc:
            log.warning("social: core no disponible: %s", exc)
            return None
        try:
            self._sys = SocialSystem(
                data_dir=DATA_DIR,
                tts_callback=self._tts_callback,
                log_callback=self._log_callback,
            )
            # Monkey-patch `_music_speak` para que el TTS de Spotify use
            # `speak_now` (canal chat directo, sin cola social) → se
            # escucha en ~500ms en vez de 3-5s. También logueamos la línea
            # `🎵 ▶ <canción>` al panel del frontend.
            self._patch_music_speak()
            # Wire Spotify si ya está attachado (paridad `gui.py:9400`).
            if self._spotify_svc is not None:
                try:
                    self.refresh_spotify_link()
                except Exception:
                    log.exception("social init: refresh_spotify_link")
            return self._sys
        except Exception as exc:
            log.exception("social init error: %s", exc)
            return None

    # ── RPC: comando de chat ─────────────────────────────────────────────

    def command(self, params: dict[str, Any]) -> dict[str, Any]:
        s = self._ensure()
        if s is None:
            return {"handled": False}
        user = params.get("user", "?")
        text = params.get("text", "")
        try:
            handled = bool(s.process_command(user, text))
        except Exception as exc:
            log.warning("social.command: %s", exc)
            return {"handled": False}
        return {"handled": handled}

    # ── RPC: config ──────────────────────────────────────────────────────

    def config_get(self, _params: dict[str, Any]) -> dict[str, Any]:
        s = self._ensure()
        if s is None:
            return {"config": dict(DEFAULT_CONFIG)}
        try:
            cfg = dict(s.get_config()) if hasattr(s, "get_config") else {}
        except Exception:
            cfg = {}
        # Garantizar todos los campos esperados.
        for k, v in DEFAULT_CONFIG.items():
            cfg.setdefault(k, v)
        return {"config": cfg}

    def config_set(self, params: dict[str, Any]) -> dict[str, Any]:
        s = self._ensure()
        if s is None:
            return {"ok": False}
        patch = params.get("patch") or {}
        if not isinstance(patch, dict):
            raise TypeError("patch requerido")
        try:
            with self._lock:
                if hasattr(s, "set_config"):
                    s.set_config(**patch)
                else:
                    # Fallback: setear atributos individuales si existen.
                    for k, v in patch.items():
                        if hasattr(s, k):
                            setattr(s, k, v)
                if hasattr(s, "_save_data"):
                    s._save_data()
            return {"ok": True}
        except Exception as exc:
            log.warning("social.config_set: %s", exc)
            return {"ok": False, "error": str(exc)}

    # ── RPC: comandos taxonomy ───────────────────────────────────────────

    def commands_meta(self, _params: dict[str, Any]) -> dict[str, Any]:
        """Devuelve estructura `{categories: {<cat_id>: {name, icon, desc, commands: [{cmd, name, icon}, ...]}}}`.

        Si el core está disponible usa `get_commands_by_category()` y
        `CATEGORIES`; si no, devuelve el fallback hardcoded.
        """
        s = self._ensure()
        if s is None:
            return {"categories": dict(FALLBACK_COMMANDS_META)}
        try:
            cats_meta = getattr(s, "CATEGORIES", {}) or {}
            by_cat = (
                s.get_commands_by_category()
                if hasattr(s, "get_commands_by_category")
                else {}
            )
            out: dict[str, dict[str, Any]] = {}
            for cat_id, meta in cats_meta.items():
                if not isinstance(meta, dict):
                    continue
                out[cat_id] = {
                    "name": meta.get("name", cat_id),
                    "icon": meta.get("icon", "⚙️"),
                    "desc": meta.get("desc", ""),
                    "commands": [
                        {
                            "cmd": c.get("cmd"),
                            "name": c.get("name", c.get("cmd")),
                            "icon": c.get("icon", "•"),
                            "desc": c.get("desc", ""),
                        }
                        for c in by_cat.get(cat_id, [])
                        if isinstance(c, dict) and c.get("cmd")
                    ],
                }
            if out:
                return {"categories": out}
        except Exception as exc:
            log.warning("commands_meta from core failed: %s", exc)
        return {"categories": dict(FALLBACK_COMMANDS_META)}

    # ── RPC: usuarios ────────────────────────────────────────────────────

    def users_list(self, params: dict[str, Any]) -> dict[str, Any]:
        s = self._ensure()
        if s is None:
            return {"users": []}
        query = (params.get("query") or "").strip().lower()
        try:
            raw_users = (
                s.admin_get_all_users()
                if hasattr(s, "admin_get_all_users")
                else []
            )
        except Exception as exc:
            log.warning("users_list error: %s", exc)
            return {"users": []}

        out: list[dict[str, Any]] = []
        for entry in raw_users:
            # Algunos cores devuelven dict {user, ...} y otros devuelven
            # tupla (user, dict). Tolerar ambos.
            if isinstance(entry, dict):
                username = entry.get("username") or entry.get("user")
                payload = entry
            elif isinstance(entry, (tuple, list)) and len(entry) >= 2:
                username, payload = entry[0], entry[1]
            else:
                continue
            if not username:
                continue
            if query and query not in str(username).lower():
                continue
            out.append(_user_to_dto(str(username), payload))
        return {"users": out}

    def users_get(self, params: dict[str, Any]) -> dict[str, Any]:
        s = self._ensure()
        username = params.get("username")
        if not isinstance(username, str) or not username.strip():
            raise TypeError("username requerido")
        if s is None:
            return {"user": _user_to_dto(username, None)}
        try:
            data = (
                s.admin_get_user_data(username)
                if hasattr(s, "admin_get_user_data")
                else None
            )
        except Exception:
            data = None
        return {"user": _user_to_dto(username, data)}

    def users_register(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._admin_simple(params, "admin_register_user")

    def users_unregister(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._admin_simple(params, "admin_unregister_user")

    def users_delete(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._admin_simple(params, "admin_delete_user")

    def users_set_racha(self, params: dict[str, Any]) -> dict[str, Any]:
        s = self._ensure()
        username = params.get("username")
        days = params.get("days")
        if not isinstance(username, str) or not username.strip():
            raise TypeError("username requerido")
        if not isinstance(days, int) or days < 0:
            raise ValueError("days debe ser int >= 0")
        if s is None:
            return {"ok": False}
        try:
            ok = bool(s.admin_set_racha(username, days))
            return {"ok": ok}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def users_reset_racha(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._admin_simple(params, "admin_reset_racha")

    def users_reset_relaciones(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._admin_simple(params, "admin_reset_relaciones")

    def users_remove_marriage(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._admin_simple(params, "admin_remove_marriage")

    def users_remove_relationship(self, params: dict[str, Any]) -> dict[str, Any]:
        s = self._ensure()
        username = params.get("username")
        rel_type = params.get("relType")
        if not isinstance(username, str) or not username.strip():
            raise TypeError("username requerido")
        if rel_type not in ("novios", "amigo", "rival"):
            raise ValueError("relType ∈ novios|amigo|rival")
        if s is None:
            return {"ok": False}
        try:
            ok = bool(s.admin_remove_relationship(username, rel_type))
            return {"ok": ok}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def users_activate_auto_racha(self, params: dict[str, Any]) -> dict[str, Any]:
        s = self._ensure()
        username = params.get("username")
        days = params.get("days")
        if not isinstance(username, str) or not username.strip():
            raise TypeError("username requerido")
        if not isinstance(days, int) or days < 1 or days > 365:
            raise ValueError("days ∈ [1, 365]")
        if s is None:
            return {"ok": False, "message": "core no disponible"}
        try:
            ok, msg = s.admin_activate_auto_racha(username, days)
            return {"ok": bool(ok), "message": str(msg)}
        except Exception as exc:
            return {"ok": False, "message": str(exc)}

    def users_deactivate_auto_racha(self, params: dict[str, Any]) -> dict[str, Any]:
        s = self._ensure()
        username = params.get("username")
        if not isinstance(username, str) or not username.strip():
            raise TypeError("username requerido")
        if s is None:
            return {"ok": False, "message": "core no disponible"}
        try:
            ok, msg = s.admin_deactivate_auto_racha(username)
            return {"ok": bool(ok), "message": str(msg)}
        except Exception as exc:
            return {"ok": False, "message": str(exc)}

    # ── RPC: stats globales ──────────────────────────────────────────────

    def stats(self, _params: dict[str, Any]) -> dict[str, Any]:
        s = self._ensure()
        if s is None:
            return {"stats": dict(DEFAULT_STATS)}
        try:
            raw = (
                s.admin_get_stats()
                if hasattr(s, "admin_get_stats")
                else {}
            )
            users = (
                s.admin_get_all_users()
                if hasattr(s, "admin_get_all_users")
                else []
            )
            registered = (
                s.admin_get_registered_users()
                if hasattr(s, "admin_get_registered_users")
                else []
            )
            top_streak = self._compute_top_streak(users)
        except Exception as exc:
            log.warning("stats error: %s", exc)
            return {"stats": dict(DEFAULT_STATS)}
        return {
            "stats": _stats_to_dto(
                raw,
                len(users),
                len(registered),
                top_streak,
            )
        }

    @staticmethod
    def _compute_top_streak(users: list[Any]) -> dict | None:
        best: tuple[str, int] | None = None
        for entry in users:
            if isinstance(entry, dict):
                username = entry.get("username") or entry.get("user")
                payload = entry
            elif isinstance(entry, (tuple, list)) and len(entry) >= 2:
                username, payload = entry[0], entry[1]
            else:
                continue
            if not isinstance(payload, dict):
                continue
            r = int(payload.get("record_racha", 0) or 0)
            if r > 0 and (best is None or r > best[1]):
                best = (str(username), r)
        if best is None:
            return None
        return {"username": best[0], "record": best[1]}

    # ── RPC: taps globales ───────────────────────────────────────────────

    def taps_top(self, params: dict[str, Any]) -> dict[str, Any]:
        period = (params.get("period") or "total").lower()
        if period not in ("total", "semanal", "mensual"):
            raise ValueError("period ∈ total|semanal|mensual")
        s = self._ensure()
        if s is None:
            return {"period": period, "totalTaps": 0, "totalUsers": 0, "ranking": []}
        try:
            ranking = (
                s.get_taps_ranking(period)
                if hasattr(s, "get_taps_ranking")
                else []
            )
        except Exception as exc:
            log.warning("taps_top error: %s", exc)
            return {"period": period, "totalTaps": 0, "totalUsers": 0, "ranking": []}

        clean: list[dict[str, Any]] = []
        total_taps = 0
        for r in ranking:
            if not isinstance(r, dict):
                continue
            username = r.get("user") or r.get("username")
            taps = int(r.get("taps", 0) or 0)
            last = r.get("last_active") or r.get("ultima_actividad")
            if not username:
                continue
            clean.append(
                {
                    "username": str(username),
                    "taps": taps,
                    "lastActive": last,
                }
            )
            total_taps += taps
        return {
            "period": period,
            "totalTaps": total_taps,
            "totalUsers": len(clean),
            "ranking": clean,
        }

    def taps_cleanup(self, _params: dict[str, Any]) -> dict[str, Any]:
        s = self._ensure()
        if s is None:
            return {"removed": 0}
        try:
            removed = (
                int(s.cleanup_inactive_taps())
                if hasattr(s, "cleanup_inactive_taps")
                else 0
            )
        except Exception as exc:
            log.warning("taps_cleanup: %s", exc)
            return {"removed": 0, "error": str(exc)}
        return {"removed": removed}

    # ── RPC: danger zone ─────────────────────────────────────────────────

    def reset_all(self, params: dict[str, Any]) -> dict[str, Any]:
        confirm = params.get("confirm")
        if confirm != "DELETE":
            raise ValueError("confirm debe ser exactamente 'DELETE'")
        s = self._ensure()
        if s is None:
            return {"ok": False, "message": "core no disponible"}
        try:
            with self._lock:
                if hasattr(s, "admin_reset_all"):
                    s.admin_reset_all()
                else:
                    raise RuntimeError("admin_reset_all no implementado")
            return {"ok": True, "resetAt": int(time.time() * 1000)}
        except Exception as exc:
            return {"ok": False, "message": str(exc)}

    # ── Helpers ──────────────────────────────────────────────────────────

    def _admin_simple(
        self, params: dict[str, Any], method_name: str
    ) -> dict[str, Any]:
        """Wrapper para admin methods que toman solo `username` y devuelven bool."""
        s = self._ensure()
        username = params.get("username")
        if not isinstance(username, str) or not username.strip():
            raise TypeError("username requerido")
        if s is None:
            return {"ok": False}
        method = getattr(s, method_name, None)
        if method is None:
            return {"ok": False, "error": f"{method_name} no implementado"}
        try:
            ok = bool(method(username))
            return {"ok": ok}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
