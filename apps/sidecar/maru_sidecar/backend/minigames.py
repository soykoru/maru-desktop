"""Adapter `minigames.*` — catálogo + config persistente (G10).

3 minijuegos del MARU original (`minigames_dialog.py` + `core/`):
  1. WordSearch (Sopa de Letras) — `WordSearchGame`.
  2. WordSearchLite (Sopa Rápida) — misma clase, modo "lite" sin pistas.
  3. WordBomb (Bomba de Palabras) — `WordBombGame`.

Persistencia: `data/minigames.json` con `last_config` por minijuego.

El **engine real** se ejecuta dentro del sidecar cuando G14 cablee
TikTokLive (necesita `process_minigame_command` desde chat). En G10 el
service expone:
  - meta del catálogo (categories, ranges, defaults).
  - get/set de la config persistida (rows/cols/word_count para WS,
    turn_time/lives para WB).
  - state (`active`, `id`, `started_at`) — útil para que la UI muestre
    si hay un minijuego corriendo y permita "stop".

Tolerante a core no disponible: si `core.minigames.*` no carga, las
operaciones devuelven shape válido y `start` retorna `{ok:false}`.
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any

from ..logger import get_logger
from ..runtime import DATA_DIR

log = get_logger(__name__)


# ── Catálogo (paridad MARU) ──────────────────────────────────────────────


WORD_SEARCH_CATEGORIES: list[dict[str, str]] = [
    {"id": "animales", "name": "🦁 Animales"},
    {"id": "comida", "name": "🍕 Comida"},
    {"id": "paises", "name": "🌎 Países"},
    {"id": "deportes", "name": "⚽ Deportes"},
    {"id": "colores", "name": "🎨 Colores"},
    {"id": "gaming", "name": "🎮 Gaming"},
    {"id": "musica", "name": "🎵 Música"},
    {"id": "minecraft", "name": "⛏️ Minecraft"},
    {"id": "terror", "name": "👻 Terror"},
    {"id": "naturaleza", "name": "🌳 Naturaleza"},
    {"id": "espacio", "name": "🚀 Espacio"},
    {"id": "mitologia", "name": "🐉 Mitología"},
    {"id": "tecnologia", "name": "💻 Tecnología"},
    {"id": "profesiones", "name": "👨‍🚀 Profesiones"},
    {"id": "cuerpo", "name": "💪 Cuerpo"},
    {"id": "ropa", "name": "👕 Ropa"},
    {"id": "cine", "name": "🎬 Cine"},
    {"id": "historia", "name": "📜 Historia"},
    {"id": "oceano", "name": "🌊 Océano"},
]

DEFAULT_WORD_SEARCH: dict[str, Any] = {
    "category": "animales",
    "wordCount": 8,  # 4-12
    "rows": 10,  # 8-15
    "cols": 10,  # 8-15
}

DEFAULT_WORD_BOMB: dict[str, Any] = {
    "turnTime": 15,  # 5-30
    "lives": 3,  # 1-5
}

DEFAULT_DOC: dict[str, Any] = {
    "wordSearch": dict(DEFAULT_WORD_SEARCH),
    "wordSearchLite": dict(DEFAULT_WORD_SEARCH),
    "wordBomb": dict(DEFAULT_WORD_BOMB),
}


def _config_path() -> Path:
    return DATA_DIR / "minigames.json"


def _clamp(v: Any, lo: int, hi: int, default: int) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def _coerce_word_search(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return dict(DEFAULT_WORD_SEARCH)
    cat_ids = {c["id"] for c in WORD_SEARCH_CATEGORIES}
    cat = raw.get("category")
    if not isinstance(cat, str) or cat not in cat_ids:
        cat = DEFAULT_WORD_SEARCH["category"]
    return {
        "category": cat,
        "wordCount": _clamp(raw.get("wordCount"), 4, 12, 8),
        "rows": _clamp(raw.get("rows"), 8, 15, 10),
        "cols": _clamp(raw.get("cols"), 8, 15, 10),
    }


def _coerce_word_bomb(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return dict(DEFAULT_WORD_BOMB)
    return {
        "turnTime": _clamp(raw.get("turnTime"), 5, 30, 15),
        "lives": _clamp(raw.get("lives"), 1, 5, 3),
    }


# ── Service ──────────────────────────────────────────────────────────────


class MinigamesService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._active: dict[str, Any] | None = None
        self._instance: Any = None
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._doc = self._read_doc()

    # ── Persistencia ─────────────────────────────────────────────────────

    def _read_doc(self) -> dict[str, Any]:
        path = _config_path()
        if not path.exists():
            return {
                "wordSearch": dict(DEFAULT_WORD_SEARCH),
                "wordSearchLite": dict(DEFAULT_WORD_SEARCH),
                "wordBomb": dict(DEFAULT_WORD_BOMB),
            }
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.error("minigames.json corrupto — usando defaults")
            return {
                "wordSearch": dict(DEFAULT_WORD_SEARCH),
                "wordSearchLite": dict(DEFAULT_WORD_SEARCH),
                "wordBomb": dict(DEFAULT_WORD_BOMB),
            }
        if not isinstance(raw, dict):
            return dict(DEFAULT_DOC)
        return {
            "wordSearch": _coerce_word_search(raw.get("wordSearch")),
            "wordSearchLite": _coerce_word_search(raw.get("wordSearchLite")),
            "wordBomb": _coerce_word_bomb(raw.get("wordBomb")),
        }

    def _write_doc(self) -> None:
        path = _config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {**self._doc, "updatedAt": int(time.time() * 1000)}
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)

    # ── RPC: meta ────────────────────────────────────────────────────────

    def meta(self, _params: dict[str, Any]) -> dict[str, Any]:
        return {
            "minigames": [
                {
                    "id": "wordSearch",
                    "name": "Sopa de Letras",
                    "icon": "🔤",
                    "description": "Los jugadores escriben !game para unirse y luego marcan inicio y fin de la palabra: A1 C3.",
                },
                {
                    "id": "wordSearchLite",
                    "name": "Sopa Rápida",
                    "icon": "⚡",
                    "description": "Solo la grilla, sin pistas. Rondas automáticas.",
                },
                {
                    "id": "wordBomb",
                    "name": "Bomba de Palabras",
                    "icon": "💣",
                    "description": "Sílaba aleatoria — el jugador actual debe escribir una palabra que la contenga antes de que explote.",
                },
            ],
            "wordSearchCategories": list(WORD_SEARCH_CATEGORIES),
            "ranges": {
                "wordSearch": {
                    "wordCount": [4, 12],
                    "rows": [8, 15],
                    "cols": [8, 15],
                },
                "wordBomb": {
                    "turnTime": [5, 30],
                    "lives": [1, 5],
                },
            },
        }

    # ── RPC: config ──────────────────────────────────────────────────────

    def config_get(self, _params: dict[str, Any]) -> dict[str, Any]:
        return {"config": dict(self._doc)}

    def config_set(self, params: dict[str, Any]) -> dict[str, Any]:
        patch = params.get("patch") or {}
        if not isinstance(patch, dict):
            raise TypeError("patch requerido")
        with self._lock:
            if "wordSearch" in patch:
                self._doc["wordSearch"] = _coerce_word_search(patch["wordSearch"])
            if "wordSearchLite" in patch:
                self._doc["wordSearchLite"] = _coerce_word_search(
                    patch["wordSearchLite"]
                )
            if "wordBomb" in patch:
                self._doc["wordBomb"] = _coerce_word_bomb(patch["wordBomb"])
            self._write_doc()
        return {"ok": True, "config": dict(self._doc)}

    # ── RPC: state ──────────────────────────────────────────────────────

    def state(self, _params: dict[str, Any]) -> dict[str, Any]:
        if self._active is None:
            return {"active": False}
        return {"active": True, **self._active}

    def start(self, params: dict[str, Any]) -> dict[str, Any]:
        """Iniciar un minijuego.

        En G10 esto solo persiste el state local. El engine real (que
        maneja `!game`, vidas, turnos, etc.) se cablea en G14 cuando
        TikTokLive esté conectado.
        """
        mid = params.get("id")
        if mid not in ("wordSearch", "wordSearchLite", "wordBomb"):
            raise ValueError("id ∈ wordSearch|wordSearchLite|wordBomb")
        config_used = (
            _coerce_word_search(params.get("config"))
            if mid != "wordBomb"
            else _coerce_word_bomb(params.get("config"))
        )
        with self._lock:
            self._active = {
                "id": mid,
                "config": config_used,
                "startedAt": int(time.time() * 1000),
            }
            # Persistir como last config.
            if mid in ("wordSearch", "wordSearchLite"):
                self._doc[mid] = config_used
            else:
                self._doc["wordBomb"] = config_used
            self._write_doc()

        # Intentar arrancar el engine si el core está disponible.
        message = self._maybe_start_engine(mid, config_used)
        return {
            "ok": True,
            "active": True,
            "id": mid,
            "startedAt": self._active["startedAt"],
            "engineReady": self._instance is not None,
            "message": message,
        }

    def stop(self, _params: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            was_active = self._active is not None
            self._active = None
            # El core engine no tiene un stop estándar; ignoramos errores.
            try:
                if self._instance and hasattr(self._instance, "stop"):
                    self._instance.stop()
            except Exception:
                pass
            self._instance = None
        return {"ok": True, "wasActive": was_active}

    # ── Engine real (lazy / opcional) ───────────────────────────────────

    def _maybe_start_engine(self, mid: str, config: dict[str, Any]) -> str:
        try:
            from .. import core_bridge

            core_bridge.install()
        except Exception:
            return "core no disponible — solo se persistió la config"
        try:
            # `core.minigames` es un módulo flat (no paquete) — las clases
            # WordSearchGame y WordBombGame viven directamente ahí.
            from core.minigames import WordSearchGame, WordBombGame  # type: ignore

            if mid in ("wordSearch", "wordSearchLite"):
                game = WordSearchGame(rows=config["rows"], cols=config["cols"])
                if hasattr(game, "generate"):
                    game.generate(config["category"], config["wordCount"])
                self._instance = game
                return f"WordSearch iniciado ({mid})"
            if mid == "wordBomb":
                self._instance = WordBombGame(
                    turn_time=config["turnTime"], lives=config["lives"]
                )
                return "WordBomb iniciado"
        except Exception as exc:
            log.warning("minigames.start engine: %s", exc)
            self._instance = None
            return f"engine no disponible: {exc}"
        return ""
