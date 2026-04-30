"""Adapter `logs.*` — log estructurado con categorías + push events (G11).

Réplica del `EnhancedLogWidget` del MARU original (19 categorías + 8
filtros). Acá:
  - El sidecar parsea el archivo `sidecar.log` y devuelve entries
    estructurados `{ts, level, source, category, message}`.
  - **Detección automática de categoría** vía 12+ regex (paridad MARU
    `_detect_category`).
  - Push event `log:entry` cuando se publica desde el code (caller usa
    `LogsService.publish(...)` o el bridge `event_bus`).
  - Trim a 500 entries en memoria — el archivo de disco NO se trunca
    (lo maneja el logger handler).

Categorías canónicas (paridad MARU):
  system, tiktok, gift, follow, share, like, comment, command,
  rule, action, social, music, ia, tts, sound, profile, error,
  warn, debug.

Filter UI agrupa estas 19 en **8 grupos visuales** (chat, gifts,
social, rules, spotify, tts, sistema, errores) — la agrupación la hace
el cliente; el sidecar emite la categoría granular.
"""

from __future__ import annotations

import collections
import logging
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from ..event_bus import get_event_bus
from ..logger import get_logger
from ..runtime import LOGS_DIR

log = get_logger(__name__)
LOG_FILE = LOGS_DIR / "sidecar.log"
MAX_BUFFER = 500


# ── Detección de categoría (12 reglas regex, paridad MARU) ───────────────


_CATEGORY_RULES: list[tuple[re.Pattern[str], str]] = [
    # ORDEN IMPORTANTE: el primer match gana. Los más específicos arriba.
    # Comment (💬) PRIMERO porque su rank prefix puede contener
    # "[follower]", "[follow]", "[member]" etc. que harían matchear las
    # reglas de abajo. Los emoji al inicio del message son discriminantes
    # claros del tipo de evento.
    (re.compile(r"^💬"), "comment"),
    (re.compile(r"^🎨"), "emote"),
    (re.compile(r"^🎁|nueva donaci|donaci.n reactivada"), "gift"),
    (re.compile(r"^➕\s|nuevo seguidor"), "follow"),
    (re.compile(r"^📤|comparti.* el live"), "share"),
    (re.compile(r"^❤️|^❤"), "like"),
    (re.compile(r"^⌨️|^!"), "command"),
    (re.compile(r"^🐉|^📦|^⚡|spawn |give_item|trigger_event"), "action"),
    # Reglas más amplias después, solo aplican si los emoji-prefix no.
    (re.compile(r"\bgift\b|\bdonacion|\bregalo", re.IGNORECASE), "gift"),
    (re.compile(r"^[+➕]?\s*nuevo follow|seguidor", re.IGNORECASE), "follow"),
    (re.compile(r"\bshare\b|compartir", re.IGNORECASE), "share"),
    (re.compile(r"\blike\b|likes:", re.IGNORECASE), "like"),
    (re.compile(r"\bcomentario|\bcomment\b", re.IGNORECASE), "comment"),
    (re.compile(r"\bcommand\b|comando", re.IGNORECASE), "command"),
    (re.compile(r"\brule\b|regla|trigger.*action", re.IGNORECASE), "rule"),
    (re.compile(r"\bsocial\b|duelo|matrimonio|noviazgo", re.IGNORECASE), "social"),
    (re.compile(r"\bspotify|playfan|música|musica", re.IGNORECASE), "music"),
    (re.compile(r"\bia\b|claude|groq|gemini|openai", re.IGNORECASE), "ia"),
    (re.compile(r"\btts\b|voz|speak", re.IGNORECASE), "tts"),
    (re.compile(r"\bsound\b|sonido", re.IGNORECASE), "sound"),
    (re.compile(r"\bprofile\b|perfil", re.IGNORECASE), "profile"),
    (re.compile(r"\btiktok\b|🎵|live", re.IGNORECASE), "tiktok"),
]

# Mapeo de level → categoría fallback.
_LEVEL_TO_CATEGORY: dict[str, str] = {
    "DEBUG": "debug",
    "INFO": "system",
    "WARNING": "warn",
    "WARN": "warn",
    "ERROR": "error",
    "CRITICAL": "error",
}

VALID_CATEGORIES: tuple[str, ...] = (
    "system",
    "tiktok",
    "gift",
    "follow",
    "share",
    "like",
    "subscribe",
    "comment",
    "command",
    "emote",
    "rule",
    "action",
    "social",
    "music",
    "ia",
    "tts",
    "sound",
    "profile",
    "error",
    "warn",
    "debug",
)

# ── Parseo de líneas del archivo log ────────────────────────────────────


# Formato típico: "2026-04-27 22:32:25 [INFO   ] core.tts_engine: mensaje"
_LINE_RE = re.compile(
    r"^(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+"
    r"\[(?P<level>\w+)\s*\]\s+"
    r"(?P<source>[^:]+):\s+"
    r"(?P<message>.*)$"
)


def detect_category(message: str, level: str) -> str:
    """Detecta categoría por regex + fallback al level."""
    for pattern, cat in _CATEGORY_RULES:
        if pattern.search(message):
            return cat
    return _LEVEL_TO_CATEGORY.get(level.upper(), "system")


def parse_log_line(line: str, *, fallback_id: str = "") -> dict[str, Any]:
    """Convierte una línea del log a dict estructurado."""
    m = _LINE_RE.match(line)
    if m:
        ts_str = m.group("ts")
        try:
            ts = int(time.mktime(time.strptime(ts_str, "%Y-%m-%d %H:%M:%S")) * 1000)
        except ValueError:
            ts = int(time.time() * 1000)
        level = m.group("level").strip().upper()
        source = m.group("source").strip()
        message = m.group("message").strip()
    else:
        ts = int(time.time() * 1000)
        level = "INFO"
        source = "raw"
        message = line.strip()
    return {
        "id": fallback_id or f"l-{uuid.uuid4().hex[:10]}",
        "ts": ts,
        "level": level,
        "source": source,
        "category": detect_category(message, level),
        "message": message,
    }


# ── Service ──────────────────────────────────────────────────────────────


class LogsService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        # Buffer circular en memoria — last 500 entries.
        self._buffer: collections.deque[dict[str, Any]] = collections.deque(
            maxlen=MAX_BUFFER
        )
        self._stats: dict[str, int] = {c: 0 for c in VALID_CATEGORIES}
        self._stats_total = 0
        # Dedupe ventana corta — si publish() recibe 2 entries con MISMO
        # message+source dentro de 500ms, la 2da se ignora. Esto absorbe
        # races (ej. logs duplicados por re-install de LogsBridgeHandler
        # tras core_bridge.install).
        self._recent_keys: dict[str, float] = {}

    # ── RPC handlers ────────────────────────────────────────────────────

    def tail(self, params: dict[str, Any]) -> dict[str, Any]:
        """Devuelve las últimas N líneas RAW (legacy F0 — para compat)."""
        n = int(params.get("lines") or 200)
        n = max(10, min(n, 5000))
        level = params.get("level")
        if not LOG_FILE.exists():
            return {"lines": []}
        try:
            with LOG_FILE.open("r", encoding="utf-8", errors="replace") as fh:
                data = fh.read().splitlines()
        except Exception:
            return {"lines": []}
        tail = data[-n:]
        if isinstance(level, str) and level.upper() in {
            "DEBUG",
            "INFO",
            "WARNING",
            "ERROR",
        }:
            needle = f"[{level.upper()}]"
            tail = [line for line in tail if needle in line]
        return {"lines": tail}

    def list(self, params: dict[str, Any]) -> dict[str, Any]:
        """Devuelve el snapshot del buffer (entries estructuradas).

        Filtros opcionales:
          - `categories`: lista de categorías a incluir (default: todas).
          - `levels`: lista de levels (DEBUG/INFO/WARNING/ERROR).
          - `query`: texto a buscar en el message (case-insensitive).
          - `limit`: int max (default 500).
        """
        with self._lock:
            entries = list(self._buffer)

        cats = params.get("categories")
        if isinstance(cats, list) and cats:
            allowed = {str(c) for c in cats if isinstance(c, str)}
            entries = [e for e in entries if e["category"] in allowed]

        levels = params.get("levels")
        if isinstance(levels, list) and levels:
            allowed_lvl = {str(l).upper() for l in levels if isinstance(l, str)}
            entries = [e for e in entries if e["level"] in allowed_lvl]

        q = params.get("query")
        if isinstance(q, str) and q.strip():
            qq = q.strip().lower()
            entries = [e for e in entries if qq in e["message"].lower()]

        limit = max(1, min(int(params.get("limit") or MAX_BUFFER), MAX_BUFFER))
        return {"entries": entries[-limit:], "total": len(entries)}

    def stats(self, _params: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            return {
                "byCategory": dict(self._stats),
                "total": self._stats_total,
                "bufferSize": len(self._buffer),
                "bufferMax": MAX_BUFFER,
            }

    def clear(self, _params: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self._buffer.clear()
            for k in list(self._stats.keys()):
                self._stats[k] = 0
            self._stats_total = 0
        return {"ok": True}

    def reset_stats(self, _params: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            for k in list(self._stats.keys()):
                self._stats[k] = 0
            self._stats_total = 0
        return {"ok": True}

    def categories(self, _params: dict[str, Any]) -> dict[str, Any]:
        """Devuelve el catálogo de categorías + grupos para la UI."""
        return {
            "categories": list(VALID_CATEGORIES),
            "groups": _CATEGORY_GROUPS,
        }

    def hydrate_from_file(self, params: dict[str, Any]) -> dict[str, Any]:
        """Cargar las últimas N líneas del archivo al buffer estructurado.

        Útil al boot del renderer para tener contexto inmediato sin esperar
        push events.

        IMPORTANTE: solo cargamos las líneas DEL ARRANQUE ACTUAL (desde el
        último marcador `=== MARU BOOT ===`). Si el sidecar arranca 3 veces
        (caso real visto: NSIS reinstala + reinicio manual + auto-update),
        cada arranque agrega entries al archivo. Sin filtrar, el panel
        mostraba 3x cada entry duplicada al hidratar.
        """
        n = max(10, min(int(params.get("lines") or 200), MAX_BUFFER))
        if not LOG_FILE.exists():
            return {"loaded": 0}
        try:
            with LOG_FILE.open("r", encoding="utf-8", errors="replace") as fh:
                all_lines = fh.read().splitlines()
        except Exception:
            return {"loaded": 0}

        # Buscar el último marcador "=== MARU BOOT ===" y filtrar desde ahí.
        # Si no hay marcador (versión vieja), caer a las últimas N líneas.
        boot_marker = "=== MARU BOOT ==="
        last_boot_idx = -1
        for i in range(len(all_lines) - 1, -1, -1):
            if boot_marker in all_lines[i]:
                last_boot_idx = i
                break
        if last_boot_idx >= 0:
            lines = all_lines[last_boot_idx + 1:][-n:]
        else:
            lines = all_lines[-n:]

        loaded = 0
        seen_keys: set[str] = set()
        with self._lock:
            self._buffer.clear()
            for k in list(self._stats.keys()):
                self._stats[k] = 0
            self._stats_total = 0
            for line in lines:
                if not line.strip():
                    continue
                entry = parse_log_line(line)
                # Dedupe defensivo: si la misma combinación
                # (timestamp, source, message) ya se cargó, saltar.
                # Cubre el caso de líneas idénticas que el logger pudo
                # haber escrito 2x por re-install de handlers.
                dedupe_key = (
                    f"{entry.get('ts', '')}-"
                    f"{entry.get('source', '')}-"
                    f"{entry.get('message', '')[:80]}"
                )
                if dedupe_key in seen_keys:
                    continue
                seen_keys.add(dedupe_key)
                self._buffer.append(entry)
                self._stats[entry["category"]] = (
                    self._stats.get(entry["category"], 0) + 1
                )
                self._stats_total += 1
                loaded += 1
        return {"loaded": loaded, "bufferSize": len(self._buffer)}

    # ── Publish (no RPC, llamado desde el code) ─────────────────────────

    def publish(
        self,
        message: str,
        *,
        level: str = "INFO",
        source: str = "app",
        category: str | None = None,
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Agrega una entry al buffer y emite push event al renderer.

        Dedupe ventana 500ms: si llega un publish IDÉNTICO (mismo
        message+source+level) dentro de los últimos 500ms, lo ignoramos.
        Sin esto, races por re-install de LogsBridgeHandler tras un
        rebuild del core_bridge causaban entries duplicadas en el panel.
        """
        cat = category if category in VALID_CATEGORIES else detect_category(
            message, level
        )
        now_ms = int(time.time() * 1000)
        # Clave de dedupe: ignorar entries idénticas dentro de 2000ms.
        # Ampliada de 500ms a 2000ms porque logs del worker via signals
        # PyQt+DirectConnection pueden llegar 2 veces si los slots se
        # conectaron 2x por race de reconexión. 2s cubre ese caso sin
        # perder eventos legítimamente repetidos por el user (ej. spam).
        # Para messages CON @user en ellos, dedupe ignora ts y solo
        # mira message+source+level (lo verdaderamente importante).
        dedupe_key = f"{level.upper()}::{source}::{message[:200]}"
        with self._lock:
            last_ts = self._recent_keys.get(dedupe_key)
            if last_ts is not None and now_ms - last_ts < 2000:
                # Skip — duplicate dentro de la ventana.
                return {"id": "", "ts": now_ms, "deduped": True}
            self._recent_keys[dedupe_key] = now_ms
            # Garbage collect del dict si crece (>500 keys).
            if len(self._recent_keys) > 500:
                cutoff = now_ms - 5000
                self._recent_keys = {
                    k: v for k, v in self._recent_keys.items() if v >= cutoff
                }
        entry: dict[str, Any] = {
            "id": f"l-{uuid.uuid4().hex[:10]}",
            "ts": now_ms,
            "level": level.upper(),
            "source": source,
            "category": cat,
            "message": message,
            "meta": meta or {},
        }
        with self._lock:
            self._buffer.append(entry)
            self._stats[cat] = self._stats.get(cat, 0) + 1
            self._stats_total += 1
        try:
            get_event_bus().publish("log:entry", entry)
        except Exception:
            pass
        return entry


# ── Bridge: Python logging → LogsService ────────────────────────────────


class LogsBridgeHandler(logging.Handler):
    """`logging.Handler` que reenvía cada record al `LogsService`.

    Permite que el log estructurado del sidecar (`logger.info(...)`) sea
    visible en la UI del renderer sin tener que llamar `publish()` a mano
    en cada servicio.

    Filtra:
      - El propio `maru_sidecar.backend.logs` (evita loops si el service
        loguea sobre sí mismo).
      - Loggers ruidosos: `websockets.server`, `asyncio` (level < WARNING).
    """

    _NOISY_LOGGERS = ("websockets", "asyncio", "urllib3")

    def __init__(self, service: "LogsService") -> None:
        super().__init__(level=logging.INFO)
        self._service = service

    def emit(self, record: logging.LogRecord) -> None:  # noqa: D401
        try:
            name = record.name or ""
            if name.startswith("maru_sidecar.backend.logs"):
                return
            if any(name.startswith(p) for p in self._NOISY_LOGGERS):
                if record.levelno < logging.WARNING:
                    return
            try:
                msg = record.getMessage()
            except Exception:
                msg = str(record.msg)
            self._service.publish(
                msg,
                level=record.levelname,
                source=name or "sidecar",
            )
        except Exception:
            # Nunca propagar excepciones desde un handler de logging.
            self.handleError(record)


def install_logs_bridge(service: "LogsService") -> LogsBridgeHandler:
    """Instala el bridge en el root logger. Idempotente."""
    import logging as _l

    root = _l.getLogger()
    for h in root.handlers:
        if isinstance(h, LogsBridgeHandler):
            return h
    handler = LogsBridgeHandler(service)
    root.addHandler(handler)
    return handler


# ── Agrupamiento UI ──────────────────────────────────────────────────────


_CATEGORY_GROUPS: dict[str, list[str]] = {
    "chat": ["comment", "command"],
    "gifts": ["gift"],
    "social": ["follow", "share", "like", "social"],
    "rules": ["rule", "action"],
    "spotify": ["music"],
    "tts": ["tts", "sound"],
    "sistema": ["system", "tiktok", "profile", "ia"],
    "errores": ["error", "warn"],
}
