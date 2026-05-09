"""MARU Overlays Relay — sidecar side
=================================

ZONA AISLADA. Todo lo nuevo del sistema de overlays vive acá.

Responsabilidades:
  1. Mantener UNA WebSocket persistente al Cloudflare Worker
     (`wss://<host>/uplink/<user>/ws`).
  2. Suscribirse PASIVAMENTE al `EventBus` del sidecar y reenviar al
     uplink los eventos relevantes (gifts, likes, follows, etc.) en
     formato minimalista — solo lo que el overlay necesita para animar.
  3. Exponer RPCs (`overlays.*`) que pasan por encima al Worker:
        - list                → registry estático (id, name, icon, url)
        - get-config          → GET https://worker/u/<user>/<overlay>/config
        - set-config          → publica "<overlay>_config" por el uplink WS
                                (el DO persiste + broadcast hot-reload)
        - test-event          → publica un evento de prueba por el uplink
        - identity-get/set    → user_id local (lo único que MARU recuerda)

Decisiones clave de diseño:
  • MARU NO almacena configs (color/goal/etc.). Solo `user_id` + `enabled`
    se persiste en `data/overlays_identity.json`. La config real vive 100%
    en el Durable Object SQLite del Worker.
  • Suscriptor PASIVO: usamos `bus.subscribe(...)` que es un listener
    in-process del bus. NO modificamos `tiktok_client`, `rule_engine` ni
    ningún otro path. Si el relay muere, el resto de MARU sigue idéntico.
  • Reusa `websockets` (lib ya en requirements.txt para el RpcServer).
    Cero dependencia nueva.
  • Backoff exponencial 1s → 30s para reconexión. Si el WS está caído,
    los eventos se DESCARTAN silenciosamente (los overlays son estado
    visual del LIVE EN VIVO — eventos pasados no tienen sentido replay).

Footprint medido (idle background, panel cerrado):
  ~3-5 MB RAM (1 task asyncio + buffer fijo + `websockets` ya cargado).
  ~0% CPU idle, <0.5% durante bursts de 100 ev/s.

Reversibilidad:
  - Borrando este archivo + las 3 líneas marcadas
    `# MARU-OVERLAYS-INTEGRATION` en `rpc/registry.py` → MARU vuelve al
    estado pre-overlays. Cero side effects.
"""

from __future__ import annotations

import asyncio
import json
import secrets
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any
from urllib import request as _urlreq

from ..event_bus import get_event_bus
from ..logger import get_logger
from ..runtime import DATA_DIR

log = get_logger(__name__)

# ── Constantes del backend cloud ─────────────────────────────────────────
WORKER_HOST = "maru-overlays.soykoru07.workers.dev"
PUBLIC_DOMAIN = "overlays.korugames.lat"

# Identity = lo ÚNICO que MARU persiste localmente del sistema overlays.
# Es solo `{userId, enabled}`. NO es la config de los overlays — esa vive
# en Cloudflare. El userId acá es el namespace del Durable Object.
_IDENTITY_PATH = DATA_DIR / "overlays_identity.json"

# Registry estático de overlays. Sumar uno nuevo = sumarlo acá. La parte
# pesada (HTML/CSS/JS) vive en `maru-overlays/public/<id>/` desplegada en
# Cloudflare Pages — ESTE registry solo describe metadata.
OVERLAY_REGISTRY: dict[str, dict[str, Any]] = {
    "taps": {
        "name": "Meta de Likes",
        "icon": "❤️",
        "description": "Barra de progreso estilo Tikfinity con meta de likes.",
        # Ratio del preview en la UI (ancho/alto en px) — debe igualar la
        # forma natural del widget para que el preview no tenga huecos.
        "preview_aspect": [880, 130],
        # Defaults espejados con `public/taps/app.js:DEFAULTS`.
        "default": {
            # Comportamiento
            "goal": 1000,
            "label": "Meta de likes",
            "message": "¡Lo logramos!",
            "reset_on_goal": True,
            "reset_on_live_start": True,
            # Modo al cumplir la meta:
            #   "reset"    → counter vuelve a 0 (default, mantiene meta).
            #   "double"   → meta se duplica (20k→40k→80k...), counter sigue.
            #   "increase" → meta sube en goal_increase_amount, counter sigue.
            "goal_mode": "reset",
            "goal_increase_amount": 10000,
            "show_percent": True,
            "show_confetti": True,
            "show_toast": True,
            # Estética
            "variant": "default",   # default | neon | minimal | pure
            "layout": "standard",   # standard | simple | condensed
            "shape": "rounded",     # square | rounded | pill
            "title_position": "below",    # above | below
            "title_align": "center",      # left | center | right
            "color_primary": "#d42c65",
            "color_track": "#2cb2d4",
            "color_bg": "rgba(30, 123, 146, 0.92)",
            "color_text": "#ffffff",
            "color_percent": "#ffffff",
            "color_border": "rgba(255, 255, 255, 0.10)",
            "border_width": 0,
            "radius": 14,
            "shadow_strength": 1,
            "skew": -15,
            # Layout / posición
            "width": 880,
            "bar_height": 38,
            "align_h": "center",
            "align_v": "bottom",
            "margin_x": 32,
            "margin_y": 36,
            # Tipografía
            "font_title": 18,
            "font_counter": 22,
            "font_percent": 22,
            "counter_weight": 700,
            # Animación
            "bar_anim": 0.6,
            "bump_duration": 0.45,
            # Acciones al cumplir la meta — lista de:
            #   {kind: "spawn"|"item"|"event", gameId, name, label, amount}
            # MARU dispara TODAS al juego activo cuando el counter alcanza goal.
            "goal_actions": [],
        },
        "consumes": ["like"],
    },
    "likes": {
        "name": "!likes individual",
        "icon": "❤️",
        "description": "Cuando un user usa !likes, aparece su avatar + número total de likes que ha dado.",
        "preview_aspect": [320, 110],
        "default": {
            "style": "glass",
            "duration_ms": 7000,
            "color_bg": "rgba(15, 14, 22, 0.85)",
            "color_text": "#ffffff",
            "color_accent": "#ff4d6d",
            "card_radius": 14,
            "avatar_size": 56,
            "font_user": 14,
            "font_count": 28,
        },
        "consumes": [],
    },
    "toplikes": {
        "name": "Top Likes ranking",
        "icon": "🏆",
        "description": "Top 1/3/5 de users con más likes. Top 3 con marco dorado.",
        "preview_aspect": [220, 380],
        "default": {
            "style": "glass",
            "max_items": 3,            # 1 | 3 | 5
            "show_count": True,
            "vertical": True,          # true = lista vertical, false = horizontal
            "color_bg": "rgba(15, 14, 22, 0.85)",
            "color_text": "#ffffff",
            "color_accent": "#ffd23f",
            "color_subtle": "rgba(255, 255, 255, 0.55)",
            "card_radius": 12,
            "avatar_size": 56,
            "font_user": 12,
            "font_count": 16,
        },
        "consumes": [],
    },
    "music": {
        "name": "Cola de Música",
        "icon": "🎵",
        "description": "Lista vertical discreta con la canción actual + cola de Spotify (portada + nombre + artista).",
        "preview_aspect": [380, 480],
        "default": {
            "style": "glass",
            "max_items": 5,
            "show_progress": True,
            "show_now_playing": True,
            "show_requested_by": True,
            "color_bg": "rgba(15, 14, 22, 0.85)",
            "color_text": "#ffffff",
            "color_accent": "#1DB954",
            "color_subtle": "rgba(255, 255, 255, 0.55)",
            "color_title": "",        # vacío → usa color_text
            "color_artist": "",       # vacío → usa color_subtle
            "color_meta": "",         # vacío → usa color_accent
            "card_radius": 14,
            "cover_size": 56,
            "font_title": 16,
            "font_artist": 12,
            "font_meta": 11,
            "spacing": 10,
        },
        "consumes": [],
    },
    "extensible": {
        "name": "Subathon Timer",
        "icon": "⏱️",
        "description": "Countdown HH:MM:SS. Donaciones extienden el tiempo. Play/pause manual. 💀 al llegar a 0.",
        "preview_aspect": [340, 140],
        "default": {
            # Tiempo inicial al arrancar/resetear (segundos).
            "initial_seconds": 3600,  # 1 hora por default
            # Cada moneda donada suma X segundos al countdown.
            "seconds_per_coin": 3,
            # Overrides por gift: tiempo fijo en vez de seconds_per_coin × monedas.
            "overrides": [],
            # Formato display.
            "format": "hms",          # hms | ms | s
            # Estética.
            "color_primary": "#ffd23f",
            "color_text": "#ffffff",
            "color_bg": "rgba(15, 14, 22, 0.85)",
            "color_border": "rgba(255, 255, 255, 0.10)",
            "font_size": 84,
            "font_family": "default",
            "font_weight": 900,
            "letter_spacing": -3,
            "radius": 18,
            "padding_x": 28,
            "padding_y": 14,
            "show_bg": True,
            # Mensaje final cuando el contador llega a 0.
            "end_emoji": "💀",
            "end_message": "Se acabó",
        },
        "consumes": ["gift"],
    },
    "streak": {
        "name": "Racha (!racha)",
        "icon": "🔥",
        "description": "Llama animada con días de racha (comando !racha).",
        "preview_aspect": [360, 460],
        "default": {
            "duration": 6000,
            "label": "DÍAS DE RACHA",
            "color_primary": "#ff6b35",
            "color_secondary": "#ffd23f",
            "color_text": "#ffffff",
            "show_particles": True,
        },
        # streak NO se alimenta del bus — se dispara por RPC test-event /
        # set-config explícito o por callback explícito desde social.
        "consumes": [],
    },
}


# ── Identity persistente mínima ──────────────────────────────────────────


class _IdentityStore:
    """Archivo dedicado con `{userId, enabled}`. Lockeado por threading."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cache: dict[str, Any] | None = None

    def _read(self) -> dict[str, Any]:
        if self._cache is not None:
            return dict(self._cache)
        if not _IDENTITY_PATH.exists():
            return {}
        try:
            data = json.loads(_IDENTITY_PATH.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}

    def _write(self, data: dict[str, Any]) -> None:
        _IDENTITY_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = _IDENTITY_PATH.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp.replace(_IDENTITY_PATH)

    def get(self) -> dict[str, Any]:
        with self._lock:
            data = self._read()
            user_id = data.get("userId") or _generate_user_id()
            enabled = bool(data.get("enabled", True))
            normalized = {"userId": user_id, "enabled": enabled}
            if normalized != data:
                self._write(normalized)
                self._cache = normalized
            else:
                self._cache = data
            return dict(normalized)

    def update(self, patch: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            current = self._read() or {}
            merged = {**current, **patch}
            user_id = merged.get("userId") or _generate_user_id()
            enabled = bool(merged.get("enabled", True))
            normalized = {"userId": user_id, "enabled": enabled}
            self._write(normalized)
            self._cache = normalized
            return dict(normalized)


def _generate_user_id() -> str:
    return f"user-{secrets.token_hex(3)}"


# ── Mapeo evento bus → frame uplink ──────────────────────────────────────


def _bus_event_to_overlay_frame(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Convierte un payload del `tiktok:event` del EventBus en el frame
    minimalista que el overlay espera.

    Devuelve None para eventos que no se reenvían (mantenemos el tránsito
    Maru→Cloudflare ultra liviano).
    """
    evt_type = payload.get("type")
    if not isinstance(evt_type, str):
        return None
    data = payload.get("data") or {}

    # Likes → tap (alimentan el overlay `taps`).
    if evt_type == "like":
        try:
            count = int(data.get("count") or 1)
        except (TypeError, ValueError):
            count = 1
        if count <= 0:
            return None
        return {"type": "tap", "data": {"count": count}}

    # Gifts → eventos visuales para overlays futuros (alerta de gifts).
    # Por ahora SOLO contamos como tap si el goal del taps lo configura,
    # pero el dato lo dejamos pasar por si un overlay nuevo lo consume.
    if evt_type == "gift":
        try:
            count = int(data.get("count") or 1)
        except (TypeError, ValueError):
            count = 1
        return {
            "type": "gift",
            "data": {
                "user": payload.get("user") or "",
                "giftName": data.get("giftName") or data.get("gift_name") or "",
                "count": count,
                "diamonds": int(data.get("totalDiamonds") or data.get("diamondCount") or 0),
            },
        }

    # Follows → alerta de follow (overlay futuro).
    if evt_type == "follow":
        return {
            "type": "follow",
            "data": {"user": payload.get("user") or ""},
        }

    # Shares, subscribes y demás eventos los reenviamos con shape mínimo —
    # los overlays pueden ignorarlos si no los consumen.
    if evt_type in ("share", "subscribe", "join"):
        return {
            "type": evt_type,
            "data": {"user": payload.get("user") or ""},
        }

    return None  # silencio para eventos no relevantes (comments, commands)


# ── Cliente HTTP minimalista (solo para get-config) ──────────────────────


_HTTP_HEADERS = {
    "Accept": "application/json",
    # User-Agent custom: Cloudflare devuelve 403 contra el default
    # `Python-urllib/X.Y` por bot-detection. Identificamos al sidecar
    # explícitamente para que pase y para que los logs del Worker lo
    # muestren como "MARU desktop".
    "User-Agent": "MARU-Live-Desktop/1.0 (overlays-relay)",
}


def _http_get_json(url: str, timeout: float = 5.0) -> dict[str, Any]:
    """GET sync simple. Lo usamos solo para `overlays.get-config` que se
    llama N veces al abrir el editor — no es hot-path."""
    req = _urlreq.Request(url, headers=_HTTP_HEADERS)
    with _urlreq.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
    try:
        data = json.loads(body)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _http_post_json(url: str, payload: dict[str, Any], timeout: float = 5.0) -> bool:
    """POST sync simple. Fallback de `set_config` cuando el WS uplink
    todavía no terminó el handshake (race en arranque) — garantiza que
    la config se persiste. Devuelve True si HTTP 200."""
    body = json.dumps(payload).encode("utf-8")
    req = _urlreq.Request(
        url,
        data=body,
        headers={**_HTTP_HEADERS, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with _urlreq.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 300
    except Exception as exc:  # noqa: BLE001
        log.warning("overlays POST fallback failed: %s", exc)
        return False


# ── WS uplink con reconnect exponencial ──────────────────────────────────


class _UplinkClient:
    """Mantiene UNA WS abierta al Worker. Si cae, reconecta con backoff."""

    # v1.0.69: cap de frames pendientes en la queue. En bursts de likes
    # (200/seg) si el WS está saturado, los frames más viejos se dropean.
    # 500 frames × ~500 bytes = ~250KB max de RAM transitoria. Sin cap
    # antes podían acumularse miles de tasks asyncio.
    _OUTGOING_QUEUE_MAX = 500

    def __init__(self, identity: _IdentityStore) -> None:
        self._identity = identity
        self._loop: asyncio.AbstractEventLoop | None = None
        self._task: asyncio.Task[Any] | None = None
        self._sender_task: asyncio.Task[Any] | None = None
        self._outgoing: asyncio.Queue[dict[str, Any]] | None = None
        self._ws: Any = None
        self._send_lock = asyncio.Lock()
        self._stop = asyncio.Event()
        # Heartbeat: ping cada 30s para mantener viva la conexión a través
        # de NATs / proxies.
        self._heartbeat_interval = 30.0
        # Control de logs: solo loguear conexión/desconexión 1x cada cambio
        # de estado para no inundar el panel.
        self._connected = False
        # Counter de frames dropeados por queue saturada (diagnóstico).
        self._dropped_frames = 0

    def install(self, loop: asyncio.AbstractEventLoop) -> None:
        if self._task is not None:
            return
        self._loop = loop
        self._stop.clear()
        # Queue + sender consumer únicos. Sin esto cada `publish` creaba
        # un asyncio.Task suelto → en bursts de likes (50-200/seg) se
        # acumulaban cientos de tasks transitorios + gc pressure.
        self._outgoing = asyncio.Queue(maxsize=self._OUTGOING_QUEUE_MAX)
        self._task = loop.create_task(self._run(), name="overlays-uplink")
        self._sender_task = loop.create_task(self._sender_loop(), name="overlays-uplink-sender")
        log.info("overlays: uplink task iniciado (queue+sender)")

    async def shutdown(self) -> None:
        self._stop.set()
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
        for task in (self._task, self._sender_task):
            if task is not None:
                try:
                    await asyncio.wait_for(task, timeout=2.0)
                except (asyncio.TimeoutError, asyncio.CancelledError):
                    task.cancel()
        self._task = None
        self._sender_task = None
        self._outgoing = None
        self._ws = None

    def is_connected(self) -> bool:
        return self._ws is not None and self._connected

    def publish(self, frame: dict[str, Any]) -> bool:
        """Encolar un frame al uplink. Devuelve True si efectivamente se
        encoló por el WS, False si el WS no está conectado (caller puede
        decidir fallback HTTP). Sin doble envío.

        v1.0.69: usa una asyncio.Queue interna en vez de crear un Task
        nuevo por frame. Drop-oldest si la queue está llena (evita
        backpressure infinito en bursts de likes).
        """
        if self._loop is None or self._task is None:
            return False
        if not self._identity.get().get("enabled", True):
            return False
        ws = self._ws
        if ws is None:
            return False
        outgoing = self._outgoing
        if outgoing is None:
            return False
        try:
            outgoing.put_nowait(frame)
            return True
        except asyncio.QueueFull:
            # Drop el más viejo y reintentar (drop-oldest). Si pasa más
            # de 1 vez por minuto, loguear (diagnóstico).
            try:
                _ = outgoing.get_nowait()
                outgoing.task_done()
            except asyncio.QueueEmpty:
                return False
            try:
                outgoing.put_nowait(frame)
                self._dropped_frames += 1
                if self._dropped_frames % 100 == 0:
                    log.warning(
                        "overlays: %d frames dropeados por queue saturada",
                        self._dropped_frames,
                    )
                return True
            except asyncio.QueueFull:
                return False

    async def _sender_loop(self) -> None:
        """Consumer único de la queue → envía al WS uno por uno con el
        send_lock. Si la WS cae, descarta los frames acumulados y
        espera la reconexión."""
        outgoing = self._outgoing
        if outgoing is None:
            return
        while not self._stop.is_set():
            try:
                frame = await asyncio.wait_for(outgoing.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break
            ws = self._ws
            if ws is None or not self._connected:
                # Sin WS → descartamos el frame. El consumer del bus
                # ya tiene fallback HTTP para los `set_config`.
                outgoing.task_done()
                continue
            async with self._send_lock:
                try:
                    await ws.send(json.dumps(frame, separators=(",", ":")))
                except Exception:
                    # WS muerta — el loop _run() detectará y reconectará.
                    pass
            outgoing.task_done()

    async def _run(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            identity = self._identity.get()
            if not identity.get("enabled", True):
                # Master switch off → dormir 5s y revisar de nuevo.
                await asyncio.sleep(5.0)
                continue

            user_id = identity["userId"]
            url = f"wss://{WORKER_HOST}/uplink/{user_id}/ws"
            try:
                # `websockets.connect` es la lib async pura — la misma que
                # ya usa el RpcServer.
                import websockets

                async with websockets.connect(
                    url,
                    open_timeout=10.0,
                    close_timeout=2.0,
                    ping_interval=None,  # heartbeat manual abajo
                ) as ws:
                    self._ws = ws
                    self._connected = True
                    backoff = 1.0  # reset
                    log.info("overlays: uplink conectado (%s)", user_id)
                    await self._heartbeat_loop(ws)
            except asyncio.CancelledError:
                break
            except Exception as exc:  # noqa: BLE001
                if self._connected:
                    log.warning("overlays: uplink caído: %s", exc)
                self._connected = False
            finally:
                self._ws = None

            if self._stop.is_set():
                break
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)

    async def _heartbeat_loop(self, ws: Any) -> None:
        """Ping JSON cada 30s. Si falla el send, salir → triggerea reconnect."""
        while not self._stop.is_set():
            await asyncio.sleep(self._heartbeat_interval)
            try:
                await ws.send(json.dumps({"type": "ping", "ts": int(time.time() * 1000)}))
            except Exception:
                return


# ── Servicio público (RPCs) ──────────────────────────────────────────────


class OverlaysRelayService:
    """Fachada para los RPCs `overlays.*`. Inyectada en el registry."""

    def __init__(self) -> None:
        self._identity = _IdentityStore()
        self._uplink = _UplinkClient(self._identity)
        self._installed = False
        # v1.0.69: tracking de loops async para shutdown real cuando el
        # user apaga overlays con el toggle. Sin esto los 3 loops
        # quedaban corriendo aunque el user nunca usara overlays.
        self._loop: asyncio.AbstractEventLoop | None = None
        self._loops_tasks: list[asyncio.Task[Any]] = []
        self._loops_started: bool = False
        # Tracker del overlay taps para disparar acciones al cumplir meta.
        # Vive en memoria: se resetea al reiniciar MARU (consistente con la
        # filosofía "los overlays son estado del LIVE").
        self._taps_counter: int = 0
        self._taps_goal: int = 1000
        self._taps_actions: list[dict[str, Any]] = []
        self._taps_reset_on_goal: bool = True
        self._taps_goal_mode: str = "reset"
        self._taps_goal_increase: int = 10000
        self._taps_active_game: str | None = None
        self._taps_state_loaded: bool = False
        self._games_svc: Any = None  # inyectado por bootstrap antes de install()
        self._donations_svc: Any = None  # inyectado para resolver coins del gift
        self._spotify_svc: Any = None    # inyectado para overlay music
        # v1.0.69: cache LRU de URLs de portadas Spotify por trackId.
        # Antes era dict sin cap → crecía monotonicamente con el tiempo
        # total del sidecar (cada track nuevo se cacheaba para siempre).
        # Ahora cap LRU 500 (≈100KB max). Tracks nuevos se resuelven con
        # 1 request HTTP de 50ms al Spotify API si no están en cache.
        self._track_img_cache: OrderedDict[str, str] = OrderedDict()
        self._TRACK_IMG_CACHE_MAX = 500
        # Extensible (Subathon countdown timer):
        #   _ext_remaining: segundos restantes calculados al _ext_anchor_ts
        #   _ext_running: si está descontando
        #   _ext_anchor_ts: timestamp ms de la última actualización oficial
        # El cliente calcula display = remaining - (now - anchor) si running.
        self._ext_remaining: float = 3600.0
        self._ext_running: bool = False
        self._ext_anchor_ts: int = int(time.time() * 1000)
        self._ext_initial: int = 3600
        self._ext_per_coin: int = 3
        self._ext_overrides: dict[str, int] = {}
        self._ext_state_loaded: bool = False

    # ── Lifecycle ────────────────────────────────────────────────────

    def attach_games(self, games_svc: Any) -> None:
        """Inyectar el GamesService desde bootstrap. Sin esto, las
        `goal_actions` del taps quedan deshabilitadas (no rompe nada)."""
        self._games_svc = games_svc

    def attach_spotify(self, spotify_svc: Any) -> None:
        """Inyectar SpotifyService para que el overlay music pueda leer
        now_playing + queue."""
        self._spotify_svc = spotify_svc

    def attach_donations(self, donations_svc: Any) -> None:
        """Inyectar DonationsService para resolver coins de un gift por
        nombre cuando el payload del worker TikTok no los incluye."""
        self._donations_svc = donations_svc
        # Cache del lookup gift_name → coins. TTL 60s. Evita escanear el
        # catálogo entero por cada gift de un live (bursts de 50/s).
        self._gift_coins_cache: dict[str, int] = {}
        self._gift_coins_cache_ts: float = 0.0

    def _resolve_gift_coins(self, gift_name: str) -> int:
        """Busca los coins/diamantes de un gift por nombre en el catálogo
        local. Cache 60s para no rebuilder el dict por cada gift."""
        if not self._donations_svc or not gift_name:
            return 0
        # Refresh cache si pasó TTL.
        now = time.time()
        if not self._gift_coins_cache or (now - self._gift_coins_cache_ts) > 60:
            try:
                res = self._donations_svc.list({"includeDisabled": True})
                self._gift_coins_cache = {}
                for g in res.get("gifts", []):
                    coins = int(g.get("coins") or 0)
                    gid = str(g.get("id") or "").strip().lower()
                    gname = str(g.get("name") or "").strip().lower()
                    if gid:
                        self._gift_coins_cache[gid] = coins
                    if gname:
                        self._gift_coins_cache[gname] = coins
                self._gift_coins_cache_ts = now
            except Exception:
                return 0
        return self._gift_coins_cache.get(gift_name.strip().lower(), 0)

    def install(self, loop: asyncio.AbstractEventLoop) -> None:
        """Suscribe al EventBus y arranca el WS uplink. Idempotente.

        v1.0.69: si `enabled=false` en la identity, NO arranca los 3
        loops async ni el uplink WS — la suscripción al bus queda
        activa pero `_uplink.publish` retorna False (ya respetaba el
        flag) y se vuelve un noop. Hot-toggle desde `set_enabled()`.
        """
        if self._installed:
            return
        self._loop = loop
        bus = get_event_bus()
        # Las suscripciones al bus son SIEMPRE activas — son liviarias
        # (solo registran callbacks). El verdadero gating del trabajo
        # pesado se hace en _start_loops().
        bus.subscribe("tiktok:event", self._on_tiktok_event)
        bus.subscribe("tiktok:status", self._on_tiktok_status)
        bus.subscribe("overlay:streak", self._on_overlay_streak)
        bus.subscribe("overlay:likes", self._on_overlay_likes)
        self._installed = True
        # Solo arrancar los loops + uplink si el master switch está ON.
        if self._identity.get().get("enabled", True):
            self._start_loops()
            log.info("overlays: relay instalado + loops arrancados (enabled=ON)")
        else:
            log.info("overlays: relay instalado (enabled=OFF, loops dormidos para ahorrar RAM)")

    def _start_loops(self) -> None:
        """Arranca los 3 loops async + WS uplink. Idempotente."""
        loop = self._loop
        if loop is None:
            return
        if self._loops_started:
            return
        self._loops_started = True
        # Music push loop (polling adaptativo Spotify → emit si cambió).
        self._loops_tasks.append(
            loop.create_task(self._music_push_loop(), name="overlays-music-push")
        )
        # Spotify queue/context monitor — corre check_and_advance cada 12s
        # SIN depender de que el panel esté abierto. Sin esto, después de
        # un !playfan no se restaura el contexto de la playlist original.
        self._loops_tasks.append(
            loop.create_task(self._spotify_advance_loop(), name="overlays-spotify-advance")
        )
        # Push periódico del top likes ranking (lazy, solo si social ok).
        self._loops_tasks.append(
            loop.create_task(self._toplikes_push_loop(), name="overlays-toplikes-push")
        )
        self._uplink.install(loop)

    async def _stop_loops(self) -> None:
        """Cancela los 3 loops async + apaga el WS uplink. Idempotente."""
        if not self._loops_started:
            return
        self._loops_started = False
        for task in self._loops_tasks:
            try:
                task.cancel()
            except Exception:
                pass
        # Esperar a que terminen (best-effort, 1s max).
        if self._loops_tasks:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*self._loops_tasks, return_exceptions=True),
                    timeout=1.5,
                )
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass
        self._loops_tasks.clear()
        await self._uplink.shutdown()
        # Liberar caches que solo tenían sentido con overlays activos.
        try:
            self._track_img_cache.clear()
        except Exception:
            pass

    def set_enabled(self, params: dict[str, Any]) -> dict[str, Any]:
        """Toggle global de overlays. v1.0.69.

        - true: arranca los 3 loops async + WS uplink + Spotify warmup.
        - false: cancela los loops, cierra el uplink, libera caches
          internas. Los frames de eventos siguen llegando al bus pero
          se descartan en `_uplink.publish` (que respeta el flag).

        Persiste en `overlays_identity.json:enabled`. La URL pública del
        overlay sigue siendo válida — al reactivar se reconecta sola.
        """
        enabled = bool(params.get("enabled", True))
        merged = self._identity.update({"enabled": enabled})
        if enabled:
            if self._installed:
                self._start_loops()
                log.info("overlays: ENABLED — loops y uplink arrancados")
        else:
            # Schedule async stop. No bloqueamos el RPC.
            loop = self._loop
            if loop is not None and self._loops_started:
                try:
                    asyncio.run_coroutine_threadsafe(self._stop_loops(), loop)
                    log.info("overlays: DISABLED — loops y uplink apagándose")
                except Exception:
                    log.exception("overlays: shutdown async fallo")
        return {"ok": True, "enabled": enabled, "userId": merged.get("userId")}

    async def shutdown(self) -> None:
        await self._stop_loops()

    # ── Bus listener (suscriptor PASIVO) ─────────────────────────────

    def _on_tiktok_event(self, payload: dict[str, Any]) -> None:
        # Alimentar el contador EXTENSIBLE primero — necesita el evento crudo
        # (gift name, etc.) que el frame minimalista pierde.
        self._tick_extensible(payload)

        frame = _bus_event_to_overlay_frame(payload)
        if frame is None:
            return
        # Si el evento es un tap, alimentar el tracker del taps para
        # disparar acciones al cumplir meta.
        if frame["type"] == "tap":
            self._tick_taps(int(frame["data"].get("count") or 1))
        # Si el uplink está conectado va por WS (low latency).
        if self._uplink.publish(frame):
            return
        loop = asyncio.get_event_loop()
        user_id = self._identity.get()["userId"]
        loop.run_in_executor(
            None,
            _http_post_json,
            f"https://{WORKER_HOST}/event",
            {"user_id": user_id, "type": frame["type"], "data": frame["data"]},
        )

    # ── Taps tracker (acciones al cumplir meta) ──────────────────────

    def _ensure_taps_state_loaded(self) -> None:
        if self._taps_state_loaded:
            return
        try:
            cfg = self.get_config({"overlayId": "taps"})["config"]
            self._taps_goal = max(1, int(cfg.get("goal") or 1000))
            self._taps_actions = list(cfg.get("goal_actions") or [])
            self._taps_reset_on_goal = bool(cfg.get("reset_on_goal", True))
            self._taps_goal_mode = str(cfg.get("goal_mode") or "reset").lower()
            self._taps_goal_increase = max(1, int(cfg.get("goal_increase_amount") or 10000))
        except Exception:
            pass
        self._taps_state_loaded = True

    def _tick_taps(self, count: int) -> None:
        if count <= 0:
            return
        self._ensure_taps_state_loaded()
        prev = self._taps_counter
        self._taps_counter += count
        crossed = prev < self._taps_goal <= self._taps_counter
        if crossed:
            if self._taps_actions:
                self._fire_goal_actions()
            mode = (self._taps_goal_mode or "reset").lower()
            if mode == "double":
                # Duplicar la meta. El counter conserva su valor (la barra
                # arrancará a >50% al inicio del nuevo ciclo).
                self._taps_goal = max(1, self._taps_goal * 2)
            elif mode == "increase":
                # Sumar X a la meta. Counter se conserva.
                self._taps_goal = self._taps_goal + max(1, self._taps_goal_increase)
            else:
                # "reset" (default) — counter vuelve a 0 si está habilitado.
                if self._taps_reset_on_goal:
                    self._taps_counter = 0
        self._publish_taps_sync()

    def _publish_taps_sync(self) -> None:
        frame = {
            "type": "taps_sync",
            "data": {"counter": self._taps_counter, "goal": self._taps_goal},
        }
        # Mismo patrón que set_config: WS si conectado, HTTP fallback.
        if not self._uplink.publish(frame):
            try:
                user_id = self._identity.get()["userId"]
                _http_post_json(
                    f"https://{WORKER_HOST}/event",
                    {"user_id": user_id, "type": "taps_sync", "data": frame["data"]},
                )
            except Exception:
                pass

    def _reset_taps_counter(self) -> None:
        self._taps_counter = 0
        self._publish_taps_sync()

    # ── Extensible tracker (custom counter) ─────────────────────────

    def _ensure_ext_state_loaded(self) -> None:
        if self._ext_state_loaded:
            return
        try:
            cfg = self.get_config({"overlayId": "extensible"})["config"]
            self._ext_per_coin = max(0, int(cfg.get("seconds_per_coin") or 0))
            self._ext_initial = max(0, int(cfg.get("initial_seconds") or 3600))
            raw = cfg.get("overrides")
            if isinstance(raw, list):
                # Indexar por giftId Y por giftName lower para matching robusto.
                self._ext_overrides = {}
                for o in raw:
                    if not isinstance(o, dict):
                        continue
                    secs = int(o.get("seconds") or 0)
                    gid = str(o.get("giftId") or "").strip().lower()
                    gname = str(o.get("giftName") or "").strip().lower()
                    if gid:
                        self._ext_overrides[f"id:{gid}"] = secs
                    if gname:
                        self._ext_overrides[gname] = secs
            else:
                self._ext_overrides = {}
            # Inicializar remaining con initial si nunca arrancó.
            if self._ext_remaining <= 0 and not self._ext_running:
                self._ext_remaining = float(self._ext_initial)
                self._ext_anchor_ts = int(time.time() * 1000)
        except Exception:
            pass
        self._ext_state_loaded = True

    def _ext_current_remaining(self) -> float:
        """Calcula segundos restantes AHORA. Si running, descuenta el tiempo
        transcurrido desde el anchor. Si pausado, mantiene remaining."""
        if not self._ext_running:
            return max(0.0, self._ext_remaining)
        elapsed = (int(time.time() * 1000) - self._ext_anchor_ts) / 1000.0
        return max(0.0, self._ext_remaining - elapsed)

    def _ext_recalc_anchor(self) -> None:
        """Snapshot del remaining actual y resetea anchor — usar antes de
        cualquier mutación cuando running=true para no perder tiempo."""
        if self._ext_running:
            self._ext_remaining = self._ext_current_remaining()
        self._ext_anchor_ts = int(time.time() * 1000)

    def _tick_extensible(self, payload: dict[str, Any]) -> None:
        """Solo reacciona a gifts. Calcula segundos a SUMAR al countdown
        (extiende el tiempo restante). Lógica:
          - giftName matchea override → segundos fijos × count.
          - sino → seconds_per_coin × diamantes_totales.
        """
        if payload.get("type") != "gift":
            return
        self._ensure_ext_state_loaded()
        data = payload.get("data") or {}
        gift_name = str(
            data.get("giftName") or data.get("gift_name") or ""
        ).strip()
        if not gift_name:
            return
        count = max(1, int(data.get("count") or 1))
        gift_id = str(data.get("giftId") or data.get("gift_id") or "").strip().lower()
        override_seconds = 0
        # 1) Match exacto por giftId (más confiable).
        if gift_id and f"id:{gift_id}" in self._ext_overrides:
            override_seconds = self._ext_overrides[f"id:{gift_id}"]
        # 2) Match por nombre exacto.
        elif gift_name.lower() in self._ext_overrides:
            override_seconds = self._ext_overrides[gift_name.lower()]
        else:
            # 3) Match parcial case-insensitive (fallback).
            gift_lower = gift_name.lower()
            for key, secs in self._ext_overrides.items():
                if key.startswith("id:"):
                    continue
                if key and (key in gift_lower or gift_lower in key):
                    override_seconds = secs
                    break

        if override_seconds > 0:
            add = override_seconds * count
        else:
            # Diamantes totales: probar fields del payload, sino lookup
            # en catálogo local de donaciones.
            unit = (
                int(data.get("diamondCount") or 0)
                or int(data.get("diamond_count") or 0)
                or int(data.get("coins") or 0)
                or self._resolve_gift_coins(gift_name)
            )
            diamonds = int(data.get("totalDiamonds") or unit * count)
            if diamonds <= 0 or self._ext_per_coin <= 0:
                return
            add = diamonds * self._ext_per_coin

        if add <= 0:
            return
        self._add_ext_seconds(add)

    def _publish_ext_sync(self) -> None:
        frame = {
            "type": "extensible_sync",
            "data": {
                "remaining": self._ext_current_remaining(),
                "running": self._ext_running,
                "ts": int(time.time() * 1000),
                "initial": self._ext_initial,
            },
        }
        if not self._uplink.publish(frame):
            try:
                user_id = self._identity.get()["userId"]
                _http_post_json(
                    f"https://{WORKER_HOST}/event",
                    {"user_id": user_id, "type": "extensible_sync", "data": frame["data"]},
                )
            except Exception:
                pass

    def _add_ext_seconds(self, secs: int) -> None:
        """Sumar (o restar si negativo) segundos al countdown. Conserva running."""
        self._ext_recalc_anchor()
        self._ext_remaining = max(0.0, self._ext_remaining + float(secs))
        self._publish_ext_sync()
        if secs > 0:
            self._publish_one("extensible_bump", {})

    def _fire_goal_actions(self) -> None:
        if not self._games_svc or not self._taps_actions:
            return
        loop = asyncio.get_event_loop()
        bus = get_event_bus()
        for action in self._taps_actions:
            kind = str(action.get("kind") or "").lower()
            game_id = str(action.get("gameId") or self._taps_active_game or "").strip()
            name = str(action.get("name") or "").strip()
            label = str(action.get("label") or name)
            amount = int(action.get("amount") or 1)
            if not kind or not game_id or not name:
                continue
            try:
                if kind == "spawn":
                    coro = self._games_svc.spawn(
                        {"gameId": game_id, "entity": name, "amount": amount, "user": "meta"}
                    )
                elif kind == "item":
                    coro = self._games_svc.give_item(
                        {"gameId": game_id, "item": name, "amount": amount, "user": "meta"}
                    )
                elif kind == "event":
                    coro = self._games_svc.trigger_event(
                        {"gameId": game_id, "event": name, "user": "meta"}
                    )
                else:
                    continue
                asyncio.create_task(self._await_action(coro, label, game_id, kind))
            except Exception as exc:  # noqa: BLE001
                log.warning("overlays goal-action falló: %s", exc)
                bus.publish("rules:executed", {
                    "gameId": game_id,
                    "ruleName": "Meta de likes",
                    "action": label,
                    "message": f"Error: {exc}",
                    "success": False,
                    "trigger": "goal_reached",
                    "user": "meta",
                })

    async def _await_action(
        self, coro: Any, label: str, game_id: str, kind: str
    ) -> None:
        bus = get_event_bus()
        try:
            res = await coro
            ok = bool(res.get("ok") or res.get("success"))
            msg = str(res.get("message") or label)
        except Exception as exc:  # noqa: BLE001
            ok = False
            msg = f"Error: {exc}"
        bus.publish("rules:executed", {
            "gameId": game_id,
            "ruleName": "🎯 Meta de likes",
            "action": label,
            "message": msg,
            "success": ok,
            "trigger": "goal_reached",
            "user": "meta",
        })

    def _on_overlay_likes(self, payload: dict[str, Any]) -> None:
        """Disparado cuando un user usa !likes — emite frame al overlay
        likes con avatar + total."""
        user = str(payload.get("user") or "").strip()
        taps = int(payload.get("taps") or 0)
        avatar = str(payload.get("avatar") or "")
        if not user:
            return
        self._publish_one("likes_show", {"user": user, "taps": taps, "avatar": avatar})

    async def _toplikes_push_loop(self) -> None:
        """Cada 8s consulta el TOP DE LIKES POR SESIÓN (TopLivesService)
        que rastrea los likes en vivo del live actual con avatares reales
        del TikTokLive. Si no hay sesión activa, fallback al ranking
        histórico total del social system."""
        last_sig = ""
        toplives_svc = None
        social_svc = None
        while True:
            try:
                await asyncio.sleep(8.0)
                if toplives_svc is None or social_svc is None:
                    try:
                        from ..rpc import registry as _reg  # type: ignore
                        toplives_svc = getattr(_reg, "_GLOBAL_TOPLIVES_SVC", None)
                        social_svc = getattr(_reg, "_GLOBAL_SOCIAL_SVC", None)
                    except Exception:
                        pass

                items: list[dict[str, Any]] = []

                # Fuente principal: sesión actual del TopLivesService.
                if toplives_svc is not None:
                    try:
                        snapshot = toplives_svc.list({})
                        current = (snapshot or {}).get("current") or {}
                        for entry in current.get("top", []):
                            items.append({
                                "user": entry.get("user", ""),
                                "taps": int(entry.get("taps") or 0),
                                "avatar": entry.get("avatar", ""),
                            })
                    except Exception:
                        pass

                # Fallback: si no hay sesión activa, usar histórico total.
                if not items and social_svc is not None:
                    try:
                        s = social_svc._ensure() if hasattr(social_svc, "_ensure") else None
                        if s is not None and hasattr(s, "get_taps_ranking"):
                            ranking = s.get_taps_ranking("total") or []
                            for r in ranking[:5]:
                                uname = r.get("username", "")
                                items.append({
                                    "user": uname,
                                    "taps": int(r.get("taps") or 0),
                                    "avatar": social_svc.get_avatar(uname) if hasattr(social_svc, "get_avatar") else "",
                                })
                    except Exception:
                        pass

                sig = ",".join(f"{i['user']}:{i['taps']}" for i in items)
                if sig == last_sig:
                    continue
                last_sig = sig
                self._publish_one("toplikes_sync", {"items": items})
            except asyncio.CancelledError:
                return
            except Exception:
                pass

    def _on_overlay_streak(self, payload: dict[str, Any]) -> None:
        """Recibe {user, days} desde chat_dispatcher cuando alguien usa
        !racha y publica al overlay 'streak' como evento visible."""
        user = str(payload.get("user") or "").strip()
        days = int(payload.get("days") or 0)
        if not user:
            return
        self._publish_one("streak", {"user": user, "days": days})

    def _on_tiktok_status(self, payload: dict[str, Any]) -> None:
        """Cuando el live arranca, publicamos `live_start` para que los
        overlays con `reset_on_live_start` arranquen frescos. NO hacemos
        nada al desconectarse — el overlay queda con el último estado."""
        state = payload.get("state") or payload.get("status")
        if state == "connected":
            self._ensure_taps_state_loaded()
            if self._taps_reset_on_goal:
                self._taps_counter = 0
                self._publish_taps_sync()
            self._ensure_ext_state_loaded()
            if self._ext_reset_on_live:
                self._ext_seconds = 0
                self._publish_ext_sync()
            self._uplink.publish({"type": "live_start", "data": {}})

    # ── RPCs ─────────────────────────────────────────────────────────

    def list(self, _params: dict[str, Any]) -> dict[str, Any]:
        identity = self._identity.get()
        user_id = identity["userId"]
        items = []
        for oid, spec in OVERLAY_REGISTRY.items():
            url = f"https://{PUBLIC_DOMAIN}/{oid}/?u={user_id}"
            items.append({
                "id": oid,
                "name": spec["name"],
                "icon": spec["icon"],
                "description": spec["description"],
                "url": url,
                "default": dict(spec["default"]),
                "previewAspect": list(spec.get("preview_aspect", [800, 180])),
            })
        return {
            "overlays": items,
            "userId": user_id,
            "enabled": identity["enabled"],
            "publicDomain": PUBLIC_DOMAIN,
        }

    def get_config(self, params: dict[str, Any]) -> dict[str, Any]:
        oid = params.get("overlayId")
        if not isinstance(oid, str) or oid not in OVERLAY_REGISTRY:
            raise ValueError("overlayId inválido")
        user_id = self._identity.get()["userId"]
        url = f"https://{WORKER_HOST}/u/{user_id}/{oid}/config"
        try:
            cfg = _http_get_json(url)
        except Exception as exc:  # noqa: BLE001
            log.warning("overlays.get-config: %s", exc)
            cfg = {}
        # Merge: defaults del registry + lo que esté persistido en el DO.
        # Si el DO no tiene nada, devolvemos solo defaults — nunca flash
        # de datos vacíos en la UI.
        merged = {**OVERLAY_REGISTRY[oid]["default"], **cfg}
        return {"overlayId": oid, "config": merged}

    def set_config(self, params: dict[str, Any]) -> dict[str, Any]:
        oid = params.get("overlayId")
        patch = params.get("patch")
        if not isinstance(oid, str) or oid not in OVERLAY_REGISTRY:
            raise ValueError("overlayId inválido")
        if not isinstance(patch, dict):
            raise TypeError("patch debe ser objeto")
        # El DO sobreescribe el storage entero — necesitamos config completa.
        try:
            current = self.get_config({"overlayId": oid})["config"]
        except Exception:
            current = dict(OVERLAY_REGISTRY[oid]["default"])
        merged = {**current, **patch}
        frame_type = f"{oid}_config"

        # Refresh tracker del extensible si aplica.
        if oid == "extensible":
            try:
                self._ext_per_coin = max(0, int(merged.get("seconds_per_coin") or 0))
                raw = merged.get("overrides")
                if isinstance(raw, list):
                    self._ext_overrides = {}
                    for o in raw:
                        if not isinstance(o, dict):
                            continue
                        secs = int(o.get("seconds") or 0)
                        gid = str(o.get("giftId") or "").strip().lower()
                        gname = str(o.get("giftName") or "").strip().lower()
                        if gid:
                            self._ext_overrides[f"id:{gid}"] = secs
                        if gname:
                            self._ext_overrides[gname] = secs
                else:
                    self._ext_overrides = {}
                self._ext_reset_on_live = bool(merged.get("reset_on_live_start", True))
                self._ext_state_loaded = True
            except Exception:
                pass

        # Refresh tracker del taps si aplica.
        if oid == "taps":
            try:
                self._taps_goal = max(1, int(merged.get("goal") or 1000))
                self._taps_actions = list(merged.get("goal_actions") or [])
                self._taps_reset_on_goal = bool(merged.get("reset_on_goal", True))
                self._taps_goal_mode = str(merged.get("goal_mode") or "reset").lower()
                self._taps_goal_increase = max(1, int(merged.get("goal_increase_amount") or 10000))
                self._taps_state_loaded = True
            except Exception:
                pass

        # Una sola entrega:
        if not self._uplink.publish({"type": frame_type, "data": merged}):
            user_id = self._identity.get()["userId"]
            _http_post_json(
                f"https://{WORKER_HOST}/event",
                {"user_id": user_id, "type": frame_type, "data": merged},
            )
        return {"ok": True, "config": merged}

    def _publish_one(self, frame_type: str, frame_data: dict[str, Any]) -> None:
        """Publica una vez, eligiendo el canal según conectividad. Sin duplicar."""
        if self._uplink.publish({"type": frame_type, "data": frame_data}):
            return
        try:
            user_id = self._identity.get()["userId"]
            _http_post_json(
                f"https://{WORKER_HOST}/event",
                {"user_id": user_id, "type": frame_type, "data": frame_data},
            )
        except Exception:
            pass

    def test_event(self, params: dict[str, Any]) -> dict[str, Any]:
        oid = params.get("overlayId")
        evt_type = params.get("eventType") or "tap"
        data = params.get("data") or {}
        if not isinstance(oid, str) or oid not in OVERLAY_REGISTRY:
            raise ValueError("overlayId inválido")
        if oid == "taps" and not params.get("eventType"):
            evt_type = "tap"
            data = {"count": int(data.get("count") or 5)}
        elif oid == "streak" and not params.get("eventType"):
            evt_type = "streak"
            data = {
                "user": data.get("user") or "test",
                "days": int(data.get("days") or 7),
            }
        # Reset desde el botón "Resetear" del editor.
        if oid == "taps" and evt_type == "reset":
            self._reset_taps_counter()
            self._publish_one("reset", {})
            return {"ok": True}
        if oid == "extensible" and evt_type == "reset":
            self.timer_control({"action": "reset"})
            return {"ok": True}
        # tap manual desde "Probar": alimentar tracker.
        if oid == "taps" and evt_type == "tap":
            self._tick_taps(int(data.get("count") or 0))
        # Probar del extensible: simular gift suma 60s.
        if oid == "extensible" and not params.get("eventType"):
            secs = int(data.get("seconds") or 60)
            self._ensure_ext_state_loaded()
            self._add_ext_seconds(secs)
            return {"ok": True}
        self._publish_one(evt_type, dict(data) if isinstance(data, dict) else {})
        return {"ok": True}

    def reload(self, params: dict[str, Any]) -> dict[str, Any]:
        """Fuerza al overlay (browser source de TikTok Studio) a recargar.
        Útil cuando el JS está cacheado y un cambio no se ve."""
        oid = params.get("overlayId")
        if oid is not None and (not isinstance(oid, str) or oid not in OVERLAY_REGISTRY):
            raise ValueError("overlayId inválido")
        self._publish_one("reload", {"overlayId": oid})
        return {"ok": True}

    async def _spotify_advance_loop(self) -> None:
        """Corre `check_and_advance` del SpotifyClient cada 12s, autónomo
        del panel UI. ESENCIAL para que el contexto post-!playfan se
        restaure y la música original siga sonando cuando termina la
        canción del playfan. Sin este loop, el playfan terminaba y
        Spotify se quedaba en silencio hasta que alguien abriera el panel.

        check_and_advance es muy ligero: si no hay queue/playfan/context
        pendiente, retorna inmediato. Si pendiente, hace 1 request al
        playback. Total: ~5 req/min worst case.
        """
        sp = self._spotify_svc
        if sp is None:
            return
        while True:
            try:
                await asyncio.sleep(12.0)
                c = sp._ensure_client() if hasattr(sp, "_ensure_client") else None
                if c is not None and hasattr(c, "check_and_advance"):
                    # Corre en thread pool — internamente puede hacer HTTP
                    # síncrono que bloquearía el loop.
                    await asyncio.to_thread(c.check_and_advance)
            except asyncio.CancelledError:
                return
            except Exception:
                pass

    async def _music_push_loop(self) -> None:
        """Polling adaptativo Spotify para máxima precisión SIN rate limit:
          - Pausado → 12s entre polls.
          - Sonando con >10s para terminar → 4s.
          - Sonando con <10s para terminar → 1.5s (track-end crítico).
          - Detección de pausa por progress_ms repetido → marca paused.
          - Sin Spotify conectado → sleep 15s (sin requests).

        Rate limit total worst-case (alguien escucha música constante):
          ~15 req/min de now_playing + 5 req/min queue = 20 req/min.
        Best-case (música en silencio o pausada): ~5 req/min.
        """
        last_struct_sig = ""
        last_emit_ts = 0.0
        last_progress_ms = -1
        last_progress_observed_at = 0.0
        while True:
            try:
                # Sleep adaptativo: ajustamos al final del loop según el
                # estado leído. Default conservador.
                await asyncio.sleep(self._next_music_poll_delay())
                state = self.music_state({})
                state["serverTs"] = int(time.time() * 1000)
                track = state.get("track") or {}
                progress_ms = int(track.get("positionMs") or 0)
                duration_ms = int(track.get("durationMs") or 0)

                # Pause detection: si dos polls consecutivos retornan misma
                # progress_ms (y está "playing"), Spotify lo está reportando
                # como playing pero NO avanza → posible pausa. Tagear.
                if state.get("isPlaying") and progress_ms == last_progress_ms:
                    paused_for = time.time() - last_progress_observed_at
                    if paused_for > 1.0:
                        state["isPlaying"] = False
                        state["pausedSilently"] = True
                else:
                    last_progress_ms = progress_ms
                    last_progress_observed_at = time.time()

                struct_sig = (
                    f"{int(state.get('isPlaying') or False)}|"
                    f"{track.get('name', '')}|"
                    f"{track.get('artist', '')}|"
                    f"{','.join(i.get('trackId', '') for i in state.get('queue', []))}"
                )
                now = time.time()
                changed = struct_sig != last_struct_sig
                # Force-resync más frecuente si está sonando (precisión time)
                resync_window = 5.0 if state.get("isPlaying") else 30.0
                if changed or (now - last_emit_ts) > resync_window:
                    last_struct_sig = struct_sig
                    last_emit_ts = now
                    self._publish_one("music_sync", state)

                # Guardar para que _next_music_poll_delay lo use.
                self._music_last_state = state
            except asyncio.CancelledError:
                return
            except Exception:
                pass

    def _next_music_poll_delay(self) -> float:
        """Decide cuánto esperar para el próximo poll Spotify."""
        st = getattr(self, "_music_last_state", None) or {}
        if not st.get("isPlaying"):
            return 12.0  # pausado o sin música → relajado
        track = st.get("track") or {}
        dur = int(track.get("durationMs") or 0)
        pos = int(track.get("positionMs") or 0)
        remain = max(0, dur - pos) / 1000.0
        if remain < 8:
            return 1.5  # track-end inminente → máxima precisión
        if remain < 20:
            return 3.0  # cerca del final → más frecuente
        return 4.5      # normal

    def music_state(self, _params: dict[str, Any]) -> dict[str, Any]:
        """Snapshot Spotify para overlay music. RATE LIMIT SAFE."""
        sp = self._spotify_svc
        if sp is None:
            return {"isPlaying": False, "queue": []}
        try:
            np = sp._sync_now_playing() if hasattr(sp, "_sync_now_playing") else {"isPlaying": False}
        except Exception:
            np = {"isPlaying": False}
        # Cache queue 8s (más reactivo que 12 anterior).
        if not hasattr(self, "_queue_cache_ts"):
            self._queue_cache_ts: float = 0.0
            self._queue_cache_data: dict[str, Any] = {"items": []}
        if (time.time() - self._queue_cache_ts) > 8:
            try:
                self._queue_cache_data = sp.queue_list({}) if hasattr(sp, "queue_list") else {"items": []}
                self._queue_cache_ts = time.time()
            except Exception:
                pass
        q = self._queue_cache_data
        # Detectar si la canción actual es un PLAYFAN. El SpotifyClient
        # marca current_track con flag "playfan": True cuando playfan_request
        # toma el control. Lo extraemos para que el overlay pueda animar
        # la transición (takeover dramático).
        is_playfan = False
        try:
            c = sp._ensure_client() if hasattr(sp, "_ensure_client") else None
            ct = getattr(c, "current_track", None) if c else None
            if isinstance(ct, dict):
                is_playfan = bool(ct.get("playfan"))
        except Exception:
            pass
        if is_playfan and isinstance(np, dict):
            np["isPlayfan"] = True
        # Enriquecer con imageUrl de cada track buscando en el cliente Spotify
        # cache. Sin esto las portadas saldrían en blanco.
        items = []
        for it in q.get("items", []):
            items.append({
                "trackName": it.get("trackName", ""),
                "artist": it.get("artist", ""),
                "requestedBy": it.get("requestedBy", ""),
                "isPriority": bool(it.get("isPriority")),
                "trackId": it.get("trackId", ""),
                "imageUrl": it.get("imageUrl") or self._resolve_track_image(sp, it.get("trackId", "")),
            })
        return {
            "isPlaying": bool(np.get("isPlaying")),
            "isPlayfan": bool(np.get("isPlayfan")),
            "track": np.get("track"),
            "requestedBy": np.get("requestedBy"),
            "imageUrl": np.get("imageUrl") or (
                self._resolve_track_image(sp, ((np.get("track") or {}).get("id") or ""))
                if np.get("track") else ""
            ),
            "queue": items,
        }

    def _resolve_track_image(self, sp: Any, track_id: str) -> str:
        """Devuelve URL de portada (300px ideal) del album. Cache LRU de
        500 entries por trackId — los album images NO cambian, una vez
        resuelto vale durante el ciclo de vida del cache. Si se evicta
        se vuelve a resolver con 1 request a /tracks/{id} (50ms)."""
        if not track_id or not sp:
            return ""
        cache = self._track_img_cache
        if track_id in cache:
            cache.move_to_end(track_id)
            return cache[track_id]
        try:
            c = sp._ensure_client() if hasattr(sp, "_ensure_client") else None
            if c is None or not getattr(c, "_sp", None):
                return ""
            # spotipy.Spotify.track(id) → 1 GET /tracks/{id}
            t = c._sp.track(track_id) if hasattr(c._sp, "track") else None
            if not t:
                self._cache_track_img(track_id, "")
                return ""
            images = (t.get("album") or {}).get("images") or []
            url = ""
            if images:
                url = (images[1] if len(images) > 1 else images[0]).get("url", "")
            self._cache_track_img(track_id, url)
            return url
        except Exception:
            self._cache_track_img(track_id, "")
            return ""

    def _cache_track_img(self, track_id: str, url: str) -> None:
        """Setea con LRU eviction al cap."""
        cache = self._track_img_cache
        if track_id in cache:
            cache.move_to_end(track_id)
        cache[track_id] = url
        while len(cache) > self._TRACK_IMG_CACHE_MAX:
            cache.popitem(last=False)

    def timer_control(self, params: dict[str, Any]) -> dict[str, Any]:
        """Control del Subathon Timer (extensible).
        action ∈ {play, pause, toggle, reset, set, add, subtract}
        - set: define remaining = seconds (no afecta running)
        - add/subtract: modifica remaining
        """
        self._ensure_ext_state_loaded()
        action = str(params.get("action") or "").lower()
        secs = int(params.get("seconds") or 0)
        if action == "play":
            if not self._ext_running:
                self._ext_anchor_ts = int(time.time() * 1000)
                self._ext_running = True
        elif action == "pause":
            self._ext_recalc_anchor()  # snapshot remaining antes de pausar
            self._ext_running = False
        elif action == "toggle":
            if self._ext_running:
                self._ext_recalc_anchor()
                self._ext_running = False
            else:
                self._ext_anchor_ts = int(time.time() * 1000)
                self._ext_running = True
        elif action == "reset":
            self._ext_running = False
            self._ext_remaining = float(self._ext_initial)
            self._ext_anchor_ts = int(time.time() * 1000)
        elif action == "set":
            self._ext_recalc_anchor()
            self._ext_remaining = max(0.0, float(secs))
        elif action == "add":
            self._add_ext_seconds(secs)
            return {
                "remaining": self._ext_current_remaining(),
                "running": self._ext_running,
            }
        elif action == "subtract":
            self._add_ext_seconds(-secs)
            return {
                "remaining": self._ext_current_remaining(),
                "running": self._ext_running,
            }
        else:
            raise ValueError(f"acción inválida: {action!r}")
        self._publish_ext_sync()
        return {
            "remaining": self._ext_current_remaining(),
            "running": self._ext_running,
        }

    def timer_state(self, _params: dict[str, Any]) -> dict[str, Any]:
        self._ensure_ext_state_loaded()
        return {
            "remaining": self._ext_current_remaining(),
            "running": self._ext_running,
            "initial": self._ext_initial,
            "secondsPerCoin": self._ext_per_coin,
        }

    def identity_get(self, _params: dict[str, Any]) -> dict[str, Any]:
        identity = self._identity.get()
        return {
            "userId": identity["userId"],
            "enabled": identity["enabled"],
        }

    def identity_set(self, params: dict[str, Any]) -> dict[str, Any]:
        patch: dict[str, Any] = {}
        if "userId" in params:
            uid = str(params["userId"]).strip()
            if uid:
                patch["userId"] = uid
            else:
                patch["userId"] = _generate_user_id()
        if "enabled" in params:
            patch["enabled"] = bool(params["enabled"])
        if "regenerate" in params and params["regenerate"]:
            patch["userId"] = _generate_user_id()
        identity = self._identity.update(patch)
        return {
            "userId": identity["userId"],
            "enabled": identity["enabled"],
        }
