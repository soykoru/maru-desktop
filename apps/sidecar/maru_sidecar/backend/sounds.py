"""Adapter `sounds.*` — gestión de biblioteca + asignación a gifts/eventos (G10).

Persistencia por perfil: `data/sounds_<gameId>.json` con shape:
    {
      "library": ["abs/path/to/file.mp3", ...],
      "gifts": { "<gift_id>": "abs/path/to/file.mp3", ... },
      "events": {
        "follow": "...", "share": "...", "superfan": "..."
      },
      "volume": 80,        # 0-100 (UI)
      "updatedAt": <ms>
    }

Réplica de `sounds_dialog.py` (650 líneas) — 3 tabs: Biblioteca, Regalos,
Eventos.

Mejoras vs MARU original:
  - Persistencia por perfil de juego (`sounds_<gid>.json`) en vez de
    embebido en el profile JSON. Permite cambiar de juego sin perder
    asignaciones.
  - `library` con metadata cacheada: `{path, name, sizeBytes, exists}`
    para que el renderer no haga IO para cada card.
  - Soporta tanto `gameId` específico como `'global'` (sounds globales
    compartidos entre perfiles, mejora respecto al original).
  - El playback real se delega al renderer (Web Audio / `<audio>`) — el
    sidecar solo persiste y devuelve URL. Esto evita depender de pygame
    en headless / tests.

NO usa core.tts ni pygame. Solo IO + JSON.
"""

from __future__ import annotations

import json
import re
import threading
import time
from pathlib import Path
from typing import Any

from ..logger import get_logger
from ..runtime import DATA_DIR

log = get_logger(__name__)

EVENTS = ("follow", "share", "superfan")
_GID_RE = re.compile(r"^(?!\d+$)[a-zA-Z0-9_]{2,32}$|^global$")
_AUDIO_EXTS = (".mp3", ".wav", ".ogg", ".m4a", ".flac")


def _validate_scope(scope: Any) -> str:
    """Acepta `'global'` o un gameId válido."""
    if not isinstance(scope, str):
        raise TypeError("scope requerido")
    s = scope.strip()
    if not _GID_RE.match(s):
        raise ValueError(f"scope inválido: {scope!r}")
    return s


def _config_path(scope: str) -> Path:
    return DATA_DIR / f"sounds_{scope}.json"


def _safe_path(p: Any) -> str:
    """Coerce path a string limpio. Acepta absoluto o relativo."""
    if not isinstance(p, str):
        return ""
    return p.strip().replace("\\", "/")


def _file_meta(path_str: str) -> dict[str, Any]:
    """Devuelve {path, name, sizeBytes, exists} para una ruta de audio."""
    p = Path(path_str)
    out: dict[str, Any] = {
        "path": path_str,
        "name": p.name,
        "sizeBytes": 0,
        "exists": False,
    }
    try:
        if p.is_file():
            out["exists"] = True
            out["sizeBytes"] = p.stat().st_size
    except OSError:
        pass
    return out


DEFAULT_DOC: dict[str, Any] = {
    "library": [],
    "gifts": {},
    "events": {e: "" for e in EVENTS},
    "volume": 80,
}


class SoundsService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._mixer_ready = False
        self._mixer_lock = threading.Lock()
        DATA_DIR.mkdir(parents=True, exist_ok=True)

    # ── Playback server-side (paridad MARU original con pygame) ──────────

    def _ensure_mixer(self) -> Any:
        """Inicializa pygame.mixer una sola vez. Devuelve el módulo o None
        si no está disponible (entorno sin audio device, headless)."""
        with self._mixer_lock:
            if self._mixer_ready:
                try:
                    import pygame  # type: ignore
                    return pygame
                except Exception:
                    return None
            try:
                import pygame  # type: ignore
                if not pygame.mixer.get_init():
                    pygame.mixer.init(
                        frequency=44100, size=-16, channels=2, buffer=512
                    )
                self._mixer_ready = True
                return pygame
            except Exception as exc:
                log.debug("pygame.mixer no disponible: %s", exc)
                return None

    def _play_file(self, path_str: str, volume_pct: int = 80) -> bool:
        """Reproduce un archivo de audio en background. No bloquea."""
        if not path_str:
            return False
        p = Path(path_str)
        if not p.is_file():
            log.debug("sounds.play: archivo no existe: %s", path_str)
            return False
        pg = self._ensure_mixer()
        if pg is None:
            return False
        try:
            sound = pg.mixer.Sound(str(p))
            try:
                sound.set_volume(max(0.0, min(1.0, float(volume_pct) / 100.0)))
            except Exception:
                pass
            sound.play()
            return True
        except Exception as exc:
            log.warning("sounds.play falló (%s): %s", path_str, exc)
            return False

    def stop_all(self, _params: Any = None) -> dict[str, Any]:
        """Detiene TODOS los sonidos en reproducción. Útil para el botón
        '⏸ Detener' del preview de emotes (cuando el usuario eligió un
        archivo largo y quiere cortarlo)."""
        if not self._mixer_ready:
            return {"ok": True, "stopped": 0}
        try:
            import pygame  # type: ignore
            pygame.mixer.stop()
            return {"ok": True}
        except Exception as exc:
            log.warning("stop_all falló: %s", exc)
            return {"ok": False, "message": str(exc)}

    def play_for_gift(self, gift_id: str, scope: str = "global") -> bool:
        """Llamado desde ChatDispatcher cuando llega un gift. Busca el
        sonido configurado para ese gift en el scope y lo reproduce."""
        try:
            doc = self._read(scope)
        except Exception:
            return False
        gifts = doc.get("gifts") or {}
        path = gifts.get(gift_id) or gifts.get(gift_id.lower()) or ""
        if not path:
            return False
        return self._play_file(str(path), int(doc.get("volume") or 80))

    def play_for_event(self, event_id: str, scope: str = "global") -> bool:
        """`follow`, `share`, `superfan` — reproduce el sonido asignado."""
        if event_id not in EVENTS:
            return False
        try:
            doc = self._read(scope)
        except Exception:
            return False
        path = (doc.get("events") or {}).get(event_id) or ""
        if not path:
            return False
        return self._play_file(str(path), int(doc.get("volume") or 80))

    # ── Persistencia ─────────────────────────────────────────────────────

    def _read(self, scope: str) -> dict[str, Any]:
        path = _config_path(scope)
        if not path.exists():
            return {**DEFAULT_DOC, "library": [], "gifts": {}, "events": dict(DEFAULT_DOC["events"])}
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.error("sounds_%s.json corrupto — usando defaults", scope)
            return {**DEFAULT_DOC, "library": [], "gifts": {}, "events": dict(DEFAULT_DOC["events"])}
        if not isinstance(raw, dict):
            return {**DEFAULT_DOC, "library": [], "gifts": {}, "events": dict(DEFAULT_DOC["events"])}
        # Normalizar.
        library = raw.get("library") or []
        if not isinstance(library, list):
            library = []
        gifts = raw.get("gifts") or {}
        if not isinstance(gifts, dict):
            gifts = {}
        events_raw = raw.get("events") or {}
        if not isinstance(events_raw, dict):
            events_raw = {}
        events = {e: _safe_path(events_raw.get(e, "")) for e in EVENTS}
        try:
            volume = max(0, min(100, int(raw.get("volume") or 80)))
        except (TypeError, ValueError):
            volume = 80
        return {
            "library": [_safe_path(x) for x in library if isinstance(x, str) and x.strip()],
            "gifts": {
                str(k): _safe_path(v)
                for k, v in gifts.items()
                if isinstance(k, str) and isinstance(v, str)
            },
            "events": events,
            "volume": volume,
        }

    def _write(self, scope: str, doc: dict[str, Any]) -> None:
        path = _config_path(scope)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {**doc, "updatedAt": int(time.time() * 1000)}
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)

    # ── RPC: list ────────────────────────────────────────────────────────

    def list(self, params: dict[str, Any]) -> dict[str, Any]:
        scope = _validate_scope(params.get("scope") or "global")
        doc = self._read(scope)
        # Library con metadata enriquecida.
        library_meta = [_file_meta(p) for p in doc["library"]]
        return {
            "scope": scope,
            "library": library_meta,
            "gifts": dict(doc["gifts"]),
            "events": dict(doc["events"]),
            "volume": doc["volume"],
        }

    # ── RPC: library add/remove ──────────────────────────────────────────

    def library_add(self, params: dict[str, Any]) -> dict[str, Any]:
        scope = _validate_scope(params.get("scope") or "global")
        paths = params.get("paths")
        if not isinstance(paths, list):
            raise TypeError("paths debe ser lista")
        clean = []
        for p in paths:
            sp = _safe_path(p)
            if not sp:
                continue
            ext = Path(sp).suffix.lower()
            if ext not in _AUDIO_EXTS:
                continue
            clean.append(sp)
        if not clean:
            return {"ok": True, "added": 0, "library": []}
        with self._lock:
            doc = self._read(scope)
            existing = set(doc["library"])
            added = 0
            for p in clean:
                if p not in existing:
                    doc["library"].append(p)
                    existing.add(p)
                    added += 1
            self._write(scope, doc)
        return {
            "ok": True,
            "added": added,
            "library": [_file_meta(p) for p in doc["library"]],
        }

    def library_remove(self, params: dict[str, Any]) -> dict[str, Any]:
        scope = _validate_scope(params.get("scope") or "global")
        path = _safe_path(params.get("path"))
        if not path:
            raise ValueError("path requerido")
        with self._lock:
            doc = self._read(scope)
            doc["library"] = [p for p in doc["library"] if p != path]
            # También limpiar referencias en gifts/events que apuntaban a este path.
            doc["gifts"] = {k: (v if v != path else "") for k, v in doc["gifts"].items()}
            doc["events"] = {k: (v if v != path else "") for k, v in doc["events"].items()}
            self._write(scope, doc)
        return {"ok": True}

    # ── RPC: assign ──────────────────────────────────────────────────────

    def assign_gift(self, params: dict[str, Any]) -> dict[str, Any]:
        scope = _validate_scope(params.get("scope") or "global")
        gift_id = params.get("giftId")
        path = _safe_path(params.get("path") or "")
        if not isinstance(gift_id, str) or not gift_id.strip():
            raise ValueError("giftId requerido")
        with self._lock:
            doc = self._read(scope)
            if path:
                doc["gifts"][gift_id] = path
            else:
                doc["gifts"].pop(gift_id, None)
            self._write(scope, doc)
        return {"ok": True, "giftId": gift_id, "path": path}

    def assign_event(self, params: dict[str, Any]) -> dict[str, Any]:
        scope = _validate_scope(params.get("scope") or "global")
        event = params.get("event")
        path = _safe_path(params.get("path") or "")
        if event not in EVENTS:
            raise ValueError(f"event ∈ {EVENTS}")
        with self._lock:
            doc = self._read(scope)
            doc["events"][event] = path
            self._write(scope, doc)
        return {"ok": True, "event": event, "path": path}

    def set_volume(self, params: dict[str, Any]) -> dict[str, Any]:
        scope = _validate_scope(params.get("scope") or "global")
        try:
            volume = max(0, min(100, int(params.get("volume") or 0)))
        except (TypeError, ValueError):
            raise ValueError("volume debe ser int 0-100")
        with self._lock:
            doc = self._read(scope)
            doc["volume"] = volume
            self._write(scope, doc)
        return {"ok": True, "volume": volume}

    # ── RPC: file resolve ────────────────────────────────────────────────

    def resolve_path(self, params: dict[str, Any]) -> dict[str, Any]:
        """Devuelve metadata de un path (existe, tamaño, etc.)."""
        path = _safe_path(params.get("path"))
        return {"path": path, **_file_meta(path)} if path else {"path": "", "exists": False}
