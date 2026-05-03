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
import queue
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
        # Cola de sonidos para gifts/events. Sin esta cola, 100 rosas
        # llegando juntas reproducían 100 sonidos SIMULTÁNEOS en
        # mixer.Sound() → cacofonía. Ahora encolamos y un worker
        # thread los reproduce uno tras otro, esperando a que termine
        # el actual antes de empezar el siguiente.
        # Capacidad limitada a 50 — si llega un streak gigante, los
        # extras se descartan en silencio (mejor que freezar el live).
        self._play_queue: queue.Queue[tuple[str, int]] = queue.Queue(maxsize=50)
        self._play_worker: threading.Thread | None = None
        self._play_worker_lock = threading.Lock()
        # Logs service opcional — cableado vía `attach_logs` para que cada
        # sonido reproducido emita un `log:entry` category=sound (útil
        # para auditar en vivo cuántos sonidos suenan y agruparlos).
        self._logs: Any = None

    def attach_logs(self, logs: Any) -> None:
        self._logs = logs

    def _log_sound(
        self, message: str, *, kind: str = "play", meta: dict[str, Any] | None = None
    ) -> None:
        if self._logs is None:
            return
        try:
            self._logs.publish(
                f"🔔 {message}",
                level="INFO",
                source="sounds",
                category="sound",
                meta={"kind": kind, **(meta or {})},
            )
        except Exception:
            pass

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

    def _ensure_play_worker(self) -> None:
        """Lazy-start del thread worker que consume la cola de sonidos
        secuencialmente. Idempotente."""
        with self._play_worker_lock:
            if self._play_worker is not None and self._play_worker.is_alive():
                return
            t = threading.Thread(
                target=self._play_worker_loop,
                name="sounds-queue-worker",
                daemon=True,
            )
            self._play_worker = t
            t.start()

    def _play_worker_loop(self) -> None:
        """Loop del worker: saca un (path, volume) de la cola y lo
        reproduce ESPERANDO a que termine antes de tomar el siguiente.
        Asegura que un streak de 100 gifts encole 100 sonidos que
        suenen uno tras otro, no todos a la vez."""
        pg = self._ensure_mixer()
        if pg is None:
            return
        while True:
            try:
                item = self._play_queue.get(timeout=60.0)
            except queue.Empty:
                # 60s sin sonidos → terminamos el worker y dejamos que
                # se relance perezosamente cuando vuelva a haber.
                with self._play_worker_lock:
                    if self._play_queue.empty():
                        self._play_worker = None
                        return
                continue
            path_str, volume_pct = item
            try:
                p = Path(path_str)
                if not p.is_file():
                    continue
                sound = pg.mixer.Sound(str(p))
                try:
                    sound.set_volume(
                        max(0.0, min(1.0, float(volume_pct) / 100.0))
                    )
                except Exception:
                    pass
                channel = sound.play()
                # Esperar a que termine este sonido antes de tomar el
                # siguiente. Si pygame no devuelve channel (raro), fall
                # back a sleep estimado por la duración del Sound.
                if channel is not None:
                    while channel.get_busy():
                        pg.time.wait(25)
                else:
                    try:
                        secs = sound.get_length()
                    except Exception:
                        secs = 0.5
                    pg.time.wait(int(max(0.05, secs) * 1000))
            except Exception as exc:
                log.warning("sounds: worker play falló (%s): %s", path_str, exc)
            finally:
                try:
                    self._play_queue.task_done()
                except ValueError:
                    pass

    def _play_queued(self, path_str: str, volume_pct: int = 80) -> bool:
        """Encola un sonido para reproducción secuencial. Si la cola
        está llena (50 items pendientes) descarta silenciosamente para
        no bloquear el loop del live."""
        if not path_str:
            return False
        if not Path(path_str).is_file():
            return False
        try:
            self._play_queue.put_nowait((path_str, int(volume_pct)))
        except queue.Full:
            log.debug("sounds: cola llena, descartando %s", path_str)
            return False
        self._ensure_play_worker()
        return True

    def _play_file(self, path_str: str, volume_pct: int = 80) -> bool:
        """Reproduce un archivo INMEDIATAMENTE sin pasar por la cola.
        Útil para preview manual (botón Probar del SoundsDialog) donde
        el user espera respuesta instantánea, no encolado.

        Para gifts/events del live, usar `_play_queued` que encola y
        reproduce secuencialmente — sin esto, 100 rosas llegando
        juntas hacían sonar 100 sonidos a la vez."""
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

    def play(self, params: dict[str, Any]) -> dict[str, Any]:
        """Reproduce un sonido arbitrario por su path absoluto, vía
        pygame en el sidecar (no usa Web Audio del renderer que en
        Electron empaquetado tiene restricciones de file:// y a veces
        no suena). Útil para preview desde el SoundsDialog.

        Params:
          - path: ruta absoluta al archivo (.mp3/.wav/.ogg/.m4a/.flac).
          - volume: 0-100 (default 80).
        """
        path = str(params.get("path") or "").strip()
        if not path:
            return {"ok": False, "message": "path requerido"}
        try:
            volume = max(0, min(100, int(params.get("volume") or 80)))
        except (TypeError, ValueError):
            volume = 80
        ok = self._play_file(path, volume)
        return {"ok": ok, "message": "" if ok else "No se pudo reproducir"}

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

    def _resolve_scopes(self, explicit_scope: str | None) -> list[str]:
        """Resuelve la lista de scopes a probar en cascada.

        Prioridad (v1.0.44):
          1. `explicit_scope` si vino por parámetro y es != global.
          2. `soundsScope` configurado por el user (NUEVO) — desliga el
             perfil de sonidos del juego activo. Antes el cambio de juego
             cambiaba la librería de sonidos sin querer. Ahora el user
             elige explícitamente: 'global' o un perfil específico.
          3. `activeGame` (fallback histórico — solo si NO hay
             `soundsScope` configurado, para no romper a usuarios viejos).
          4. 'global' siempre al final (catch-all).
        """
        scopes: list[str] = []
        if explicit_scope and explicit_scope != "global":
            scopes.append(explicit_scope)
        try:
            cfg_path = DATA_DIR / "config.json"
            if cfg_path.exists():
                cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
                if isinstance(cfg, dict):
                    user_scope = cfg.get("soundsScope")
                    if isinstance(user_scope, str) and user_scope.strip():
                        s = user_scope.strip()
                        if s != "global" and s not in scopes:
                            scopes.append(s)
                    else:
                        # Fallback al juego activo solo si el user nunca
                        # eligió un scope explícito.
                        active = cfg.get("activeGame")
                        if isinstance(active, str) and active.strip() and active not in scopes:
                            scopes.append(active.strip())
        except Exception:
            pass
        if "global" not in scopes:
            scopes.append("global")
        return scopes

    # ── RPC: scope manual de sonidos ─────────────────────────────────────

    def scope_get(self, _params: dict[str, Any]) -> dict[str, Any]:
        """Devuelve el scope manual configurado y la lista de scopes
        disponibles (= archivos `sounds_*.json` que existan)."""
        scope = "global"
        try:
            cfg_path = DATA_DIR / "config.json"
            if cfg_path.exists():
                cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
                if isinstance(cfg, dict):
                    s = cfg.get("soundsScope")
                    if isinstance(s, str) and s.strip():
                        scope = s.strip()
        except Exception:
            pass
        # Listar perfiles existentes en disco.
        available: list[str] = ["global"]
        try:
            for p in DATA_DIR.glob("sounds_*.json"):
                name = p.stem.removeprefix("sounds_")
                if name and name != "global" and name not in available:
                    available.append(name)
        except Exception:
            pass
        return {"scope": scope, "available": available}

    def scope_set(self, params: dict[str, Any]) -> dict[str, Any]:
        """Persiste el scope elegido por el user en `config.json`. Acepta
        'global' o un gameId existente. Atómico (write-rename)."""
        scope = str(params.get("scope") or "global").strip() or "global"
        # Validamos contra _GID_RE — protección contra valores inyectados.
        if not _GID_RE.match(scope):
            return {"ok": False, "message": f"scope inválido: {scope!r}"}
        try:
            cfg_path = DATA_DIR / "config.json"
            cfg: dict[str, Any] = {}
            if cfg_path.exists():
                try:
                    raw = json.loads(cfg_path.read_text(encoding="utf-8"))
                    if isinstance(raw, dict):
                        cfg = raw
                except Exception:
                    cfg = {}
            cfg["soundsScope"] = scope
            tmp = cfg_path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
            tmp.replace(cfg_path)
            return {"ok": True, "scope": scope}
        except Exception as exc:
            log.exception("sounds.scope_set fallo")
            return {"ok": False, "message": str(exc)}

    def _lookup_gift_path(
        self, gifts: dict[str, Any], gift_id: str
    ) -> str | None:
        """Lookup CASE-INSENSITIVE de un sonido por gift_id.

        El SoundsDialog asigna sonidos con la `g.id` original (casing
        de TikTok, ej. "Rose"). El worker REAL del core emite
        `gift_name` en lowercase (ej. "rose"). Sin un lookup
        case-insensitive, la asignación nunca matchea en producción
        (solo en simulator que conserva casing).
        """
        if not gifts or not gift_id:
            return None
        # 1) Match exacto.
        if gift_id in gifts:
            return str(gifts[gift_id])
        # 2) Match lower-cased (caso típico worker).
        gid_lower = gift_id.lower()
        if gid_lower in gifts:
            return str(gifts[gid_lower])
        # 3) Iteración case-insensitive (cubre todos los casings de
        # las keys: si key="Rose" y query="rose", o viceversa).
        for k, v in gifts.items():
            if isinstance(k, str) and k.lower() == gid_lower:
                return str(v)
        return None

    def play_for_gift(self, gift_id: str, scope: str = "global") -> bool:
        """Llamado desde ChatDispatcher cuando llega un gift. Busca el
        sonido en CASCADA: scope explícito → juego activo → global,
        con lookup CASE-INSENSITIVE en cada scope. Ahora encola en vez
        de reproducir directo — un streak de 100 rosas suena uno tras
        otro, no todos a la vez."""
        scopes_to_try = self._resolve_scopes(scope)
        for sc in scopes_to_try:
            try:
                doc = self._read(sc)
            except Exception:
                continue
            gifts = doc.get("gifts") or {}
            path = self._lookup_gift_path(gifts, gift_id)
            if path:
                ok = self._play_queued(
                    str(path), int(doc.get("volume") or 80)
                )
                if ok:
                    self._log_sound(
                        f"sonido de gift '{gift_id}' (scope: {sc})",
                        kind="gift",
                        meta={"gift_id": gift_id, "scope": sc},
                    )
                return ok
        return False

    def play_for_event(self, event_id: str, scope: str = "global") -> bool:
        """`follow`, `share`, `superfan` — reproduce el sonido asignado.
        Cascada: scope explícito → juego activo → global. También
        encolado para evitar overlap en ráfagas de follows/shares."""
        if event_id not in EVENTS:
            return False
        for sc in self._resolve_scopes(scope):
            try:
                doc = self._read(sc)
            except Exception:
                continue
            path = (doc.get("events") or {}).get(event_id) or ""
            if path:
                ok = self._play_queued(
                    str(path), int(doc.get("volume") or 80)
                )
                if ok:
                    self._log_sound(
                        f"sonido de evento '{event_id}' (scope: {sc})",
                        kind=event_id,
                        meta={"event_id": event_id, "scope": sc},
                    )
                return ok
        return False

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
