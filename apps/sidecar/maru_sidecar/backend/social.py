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


def _safe_int(v: Any, default: int = 0) -> int:
    """Coerce a int tolerante: None/dict/str/etc → default sin crashear."""
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (int, float)):
        return int(v)
    if isinstance(v, str):
        try:
            return int(v.strip()) if v.strip() else default
        except ValueError:
            return default
    return default


def _user_to_dto(
    username: str,
    raw: Any,
    *,
    avatar: str = "",
    super_fan: bool = False,
    auto_racha_kind: str = "manual",
) -> dict[str, Any]:
    """Coerce un usuario del SocialSystem al DTO del renderer.

    El SocialSystem core tiene DOS formas de devolver un user, según el
    método admin que lo emita:

    1) `admin_get_all_users()` → flat con `racha=int`, `record_racha=int`,
       `auto_racha_activa=bool`, `auto_racha_restantes=int`,
       `casado_con/novios_con/mejor_amigo/rival` y
       `duelos_ganados/duelos_perdidos`.

    2) `admin_get_user_data(user)` → `dict` interno crudo con
       `racha={"dias":N, "ultimo":..., "record":N}` (NESTED dict),
       `racha_automatica={"activa":bool, "dias_restantes":N, ...}`,
       `casado_con/novios_con/mejor_amigo/rival` y
       `stats={"duelos_ganados":N, "duelos_perdidos":N}`.

    Antes este DTO solo entendía la forma (1), entonces tras un
    `setRacha` el reload (`users_get` → admin_get_user_data) devolvía
    `racha={"dias":5}` y `int({"dias":5})` lanzaba TypeError → el RPC
    fallaba → la UI mostraba el valor viejo (parecía "se revertía").
    Ahora soporta ambas formas y usa `_safe_int` para no crashear con
    inputs raros.
    """
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
            "avatar": avatar or None,
            "is_super_fan": super_fan,
        }
    # racha: puede venir flat (`racha=int`) o nested
    # (`racha={"dias":N, "record":N}`).
    racha_raw = raw.get("racha")
    if isinstance(racha_raw, dict):
        racha_dias = _safe_int(racha_raw.get("dias"))
        record_racha = _safe_int(
            raw.get("record_racha", racha_raw.get("record"))
        )
    else:
        racha_dias = _safe_int(racha_raw)
        record_racha = _safe_int(raw.get("record_racha"))
    # auto_racha: forma flat (`auto_racha_activa/restantes`), forma core
    # (`racha_automatica={"activa":bool, "dias_restantes":N, "dias_total":N,
    # "fecha_inicio":...}`) o forma renderer (`auto_racha={"active":bool,...}`).
    auto: dict[str, Any] | None = None
    auto_renderer = raw.get("auto_racha")
    racha_auto_core = raw.get("racha_automatica")
    if isinstance(auto_renderer, dict):
        auto = {
            "active": bool(auto_renderer.get("active", False)),
            "total_days": _safe_int(auto_renderer.get("total_days")),
            "remaining_days": _safe_int(auto_renderer.get("remaining_days")),
            "started_at": auto_renderer.get("started_at"),
        }
    elif isinstance(racha_auto_core, dict):
        auto = {
            "active": bool(racha_auto_core.get("activa", False)),
            "total_days": _safe_int(racha_auto_core.get("dias_total")),
            "remaining_days": _safe_int(racha_auto_core.get("dias_restantes")),
            "started_at": racha_auto_core.get("fecha_inicio"),
        }
    elif "auto_racha_activa" in raw or "auto_racha_restantes" in raw:
        auto = {
            "active": bool(raw.get("auto_racha_activa", False)),
            "total_days": _safe_int(raw.get("auto_racha_total")),
            "remaining_days": _safe_int(raw.get("auto_racha_restantes")),
            "started_at": raw.get("auto_racha_inicio"),
        }
    if auto is not None:
        auto["kind"] = auto_racha_kind
    # stats puede venir nested en `stats={"duelos_ganados":N, ...}` o flat.
    stats_raw = raw.get("stats") if isinstance(raw.get("stats"), dict) else {}
    return {
        "username": username,
        "registered": bool(raw.get("registered", False)),
        "racha": racha_dias,
        "record_racha": record_racha,
        "auto_racha": auto,
        "marriage": (
            raw.get("marriage") or raw.get("casado_con") or raw.get("casado") or None
        ),
        "partner": (
            raw.get("partner") or raw.get("novios_con") or raw.get("novio") or None
        ),
        "best_friend": (
            raw.get("best_friend") or raw.get("mejor_amigo") or None
        ),
        "rival": raw.get("rival") or None,
        "duelos_ganados": _safe_int(
            raw.get("duelos_ganados", stats_raw.get("duelos_ganados"))
        ),
        "duelos_perdidos": _safe_int(
            raw.get("duelos_perdidos", stats_raw.get("duelos_perdidos"))
        ),
        "registered_at": raw.get("registered_at") or raw.get("fecha_registro"),
        "avatar": avatar or None,
        "is_super_fan": super_fan,
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
        # Avatares persistentes del sistema social — mapean
        # `username_lower → URL CDN TikTok`. Persisten a disco como
        # `data/social_avatars.json`. Se actualizan cuando un user
        # comenta/dona/entra (alimentado por bus tiktok:comment-enriched).
        # Diferencia con `tiktok._user_avatar_cache` (memoria, sesión):
        # esto persiste hasta que el user sea borrado por el streamer
        # o por inactividad. Ahorra requests al CDN — un avatar
        # cacheado el primer día sigue siendo válido para el log de
        # social/registrados N días después.
        self._avatars: dict[str, str] = {}
        self._avatars_path: Any = None
        self._avatars_dirty: bool = False
        self._avatars_save_timer: threading.Timer | None = None
        self._avatars_lock = threading.Lock()
        # Dedupe del callback de TTS — defensa en profundidad. La causa raíz
        # de los duplicados de `!racha`/`!suerte` se cortó en
        # `ChatDispatcher._is_duplicate_cmd` (el core emite `comment` +
        # `command` para el mismo `!cmd` y antes ChatDispatcher procesaba
        # ambos). Esta dedupe queda como red de seguridad por si OTRO
        # camino también dispara la misma narración en paralelo
        # (ej. `_process_async` corre en thread, podría haber callbacks
        # heredados del SocialSystem original). Ventana 1.5s.
        # IMPORTANTE: protegida con lock — el chequeo + set deben ser
        # atómicos. Sin lock, dos threads paralelos pueden leer el mismo
        # `_last_tts_call` y AMBOS proceder a hablar antes de actualizarlo.
        self._last_tts_call: tuple[float, str] = (0.0, "")
        self._last_tts_lock = threading.Lock()

    def attach_logs(self, logs: Any) -> None:
        """Cablea LogsService para que `SocialSystem.log()` (la que el core
        usa internamente para `🎵 !play por @user: ✅ canción`) llegue al
        panel del frontend, no solo al stderr de Python."""
        self._logs = logs

    # ── Avatares persistentes ────────────────────────────────────────────
    def _avatars_init(self) -> None:
        """Carga el archivo `social_avatars.json` desde data/. Idempotente.
        Llamar solo después de tener `_sys` (con `data_dir`)."""
        if self._avatars_path is not None:
            return
        try:
            from ..runtime import DATA_DIR
            self._avatars_path = DATA_DIR / "social_avatars.json"
            if self._avatars_path.is_file():
                import json as _json
                with open(self._avatars_path, "r", encoding="utf-8") as fh:
                    raw = _json.load(fh)
                if isinstance(raw, dict):
                    # Sanitizar: solo URLs válidas, claves lower.
                    for k, v in raw.items():
                        if (
                            isinstance(k, str)
                            and isinstance(v, str)
                            and v.startswith("http")
                        ):
                            self._avatars[k.lower()] = v
                log.info("social_avatars cargados: %d entries", len(self._avatars))
        except Exception:
            log.exception("social_avatars init fallo (continúo con dict vacío)")

    def _avatars_schedule_save(self) -> None:
        """Persistir con debounce 3s — agrupa muchos updates en 1 escritura."""
        with self._avatars_lock:
            self._avatars_dirty = True
            if self._avatars_save_timer is not None:
                self._avatars_save_timer.cancel()
            self._avatars_save_timer = threading.Timer(3.0, self._avatars_flush)
            self._avatars_save_timer.daemon = True
            self._avatars_save_timer.start()

    def _avatars_flush(self) -> None:
        with self._avatars_lock:
            if not self._avatars_dirty or self._avatars_path is None:
                return
            snapshot = dict(self._avatars)
            self._avatars_dirty = False
        try:
            import json as _json
            tmp = self._avatars_path.with_suffix(".tmp")
            with open(tmp, "w", encoding="utf-8") as fh:
                _json.dump(snapshot, fh, ensure_ascii=False)
            tmp.replace(self._avatars_path)
        except Exception:
            log.exception("social_avatars flush fallo")

    def remember_avatar(self, username: str, url: str) -> None:
        """Llamada externa (bus tiktok:comment-enriched) para persistir
        el avatar de un user. Idempotente — no escribe si ya existía con
        la misma URL."""
        if not username or not url or not url.startswith("http"):
            return
        self._avatars_init()
        key = username.lower()
        if self._avatars.get(key) == url:
            return
        self._avatars[key] = url
        self._avatars_schedule_save()

    def forget_avatar(self, username: str) -> None:
        """Borra el avatar (cuando el user se elimina del sistema)."""
        if not username:
            return
        self._avatars_init()
        if self._avatars.pop(username.lower(), None) is not None:
            self._avatars_schedule_save()

    def get_avatar(self, username: str) -> str:
        if not username:
            return ""
        self._avatars_init()
        return self._avatars.get(username.lower(), "")

    def _is_super_fan_now(self, username: str) -> bool:
        """Lee del cache de rangos del TikTokService si el user está
        marcado como super_fan EN ESTE LIVE. Esto alimenta:
          1. La columna "Super Fan" del SocialDialog → se muestra dorado.
          2. La racha automática "Super Fan" — dura mientras lo sea.
        Tolerante: si el TikTokService no está cableado, retorna False."""
        if not username:
            return False
        try:
            from . import tiktok as _tk  # type: ignore
            # tiktok_svc se cablea en bootstrap; usamos el global del
            # registry para evitar inyectarlo en SocialService
            # constructor (que rompería retro-compat).
            from ..rpc import registry as _reg  # type: ignore
            tiktok_svc = getattr(_reg, "_GLOBAL_TIKTOK_SVC", None)
            if tiktok_svc is None:
                return False
            cache = getattr(tiktok_svc, "_user_ranks_cache", None)
            if not isinstance(cache, dict):
                return False
            entry = cache.get(username.lower())
            if not isinstance(entry, dict):
                return False
            return bool(entry.get("is_super_fan"))
        except Exception:
            return False

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
        en el stderr de Python y nunca en la UI.

        IMPORTANTE: NO llamar `log.info(text)` después de `_logs.publish`.
        El root logger tiene LogsBridgeHandler que también llama a
        `_logs.publish` con source="maru_sidecar.backend.social", lo que
        produce un segundo entry con MISMA message+level pero distinto
        source → la dedupe (clave level+source+message) NO los junta y
        cada evento `📢 RACHA TTS resultado` aparece 2 veces en el panel.
        Si en el futuro hace falta el log al archivo, usar un logger
        dedicado que no propague al root."""
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
            # Sanear usernames embebidos en el anuncio. El core retorna
            # `"<canción> en cola, pedido por cristian_rivasxd"` y el `_`
            # truncaba el TTS. `sanitize_text_usernames` deja palabras
            # normales como "Despacito"/"Spotify" intactas — solo
            # interviene en tokens con `@`/`_`/dígito.
            from .utils.tts_text import sanitize_text_usernames
            safe_text = sanitize_text_usernames(text)
            voice = getattr(social_self, "voice", None) or None
            try:
                # Canal chat con `speak_now` → bypass de cola social.
                # El user dijo "demora muchísimo" → este es el fix.
                e = tts_svc._ensure() if hasattr(tts_svc, "_ensure") else None
                if e is not None and hasattr(e, "speak_now"):
                    e.speak_now(safe_text, voice=voice)
                else:
                    # Fallback: speak normal canal social.
                    tts_svc.speak({"text": safe_text, "channel": "social", **({"voice": voice} if voice else {})})
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
        # Dedupe atómica por (texto[:120], 1.5s). Bajo el lock para que
        # dos threads paralelos no pasen ambos el chequeo antes de
        # actualizar. Ventana 1.5s — las narraciones del SocialSystem
        # nunca repiten texto exacto en <1.5s para eventos distintos.
        now = time.time()
        text_key = text[:120]
        with self._last_tts_lock:
            last_ts, last_text = self._last_tts_call
            if last_text == text_key and (now - last_ts) < 1.5:
                return
            self._last_tts_call = (now, text_key)
        try:
            params: dict[str, Any] = {"text": text, "channel": "social"}
            if voice:
                params["voice"] = voice
            if user:
                params["user"] = user
            self._tts.speak(params)
        except Exception:
            log.exception("social tts_callback fallo")

    def _tts_fortune_callback(self, *args: Any, **kwargs: Any) -> None:
        """Bridge específico para `_cmd_tarot` y demás comandos de fortuna
        del SocialSystem — manda al canal `fortune` en lugar del social,
        para que la voz de fortuna y la cola exclusiva se respeten.

        El SocialSystem original llama `self.tts_fortune(text, volume)`.
        Sin este callback dedicado, el fallback caía en `tts_callback` y
        el tarot sonaba por el canal social con la voz social.
        """
        if self._tts is None:
            return
        text = ""
        if args:
            text = str(args[0]) if args[0] is not None else ""
        text = text or str(kwargs.get("text") or "")
        if not text.strip():
            return
        try:
            self._tts.speak({"text": text, "channel": "fortune"})
        except Exception:
            log.exception("social tts_fortune_callback fallo")

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
                tts_fortune_callback=self._tts_fortune_callback,
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
            avatar = self.get_avatar(str(username))
            super_fan = self._is_super_fan_now(str(username))
            kind = "super_fan" if self.is_super_fan_racha(str(username)) else "manual"
            out.append(
                _user_to_dto(
                    str(username), payload,
                    avatar=avatar, super_fan=super_fan,
                    auto_racha_kind=kind,
                )
            )
        return {"users": out}

    def users_get(self, params: dict[str, Any]) -> dict[str, Any]:
        s = self._ensure()
        username = params.get("username")
        if not isinstance(username, str) or not username.strip():
            raise TypeError("username requerido")
        kind = "super_fan" if self.is_super_fan_racha(username) else "manual"
        if s is None:
            return {"user": _user_to_dto(
                username, None,
                avatar=self.get_avatar(username),
                super_fan=self._is_super_fan_now(username),
                auto_racha_kind=kind,
            )}
        try:
            data = (
                s.admin_get_user_data(username)
                if hasattr(s, "admin_get_user_data")
                else None
            )
        except Exception:
            data = None
        return {"user": _user_to_dto(
            username, data,
            avatar=self.get_avatar(username),
            super_fan=self._is_super_fan_now(username),
            auto_racha_kind=kind,
        )}

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
        """Activa racha automática.

        Tipos (`kind`):
          - "manual" (default) — N días que el streamer define.
          - "super_fan" — vinculado al rol Super Fan del live. Dura
            mientras el user mantenga is_super_fan=True. Cuando termina
            el sub, se desactiva automáticamente. Se persiste con un
            flag marcador en `data/super_fan_rachas.json` para distinguir
            del manual al desactivar.
        """
        s = self._ensure()
        username = params.get("username")
        days = params.get("days")
        kind = (params.get("kind") or "manual")
        if not isinstance(username, str) or not username.strip():
            raise TypeError("username requerido")
        if kind == "super_fan":
            # Super Fan: usamos un valor alto (365) para que el contador
            # no se agote durante el live, y el track real lo lleva el
            # marcador en super_fan_rachas. Si el user pierde super_fan,
            # `_sync_super_fan_rachas` lo desactiva.
            days = 365
            try:
                self._mark_super_fan_racha(username, True)
            except Exception:
                pass
        else:
            if not isinstance(days, int) or days < 1 or days > 365:
                raise ValueError("days ∈ [1, 365]")
        if s is None:
            return {"ok": False, "message": "core no disponible"}
        try:
            ok, msg = s.admin_activate_auto_racha(username, days)
            return {"ok": bool(ok), "message": str(msg), "kind": kind}
        except Exception as exc:
            return {"ok": False, "message": str(exc)}

    # ── Super fan rachas (marcadores) ────────────────────────────────────
    def _super_fan_path(self) -> Any:
        try:
            from ..runtime import DATA_DIR
            return DATA_DIR / "super_fan_rachas.json"
        except Exception:
            return None

    def _load_super_fan_rachas(self) -> set[str]:
        p = self._super_fan_path()
        if p is None or not p.is_file():
            return set()
        try:
            import json as _json
            with open(p, "r", encoding="utf-8") as fh:
                raw = _json.load(fh)
            if isinstance(raw, list):
                return {str(x).lower() for x in raw if isinstance(x, str)}
        except Exception:
            pass
        return set()

    def _save_super_fan_rachas(self, marks: set[str]) -> None:
        p = self._super_fan_path()
        if p is None:
            return
        try:
            import json as _json
            tmp = p.with_suffix(".tmp")
            with open(tmp, "w", encoding="utf-8") as fh:
                _json.dump(sorted(marks), fh, ensure_ascii=False)
            tmp.replace(p)
        except Exception:
            log.exception("super_fan_rachas save fallo")

    def _mark_super_fan_racha(self, username: str, active: bool) -> None:
        marks = self._load_super_fan_rachas()
        key = username.lower()
        if active:
            marks.add(key)
        else:
            marks.discard(key)
        self._save_super_fan_rachas(marks)

    def is_super_fan_racha(self, username: str) -> bool:
        return username.lower() in self._load_super_fan_rachas()

    def sync_super_fan_status(self, username: str, is_super_fan: bool) -> None:
        """Llamado por TikTokService cuando detecta cambio de
        is_super_fan en un comment-enriched. Activa/desactiva la
        racha super fan automáticamente."""
        if not username:
            return
        if is_super_fan:
            # Activar solo si no estaba ya marcado.
            if not self.is_super_fan_racha(username):
                try:
                    self.users_activate_auto_racha({
                        "username": username,
                        "kind": "super_fan",
                    })
                except Exception:
                    pass
        else:
            # El user perdió super_fan: si tenía marca super_fan,
            # desactivamos la racha automática.
            if self.is_super_fan_racha(username):
                self._mark_super_fan_racha(username, False)
                try:
                    self.users_deactivate_auto_racha({"username": username})
                except Exception:
                    pass

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
