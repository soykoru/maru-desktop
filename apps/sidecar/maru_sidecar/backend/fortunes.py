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
from .utils.tts_text import clean_user_for_tts

log = get_logger(__name__)

_DEFAULT_CONFIG: dict[str, Any] = {
    "enabled": False,
    "gift_id": "",
    # Antes era `en_female_madam_leota`. Esa voz es inglesa y la API
    # TikTok TTS devolvía audio truncado al leer texto en español
    # (acentos / palabras 100% es). Default nuevo: voz española mexicana.
    "voice": "es_mx_002",
    "volume_pct": 80,
    # Default amplio: incluye 'grosera' (sarcástica) para que la nueva
    # categoría rote desde el primer uso sin que el user la habilite a
    # mano. Si el user achica el set en SettingsDialog, se respeta.
    "categories": [
        "good", "bad", "neutral", "specific", "philosophical",
        "love", "money", "health", "work", "gaming", "social",
        "creative", "mystery", "humor", "stream", "luck", "wisdom",
        "grosera",
    ],
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

    def _mirror_volume_to_tts(self, volume_pct: int) -> None:
        """Single source of truth: cuando el slider de Fortuna cambia,
        propagamos a `tts.config.volume_fortune` (que es lo que el engine
        realmente usa al reproducir). Sin esto el slider de Fortuna era
        decorativo — el volumen real lo manejaba el panel TTS."""
        if self._tts is None:
            return
        try:
            self._tts.config_set({"patch": {"volume_fortune": int(volume_pct)}})
        except Exception:
            log.exception("fortunes: mirror volume → tts falló")

    def _mirror_voice_to_tts(self, voice: str) -> None:
        """Mirror análogo para la voz default — el chat_dispatcher pasa
        explícitamente `voice` por evento, pero el panel TTS también
        necesita reflejar la voz de fortuna por consistencia."""
        if self._tts is None or not voice:
            return
        try:
            self._tts.config_set({"patch": {"fortune_voice": voice}})
        except Exception:
            log.exception("fortunes: mirror voice → tts falló")

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

    # Set viejo de defaults — si el user tiene exactamente este set,
    # asumimos que nunca personalizó las categorías y lo migramos al
    # nuevo default amplio (que ya incluye 'grosera' y las temáticas).
    _LEGACY_DEFAULT_CATS = {"good", "bad", "neutral"}
    _LEGACY_FORTUNE_VOICE = "en_female_madam_leota"

    def _config(self) -> dict[str, Any]:
        full = self._settings.get({}).get("config", {})
        cfg = full.get("fortunes") or {}
        merged = {**_DEFAULT_CONFIG, **cfg}
        cats = merged.get("categories") or []
        if isinstance(cats, list) and set(cats) == self._LEGACY_DEFAULT_CATS:
            merged["categories"] = list(_DEFAULT_CONFIG["categories"])
        # Migrar voz inglesa default histórica a la nueva española —
        # ataca el bug raíz de "solo se lee la intro y se corta".
        if merged.get("voice") == self._LEGACY_FORTUNE_VOICE:
            merged["voice"] = _DEFAULT_CONFIG["voice"]
        return merged

    # ── RPC handlers ──────────────────────────────────────────────────────

    def config_get(self, _params: dict[str, Any]) -> dict[str, Any]:
        cfg = self._config()
        # Override del volumen con el valor REAL del engine TTS — single
        # source of truth. El user mueve el slider en el Sidebar y se
        # ve igual al volumen efectivo.
        if self._tts is not None:
            try:
                tts_cfg = self._tts.config_get({}).get("config", {})
                if "volume_fortune" in tts_cfg:
                    cfg["volume_pct"] = int(tts_cfg["volume_fortune"])
            except Exception:
                pass
        return {"config": cfg}

    def config_set(self, params: dict[str, Any]) -> dict[str, Any]:
        patch = params.get("patch") or {}
        if not isinstance(patch, dict):
            raise TypeError("patch debe ser objeto")
        current = self._config()
        merged = {**current, **patch}
        self._settings.set({"patch": {"fortunes": merged}})
        # Mirror al TTS: si cambió volumen o voz, propagamos al engine
        # TTS que es donde el audio realmente lo usa.
        if "volume_pct" in patch:
            try:
                self._mirror_volume_to_tts(int(patch["volume_pct"]))
            except (TypeError, ValueError):
                pass
        if "voice" in patch and isinstance(patch["voice"], str):
            self._mirror_voice_to_tts(patch["voice"])
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
        # Defensa: el TTS se trunca al toparse con `_` o dígitos en el
        # username (la API TikTok TTS lo rechaza). Limpiamos a solo
        # letras para que la fortuna se lea entera. El caller normal
        # (chat_dispatcher) ya limpia, esto cubre RPC manual / Probar
        # Fortuna desde la UI.
        raw_name = (params.get("name") or "viewer").strip() or "viewer"
        name = clean_user_for_tts(raw_name)
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
