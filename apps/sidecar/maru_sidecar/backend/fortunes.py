"""Servicio `fortunes.*` — sistema de Fortuna/Suerte.

Réplica del sistema MARU original: cuando un viewer envía un regalo
configurado, el bot lee una fortuna aleatoria con voz TTS personalizada.

Este servicio expone:
  - `fortunes.config.get` / `set` — persistencia de {enabled, gift_id, voice,
    volume_pct, categories} dentro de `config.json` clave `"fortunes"`.
  - `fortunes.read` — devuelve una fortuna aleatoria armada (intro + cuerpo)
    para un viewer dado.
  - `fortunes.list-categories` — categorías disponibles + counts.
  - `fortunes.test` — armado + TTS speak en canal "fortuna".

El JSON `fortunes.json` se sembra automáticamente por bootstrap desde
el MARU original (104 buenas, 89 malas, 50 neutrales, etc — 800+ totales).
"""

from __future__ import annotations

import json
import random
import threading
from pathlib import Path
from typing import Any

from ..logger import get_logger
from ..runtime import DATA_DIR
from .settings import SettingsService
from .tts import TtsService

log = get_logger(__name__)

_DEFAULT_CONFIG: dict[str, Any] = {
    "enabled": False,
    "gift_id": "",
    "voice": "en_female_madam_leota",
    "volume_pct": 80,
    "categories": ["good", "bad", "neutral"],
}


class FortunesService:
    def __init__(
        self,
        data_dir: Path = DATA_DIR,
        settings: SettingsService | None = None,
        tts: TtsService | None = None,
    ) -> None:
        self._path = data_dir / "fortunes.json"
        self._lock = threading.Lock()
        self._cache: dict[str, list[str]] | None = None
        self._settings = settings or SettingsService(data_dir)
        self._tts = tts

    def attach_tts(self, tts: TtsService) -> None:
        self._tts = tts

    def _load(self) -> dict[str, list[str]]:
        with self._lock:
            if self._cache is not None:
                return self._cache
            if not self._path.exists():
                log.warning("fortunes.json no existe en %s", self._path)
                self._cache = {"intro_templates": [], "good": [], "bad": []}
                return self._cache
            try:
                data = json.loads(self._path.read_text(encoding="utf-8"))
                self._cache = {
                    k: v for k, v in data.items() if isinstance(v, list)
                }
            except Exception as exc:
                log.error("error leyendo fortunes.json: %s", exc)
                self._cache = {"intro_templates": [], "good": [], "bad": []}
            return self._cache

    def _config(self) -> dict[str, Any]:
        full = self._settings.get({}).get("config", {})
        cfg = full.get("fortunes") or {}
        return {**_DEFAULT_CONFIG, **cfg}

    # ── RPC handlers ──────────────────────────────────────────────────────

    def config_get(self, _params: dict[str, Any]) -> dict[str, Any]:
        return {"config": self._config()}

    def config_set(self, params: dict[str, Any]) -> dict[str, Any]:
        patch = params.get("patch") or {}
        if not isinstance(patch, dict):
            raise TypeError("patch debe ser objeto")
        current = self._config()
        merged = {**current, **patch}
        self._settings.set({"patch": {"fortunes": merged}})
        return {"config": merged}

    def list_categories(self, _params: dict[str, Any]) -> dict[str, Any]:
        data = self._load()
        cats = []
        for k, v in data.items():
            if k == "intro_templates":
                continue
            cats.append({"id": k, "count": len(v), "sample": v[0] if v else ""})
        return {
            "categories": cats,
            "introCount": len(data.get("intro_templates", [])),
            "total": sum(len(v) for k, v in data.items() if k != "intro_templates"),
        }

    def read(self, params: dict[str, Any]) -> dict[str, Any]:
        name = (params.get("name") or "viewer").strip() or "viewer"
        data = self._load()
        cfg = self._config()
        wanted_cats = [
            c for c in (cfg.get("categories") or []) if c in data and data[c]
        ]
        if not wanted_cats:
            wanted_cats = [
                k
                for k, v in data.items()
                if k != "intro_templates" and v
            ]
        if not wanted_cats:
            return {"text": "Sin fortunas disponibles", "intro": "", "body": ""}
        body_cat = random.choice(wanted_cats)
        body = random.choice(data[body_cat])
        intros = data.get("intro_templates") or [""]
        intro = random.choice(intros).format(name=name)
        text = f"{intro} {body}".strip()
        return {"text": text, "intro": intro, "body": body, "category": body_cat}

    def test(self, params: dict[str, Any]) -> dict[str, Any]:
        name = (params.get("name") or "TestViewer").strip() or "TestViewer"
        out = self.read({"name": name})
        if self._tts is None:
            return {"ok": False, "text": out["text"], "error": "TTS no disponible"}
        cfg = self._config()
        try:
            res = self._tts.speak({
                "text": out["text"],
                "voice": cfg.get("voice") or _DEFAULT_CONFIG["voice"],
                "channel": "fortune",
            })
            return {"ok": bool(res.get("ok", True)), "text": out["text"], "tts": res}
        except Exception as exc:
            log.error("fortunes.test TTS falló: %s", exc)
            return {"ok": False, "text": out["text"], "error": str(exc)}
