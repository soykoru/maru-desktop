"""Servicio `top-lives.*` — Histórico del Top 3 de likes por sesión de live.

NUEVO en v1.0.56. Cuando termina un live (disconnect), tomamos el ranking
de likes acumulados POR USUARIO durante esa sesión y guardamos el TOP 3
en `data/top_lives.json`. Mantenemos máximo 5 lives — los más viejos se
descartan al agregar uno nuevo.

Además, cada usuario que aparece en un top 3 acumula contadores
persistentes (`top1_count`, `top2_count`, `top3_count`) que el sistema
social muestra en el perfil del user (cuántas veces fue el más activo
en los lives).

Datos persistidos en `data/top_lives.json`:

```json
{
  "lives": [
    {
      "id": "uuid",
      "started_at": 1700000000000,
      "ended_at":   1700020000000,
      "duration_min": 333,
      "username": "soykoru",            // streamer
      "top": [
        {"place": 1, "user": "fan1", "taps": 12500, "avatar": "https://…"},
        {"place": 2, "user": "fan2", "taps": 9300,  "avatar": "https://…"},
        {"place": 3, "user": "fan3", "taps": 5100,  "avatar": "https://…"}
      ]
    },
    ...
  ],
  "user_top_counts": {
    "fan1": {"top1": 3, "top2": 1, "top3": 0, "total": 4}
  }
}
```

Flujo:
  1. Bus `tiktok:status connected=True` → reset session counters.
  2. Bus `tiktok:event type=like` → acumular `count` en
     `_session_likes[user]`.
  3. Bus `tiktok:status connected=False` → snapshot, guardar, recortar a 5.
  4. Bus `tiktok:comment-enriched` → guardamos avatar para enriquecer el
     snapshot final con foto del user.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from ..event_bus import get_event_bus
from ..logger import get_logger
from ..runtime import DATA_DIR

log = get_logger(__name__)

_PATH = DATA_DIR / "top_lives.json"
DEFAULT_MAX_LIVES = 5
MAX_LIVES_LIMIT = 50  # tope superior para evitar JSON gigantes
TOP_N = 3


class TopLivesService:
    # v1.0.69: cap de users tracked por sesión para evitar crecimiento sin
    # tope en lives masivos. 50K chatters únicos sin cap eran ~25MB. Como
    # el snapshot final usa solo TOP_N=3 y los likes son monotonicamente
    # crecientes, los users con muy pocos likes nunca van a ganar el top
    # → se pueden purgar sin afectar el resultado.
    _SESSION_USERS_MAX = 5000

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # Counters de la sesión actual del live: {username_lower → likes}.
        self._session_likes: dict[str, int] = {}
        # Display name (nickname) por user para el snapshot final.
        self._session_display: dict[str, str] = {}
        # Avatar más reciente visto en la sesión (lo enriquece el bus
        # `tiktok:comment-enriched`). Persiste solo durante la sesión.
        self._session_avatars: dict[str, str] = {}
        self._session_started_at: int | None = None
        self._session_streamer: str = ""
        self._doc: dict[str, Any] = self._read_doc()
        # SocialService — opcional, para enriquecer avatares del cache
        # persistente cuando el snapshot se cierre.
        self._social: Any = None

    def attach_social(self, social: Any) -> None:
        self._social = social

    def install(self) -> None:
        """Suscribe al EventBus para tracking + snapshot automático."""
        bus = get_event_bus()
        bus.subscribe("tiktok:event", self._on_event)
        bus.subscribe("tiktok:status", self._on_status)
        bus.subscribe("tiktok:comment-enriched", self._on_enriched)
        log.info("TopLivesService instalado (sub a status/event/enriched)")

    # ── Persistencia ─────────────────────────────────────────────────────

    def _read_doc(self) -> dict[str, Any]:
        if not _PATH.exists():
            return {
                "lives": [],
                "user_top_counts": {},
                "max_lives": DEFAULT_MAX_LIVES,
            }
        try:
            raw = json.loads(_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.error("top_lives.json corrupto — reinicializando vacío")
            return {
                "lives": [],
                "user_top_counts": {},
                "max_lives": DEFAULT_MAX_LIVES,
            }
        if not isinstance(raw, dict):
            return {
                "lives": [],
                "user_top_counts": {},
                "max_lives": DEFAULT_MAX_LIVES,
            }
        lives = raw.get("lives") if isinstance(raw.get("lives"), list) else []
        counts = (
            raw.get("user_top_counts")
            if isinstance(raw.get("user_top_counts"), dict)
            else {}
        )
        try:
            max_lives = int(raw.get("max_lives") or DEFAULT_MAX_LIVES)
        except (TypeError, ValueError):
            max_lives = DEFAULT_MAX_LIVES
        max_lives = max(1, min(MAX_LIVES_LIMIT, max_lives))
        return {"lives": lives, "user_top_counts": counts, "max_lives": max_lives}

    def _write_doc(self) -> None:
        _PATH.parent.mkdir(parents=True, exist_ok=True)
        payload = {**self._doc, "updatedAt": int(time.time() * 1000)}
        tmp = _PATH.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        tmp.replace(_PATH)

    # ── Bus listeners ────────────────────────────────────────────────────

    def _on_status(self, payload: dict[str, Any]) -> None:
        """`tiktok:status` se publica con `{connected, connecting, username}`.
        En False → snapshot del live recién terminado.
        En True → reset de contadores para arrancar nueva sesión."""
        try:
            connected = bool(payload.get("connected"))
            connecting = bool(payload.get("connecting"))
            username = str(payload.get("username") or "")
            if connecting:
                # Estado intermedio — no actuamos.
                return
            if connected:
                self._reset_session(username)
            else:
                # disconnect — snapshot solo si había una sesión activa.
                self._finalize_session()
        except Exception:
            log.exception("top_lives _on_status fallo")

    def _on_event(self, payload: dict[str, Any]) -> None:
        """Captura solo eventos `like` para acumular el contador por user."""
        try:
            if payload.get("type") != "like":
                return
            user = str(payload.get("user") or "").strip()
            if not user:
                return
            data = payload.get("data") or {}
            try:
                count = int(data.get("count") or 1)
            except (TypeError, ValueError):
                count = 1
            if count < 1:
                count = 1
            key = user.lower()
            with self._lock:
                if self._session_started_at is None:
                    # Sesión no iniciada explícitamente — la abrimos en frío
                    # con timestamp NOW. Cubre el caso del worker real que
                    # no emitió `tiktok:status connected=True` antes (raro).
                    self._session_started_at = int(time.time() * 1000)
                self._session_likes[key] = self._session_likes.get(key, 0) + count
                self._session_display[key] = user
                # Capturar avatar si el payload lo trae.
                av = payload.get("avatar")
                if isinstance(av, str) and av:
                    self._session_avatars[key] = av
                # Cap defensivo: si superamos el límite de users tracked,
                # purgar los de menor cantidad de likes (no afecta el TOP_N).
                if len(self._session_likes) > self._SESSION_USERS_MAX:
                    self._enforce_session_cap_locked()
        except Exception:
            log.exception("top_lives _on_event fallo")

    def _enforce_session_cap_locked(self) -> None:
        """Purga in-place del session si supera el cap. Llamar SOLO con
        `self._lock` adquirido. Mantiene los TOP cap/2 users por likes;
        descarta el resto para liberar RAM. Como los likes solo crecen,
        un user con 1-2 likes en un live de 50K chatters NUNCA va a
        entrar al top final → es seguro purgarlo."""
        keep_n = self._SESSION_USERS_MAX // 2
        ordered = sorted(self._session_likes.items(), key=lambda kv: -kv[1])
        keep_keys = {k for k, _ in ordered[:keep_n]}
        self._session_likes = {k: v for k, v in self._session_likes.items() if k in keep_keys}
        self._session_display = {k: v for k, v in self._session_display.items() if k in keep_keys}
        self._session_avatars = {k: v for k, v in self._session_avatars.items() if k in keep_keys}
        log.info(
            "top_lives: cap aplicado · purgados %d users de bajo ranking · activos=%d",
            self._SESSION_USERS_MAX - keep_n, len(self._session_likes),
        )

    def _on_enriched(self, payload: dict[str, Any]) -> None:
        """Capturamos avatar de los comments — fuente más confiable."""
        try:
            user = str(payload.get("user") or "").strip().lower()
            if not user:
                return
            av = payload.get("avatar_url") or payload.get("avatar")
            if isinstance(av, str) and av:
                with self._lock:
                    # Solo cacheamos avatar si el user YA está siendo tracked
                    # (dio al menos 1 like). Sin esto, un live grande con 50K
                    # comentaristas únicos llenaba `_session_avatars` aunque
                    # nunca hayan dado like → memoria desperdiciada.
                    if user in self._session_likes:
                        self._session_avatars[user] = av
        except Exception:
            pass

    # ── Session control ──────────────────────────────────────────────────

    def _reset_session(self, streamer: str) -> None:
        with self._lock:
            self._session_likes.clear()
            self._session_display.clear()
            self._session_avatars.clear()
            self._session_started_at = int(time.time() * 1000)
            self._session_streamer = streamer
        log.info("top_lives: sesión nueva iniciada (streamer=%s)", streamer)

    def _finalize_session(self) -> None:
        """Snapshot del top 3 actual + persistencia. Idempotente: si no
        había sesión activa o nadie dio like, no escribe nada."""
        with self._lock:
            if self._session_started_at is None:
                return
            if not self._session_likes:
                # Limpiamos sin escribir.
                self._session_started_at = None
                self._session_streamer = ""
                self._session_likes.clear()
                self._session_display.clear()
                self._session_avatars.clear()
                return
            started = self._session_started_at
            ended = int(time.time() * 1000)
            streamer = self._session_streamer
            likes_snapshot = dict(self._session_likes)
            display_snapshot = dict(self._session_display)
            avatar_snapshot = dict(self._session_avatars)
            # Enriquecer avatares con el cache persistente del Social.
            if self._social is not None:
                try:
                    for u in display_snapshot:
                        if u in avatar_snapshot:
                            continue
                        v = self._social.get_avatar(u) if hasattr(self._social, "get_avatar") else None
                        if isinstance(v, str) and v:
                            avatar_snapshot[u] = v
                except Exception:
                    pass
            # Reset session AHORA — el commit a disco lo hacemos fuera del
            # lock para no bloquear el bus.
            self._session_started_at = None
            self._session_streamer = ""
            self._session_likes.clear()
            self._session_display.clear()
            self._session_avatars.clear()

        # Top 3 desempate: más likes; si empatan, alfabético por user.
        ordered = sorted(
            likes_snapshot.items(), key=lambda kv: (-kv[1], kv[0])
        )[:TOP_N]
        if not ordered:
            return
        top_entries: list[dict[str, Any]] = []
        for i, (user_lower, taps) in enumerate(ordered, start=1):
            top_entries.append(
                {
                    "place": i,
                    "user": display_snapshot.get(user_lower) or user_lower,
                    "taps": taps,
                    "avatar": avatar_snapshot.get(user_lower) or "",
                }
            )

        duration_min = max(0, (ended - started) // 60_000)
        live_record = {
            "id": uuid.uuid4().hex[:12],
            "started_at": started,
            "ended_at": ended,
            "duration_min": duration_min,
            "username": streamer,
            "top": top_entries,
        }

        with self._lock:
            lives = self._doc.get("lives") or []
            if not isinstance(lives, list):
                lives = []
            # Insertamos al inicio (más reciente primero) y recortamos al
            # max configurado por el user (default 5, máx 50).
            lives.insert(0, live_record)
            max_lives = int(self._doc.get("max_lives") or DEFAULT_MAX_LIVES)
            max_lives = max(1, min(MAX_LIVES_LIMIT, max_lives))
            if len(lives) > max_lives:
                lives = lives[:max_lives]
            self._doc["lives"] = lives

            # Actualizar contadores de top 1/2/3 por user.
            counts = self._doc.get("user_top_counts") or {}
            if not isinstance(counts, dict):
                counts = {}
            for entry in top_entries:
                u = str(entry["user"]).lower()
                place_key = f"top{entry['place']}"
                bucket = counts.get(u) or {"top1": 0, "top2": 0, "top3": 0, "total": 0}
                if not isinstance(bucket, dict):
                    bucket = {"top1": 0, "top2": 0, "top3": 0, "total": 0}
                bucket[place_key] = int(bucket.get(place_key, 0)) + 1
                bucket["total"] = (
                    int(bucket.get("top1", 0))
                    + int(bucket.get("top2", 0))
                    + int(bucket.get("top3", 0))
                )
                counts[u] = bucket
            self._doc["user_top_counts"] = counts
            self._write_doc()

        log.info(
            "top_lives: snapshot guardado · top=%s · duración=%smin",
            ", ".join(f"@{e['user']}({e['taps']})" for e in top_entries),
            duration_min,
        )

    # ── RPC ──────────────────────────────────────────────────────────────

    def list(self, _params: dict[str, Any]) -> dict[str, Any]:
        """Devuelve los lives guardados (hasta `max_lives`, más reciente
        primero) + el snapshot LIVE de la sesión actual si está activa."""
        with self._lock:
            lives = list(self._doc.get("lives") or [])
            current = None
            if self._session_started_at is not None and self._session_likes:
                ordered = sorted(
                    self._session_likes.items(),
                    key=lambda kv: (-kv[1], kv[0]),
                )[:TOP_N]
                top_now = [
                    {
                        "place": i,
                        "user": self._session_display.get(u) or u,
                        "taps": t,
                        "avatar": self._session_avatars.get(u) or "",
                    }
                    for i, (u, t) in enumerate(ordered, start=1)
                ]
                current = {
                    "started_at": self._session_started_at,
                    "username": self._session_streamer,
                    "top": top_now,
                    "live": True,
                }
            counts = dict(self._doc.get("user_top_counts") or {})
            max_lives = int(self._doc.get("max_lives") or DEFAULT_MAX_LIVES)
        return {
            "lives": lives,
            "current": current,
            "userCounts": counts,
            "maxLives": max_lives,
        }

    def delete(self, params: dict[str, Any]) -> dict[str, Any]:
        """Borra un live específico por id. Decrementa los counters de
        los users que estaban en ese podio (manteniendo eternos los
        otros podios). Si el contador llega a 0 en todos los puestos,
        el bucket del user se elimina."""
        live_id = str(params.get("id") or "").strip()
        if not live_id:
            raise ValueError("id requerido")
        with self._lock:
            lives = list(self._doc.get("lives") or [])
            target = next((l for l in lives if l.get("id") == live_id), None)
            if target is None:
                return {"ok": False, "removed": False}
            counts = dict(self._doc.get("user_top_counts") or {})
            for entry in target.get("top") or []:
                u = str(entry.get("user", "")).lower()
                if not u:
                    continue
                place_key = f"top{int(entry.get('place', 0))}"
                bucket = counts.get(u)
                if not isinstance(bucket, dict):
                    continue
                bucket[place_key] = max(0, int(bucket.get(place_key, 0)) - 1)
                bucket["total"] = (
                    int(bucket.get("top1", 0))
                    + int(bucket.get("top2", 0))
                    + int(bucket.get("top3", 0))
                )
                if bucket["total"] <= 0:
                    counts.pop(u, None)
                else:
                    counts[u] = bucket
            self._doc["lives"] = [l for l in lives if l.get("id") != live_id]
            self._doc["user_top_counts"] = counts
            self._write_doc()
        return {"ok": True, "removed": True}

    def set_max_lives(self, params: dict[str, Any]) -> dict[str, Any]:
        """Setea cuántos lives mantener en el histórico (1..50). Si el
        nuevo valor es menor que la cantidad actual, recortamos el
        exceso (los más viejos)."""
        try:
            n = int(params.get("max") or 0)
        except (TypeError, ValueError):
            raise ValueError("max debe ser entero")
        if n < 1 or n > MAX_LIVES_LIMIT:
            raise ValueError(f"max debe estar entre 1 y {MAX_LIVES_LIMIT}")
        with self._lock:
            self._doc["max_lives"] = n
            lives = list(self._doc.get("lives") or [])
            if len(lives) > n:
                self._doc["lives"] = lives[:n]
            self._write_doc()
        return {"ok": True, "max": n}

    def user_counts(self, params: dict[str, Any]) -> dict[str, Any]:
        """Counts top1/top2/top3 de un usuario específico."""
        username = str(params.get("username") or "").strip().lower()
        if not username:
            return {"top1": 0, "top2": 0, "top3": 0, "total": 0}
        with self._lock:
            counts = self._doc.get("user_top_counts") or {}
            bucket = counts.get(username) or {"top1": 0, "top2": 0, "top3": 0, "total": 0}
        return {
            "top1": int(bucket.get("top1", 0)),
            "top2": int(bucket.get("top2", 0)),
            "top3": int(bucket.get("top3", 0)),
            "total": int(bucket.get("total", 0)),
        }

    def force_snapshot(self, _params: dict[str, Any]) -> dict[str, Any]:
        """Para testing manual desde la UI: forzar snapshot de la sesión
        actual sin desconectar. Útil para que el user vea su rendimiento
        a mitad de live sin esperar a cerrar el WS."""
        self._finalize_session()
        return {"ok": True}

    def clear(self, _params: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self._doc = {"lives": [], "user_top_counts": {}}
            self._write_doc()
        return {"ok": True}
