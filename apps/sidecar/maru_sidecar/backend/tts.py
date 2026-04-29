"""Adapter `tts.*` — wrap completo de `core.tts_engine.TTSEngine` (G9).

Capacidades MARU:
  - 3 canales independientes (chat/social/fortune) con colas separadas.
  - 74 voces hardcoded (`VOICES` dict).
  - 3 niveles de resolución de voz: default (engine) → perfil/global →
    per-user.
  - Cache MD5 audio MP3 + clear_cache al boot.
  - Volúmenes por canal (chat / social / fortune) + master enabled.
  - Username normalization `lower().replace("@", "").replace(" ", "")`.

Persistencia propia: `data/voices.json` con shape:
    {
      "config": {
        "default_voice", "voice_mode" ('global'|'profile'),
        "enabled", "enabled_chat", "enabled_social", "enabled_fortune",
        "volume_chat", "volume_social", "volume_fortune"
      },
      "user_voices": { "<username_norm>": "<voice_id>", ... },
      "global_voices": { ... },                   # mejora G9 (reservado)
      "profile_voices": { "<gameId>": { ... } }   # mejora G9 (reservado)
    }

Tolerante a core no disponible: list_voices devuelve 74 hardcoded,
config_get devuelve defaults, las operaciones que dependen del engine
retornan {ok: false, message: ...} con explicación clara.
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

# ── Defaults / Constantes ────────────────────────────────────────────────


DEFAULT_CONFIG: dict[str, Any] = {
    "enabled": True,
    "enabled_chat": True,
    "enabled_social": True,
    "enabled_fortune": True,
    "default_voice": "es_mx_002",   # canal CHAT
    "social_voice": "es_mx_002",    # canal SOCIAL (paridad MARU `config["social_voice"]`)
    "fortune_voice": "en_female_madam_leota",  # canal FORTUNA
    "voice_mode": "global",  # 'global' | 'profile'
    "volume_chat": 80,  # 0-100 (UI). Engine usa 0.0-1.0.
    "volume_social": 85,
    "volume_fortune": 85,
}

# Espejo de `core.tts_engine.TTSEngine.VOICES` (74 voces).
# Categorización por familia para grouping en la UI.
FALLBACK_VOICES: dict[str, dict[str, str]] = {
    # ⭐ Populares
    "en_us_002": {"name": "⭐ Jessie (Female Popular)", "family": "popular"},
    "en_us_006": {"name": "⭐ Joey (Male Popular)", "family": "popular"},
    "en_male_narration": {"name": "⭐ Narrator (Épico)", "family": "popular"},
    "en_us_ghostface": {"name": "⭐ Ghostface (Scream)", "family": "popular"},
    "es_mx_002": {"name": "⭐ Español México", "family": "popular"},
    # 🎭 Personajes
    "en_us_c3po": {"name": "🤖 C-3PO", "family": "characters"},
    "en_us_stitch": {"name": "👽 Stitch", "family": "characters"},
    "en_us_stormtrooper": {"name": "⚔️ Stormtrooper", "family": "characters"},
    "en_us_rocket": {"name": "🦝 Rocket Raccoon", "family": "characters"},
    "en_us_chewbacca": {"name": "🐻 Chewbacca", "family": "characters"},
    "en_male_ghosthost": {"name": "👻 Ghost Host", "family": "characters"},
    "en_female_madam_leota": {"name": "🔮 Madame Leota", "family": "characters"},
    # 🎃 Especiales / Festividades
    "en_male_grinch": {"name": "🎄 Grinch", "family": "specials"},
    "en_male_pirate": {"name": "🏴‍☠️ Pirata", "family": "specials"},
    "en_male_wizard": {"name": "🧙 Mago/Wizard", "family": "specials"},
    "en_male_santa": {"name": "🎅 Santa Claus", "family": "specials"},
    "en_male_cupid": {"name": "💘 Cupido", "family": "specials"},
    "en_female_grandma": {"name": "👵 Abuelita", "family": "specials"},
    "en_female_betty": {"name": "🧟 Betty Zombie", "family": "specials"},
    "en_male_trevor": {"name": "😈 Trevor (Creepy)", "family": "specials"},
    "en_male_m2_xhxs_m03_christmas": {
        "name": "🎄 Christmas Singer",
        "family": "specials",
    },
    # 🇺🇸 Inglés US
    "en_us_001": {"name": "🇺🇸 US Female 1 (Warm)", "family": "english_us"},
    "en_us_007": {"name": "🇺🇸 US Male Professor", "family": "english_us"},
    "en_us_008": {"name": "🇺🇸 US Male 2", "family": "english_us"},
    "en_us_009": {"name": "🇺🇸 US Male Scientist", "family": "english_us"},
    "en_us_010": {"name": "🇺🇸 US Male Confident", "family": "english_us"},
    "en_male_funny": {"name": "😂 Wacky/Gracioso", "family": "english_us"},
    "en_female_emotional": {
        "name": "😌 Peaceful/Tranquila",
        "family": "english_us",
    },
    "en_male_cody": {"name": "😐 Serious/Serio", "family": "english_us"},
    "en_female_samc": {"name": "👩 Sam Female", "family": "english_us"},
    "en_male_jarvis": {"name": "🤖 Jarvis (AI)", "family": "english_us"},
    "en_male_ashmagic": {"name": "✨ Ash Magic", "family": "english_us"},
    "en_male_olantekkers": {"name": "⚽ Olan Tekkers", "family": "english_us"},
    "en_male_jomboy": {"name": "🎙️ Jomboy", "family": "english_us"},
    "en_female_shenna": {"name": "👩‍🦰 Shenna", "family": "english_us"},
    "en_female_pansino": {"name": "🍰 Rosanna Pansino", "family": "english_us"},
    "en_male_deadpool": {"name": "🦸 Deadpool Style", "family": "english_us"},
    # 🇬🇧 Inglés UK
    "en_uk_001": {"name": "🇬🇧 UK Male 1", "family": "english_uk"},
    "en_uk_003": {"name": "🇬🇧 UK Male 2", "family": "english_uk"},
    "en_male_ukbutler": {"name": "🎩 UK Butler", "family": "english_uk"},
    "en_female_richgirl": {"name": "💎 UK Rich Girl", "family": "english_uk"},
    "en_male_ukneighbor": {"name": "🏠 UK Neighbor", "family": "english_uk"},
    # 🇦🇺 Inglés Australiano
    "en_au_001": {"name": "🇦🇺 AU Female", "family": "english_au"},
    "en_au_002": {"name": "🇦🇺 AU Male", "family": "english_au"},
    # 🇪🇸 Español
    "es_002": {"name": "🇪🇸 España Female", "family": "spanish"},
    # 🇫🇷 Francés
    "fr_001": {"name": "🇫🇷 French Male 1", "family": "french"},
    "fr_002": {"name": "🇫🇷 French Male 2", "family": "french"},
    # 🇩🇪 Alemán
    "de_001": {"name": "🇩🇪 German Female", "family": "german"},
    "de_002": {"name": "🇩🇪 German Male", "family": "german"},
    # 🇮🇹 Italiano
    "it_male_m18": {"name": "🇮🇹 Italian Male", "family": "italian"},
    # 🇧🇷 Portugués
    "br_001": {"name": "🇧🇷 Brazil Female 1", "family": "portuguese"},
    "br_003": {"name": "🇧🇷 Brazil Female 2", "family": "portuguese"},
    "br_004": {"name": "🇧🇷 Brazil Female 3", "family": "portuguese"},
    "br_005": {"name": "🇧🇷 Brazil Male", "family": "portuguese"},
    # 🇯🇵 Japonés
    "jp_001": {"name": "🇯🇵 Japanese Female 1", "family": "asian"},
    "jp_003": {"name": "🇯🇵 Japanese Female 2", "family": "asian"},
    "jp_005": {"name": "🇯🇵 Japanese Female 3", "family": "asian"},
    "jp_006": {"name": "🇯🇵 Japanese Male", "family": "asian"},
    # 🇰🇷 Coreano
    "kr_002": {"name": "🇰🇷 Korean Male 1", "family": "asian"},
    "kr_003": {"name": "🇰🇷 Korean Female", "family": "asian"},
    "kr_004": {"name": "🇰🇷 Korean Male 2", "family": "asian"},
    # 🇨🇳 Chino
    "zh_male_rap": {"name": "🇨🇳 Chinese Rap", "family": "asian"},
    # 🇮🇩 Indonesio
    "id_001": {"name": "🇮🇩 Indonesian Female", "family": "asian"},
    # 🎵 Cantantes
    "en_male_sing_deep_jingle": {"name": "🎵 Deep Jingle", "family": "singing"},
    "en_female_ht_f08_halloween": {
        "name": "🎃 Halloween Song",
        "family": "singing",
    },
    "en_male_m03_classical": {
        "name": "🎻 Classical Singer",
        "family": "singing",
    },
    "en_female_f08_salut_damour": {
        "name": "💕 Salut D'amour",
        "family": "singing",
    },
    "en_female_ht_f08_glorious": {
        "name": "✨ Glorious Voice",
        "family": "singing",
    },
    "en_male_sing_funny_it_goes_up": {
        "name": "🎢 Funny Singing",
        "family": "singing",
    },
    "en_female_ht_f08_wonderful_world": {
        "name": "🌍 Wonderful World",
        "family": "singing",
    },
    "en_male_m03_lobby": {"name": "🎶 Lobby Music", "family": "singing"},
    "en_male_m03_sunshine_soon": {
        "name": "☀️ Sunshine Soon",
        "family": "singing",
    },
    "en_female_f08_warmy_breeze": {
        "name": "🌸 Warmy Breeze",
        "family": "singing",
    },
    "en_female_f08_twinkle": {"name": "✨ Twinkle", "family": "singing"},
}

FAMILY_LABELS: dict[str, str] = {
    "popular": "⭐ Populares",
    "characters": "🎭 Personajes",
    "specials": "🎃 Especiales",
    "english_us": "🇺🇸 Inglés US",
    "english_uk": "🇬🇧 Inglés UK",
    "english_au": "🇦🇺 Inglés AU",
    "spanish": "🇪🇸 Español",
    "french": "🇫🇷 Francés",
    "german": "🇩🇪 Alemán",
    "italian": "🇮🇹 Italiano",
    "portuguese": "🇧🇷 Portugués",
    "asian": "🌏 Asiáticos",
    "singing": "🎵 Cantantes",
}


def normalize_username(raw: Any) -> str:
    """Espejo de la normalización del MARU original."""
    if not isinstance(raw, str):
        return ""
    return raw.strip().lower().replace("@", "").replace(" ", "")


def _config_path() -> Path:
    return DATA_DIR / "voices.json"


def _coerce_config(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return dict(DEFAULT_CONFIG)
    out = dict(DEFAULT_CONFIG)
    for k in (
        "enabled",
        "enabled_chat",
        "enabled_social",
        "enabled_fortune",
    ):
        if k in raw:
            out[k] = bool(raw[k])
    for vk in ("default_voice", "social_voice", "fortune_voice"):
        v = raw.get(vk)
        if isinstance(v, str) and v.strip():
            out[vk] = v
    if raw.get("voice_mode") in ("global", "profile"):
        out["voice_mode"] = raw["voice_mode"]
    for k in ("volume_chat", "volume_social", "volume_fortune"):
        if k in raw:
            try:
                out[k] = max(0, min(100, int(raw[k])))
            except (TypeError, ValueError):
                pass
    return out


# ── Service ──────────────────────────────────────────────────────────────


class TtsService:
    def __init__(self) -> None:
        self._eng: Any = None
        self._lock = threading.Lock()
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._doc: dict[str, Any] = self._read_doc()

    # ── Persistencia ─────────────────────────────────────────────────────

    def _read_doc(self) -> dict[str, Any]:
        path = _config_path()
        if not path.exists():
            return {
                "config": dict(DEFAULT_CONFIG),
                "user_voices": {},
                "global_voices": {},
                "profile_voices": {},
            }
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.error("voices.json corrupto — usando defaults")
            return {
                "config": dict(DEFAULT_CONFIG),
                "user_voices": {},
                "global_voices": {},
                "profile_voices": {},
            }
        if not isinstance(raw, dict):
            raw = {}
        cfg = _coerce_config(raw.get("config"))
        users_raw = raw.get("user_voices") or {}
        if not isinstance(users_raw, dict):
            users_raw = {}
        user_voices = {
            str(k).lower(): str(v)
            for k, v in users_raw.items()
            if isinstance(k, str) and isinstance(v, str)
        }
        return {
            "config": cfg,
            "user_voices": user_voices,
            "global_voices": raw.get("global_voices") or {},
            "profile_voices": raw.get("profile_voices") or {},
        }

    def _write_doc(self) -> None:
        path = _config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {**self._doc, "updatedAt": int(time.time() * 1000)}
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        tmp.replace(path)

    # ── Engine lazy ──────────────────────────────────────────────────────

    def _ensure(self) -> Any:
        if self._eng is not None:
            return self._eng
        try:
            from .. import core_bridge

            core_bridge.install()
            from core.tts_engine import TTSEngine  # type: ignore
            from ..runtime import TTS_CACHE_DIR
        except Exception as exc:
            log.warning("tts: core no disponible: %s", exc)
            return None
        try:
            self._eng = TTSEngine(cache_dir=TTS_CACHE_DIR)
            self._apply_to_engine()
            return self._eng
        except Exception as exc:
            log.exception("tts init error: %s", exc)
            return None

    def _apply_to_engine(self) -> None:
        if self._eng is None:
            return
        cfg = self._doc["config"]
        try:
            for k in (
                "enabled",
                "enabled_chat",
                "enabled_social",
                "enabled_fortune",
                "default_voice",
            ):
                if hasattr(self._eng, k):
                    setattr(self._eng, k, cfg[k])
            for k in ("volume_chat", "volume_social", "volume_fortune"):
                attr = k.replace("volume_chat", "volume").replace("volume_", "volume_")
                # Mapear a la naming del engine: volume / volume_social / volume_fortune.
                target = "volume" if k == "volume_chat" else k
                if hasattr(self._eng, target):
                    setattr(self._eng, target, max(0, min(100, int(cfg[k]))) / 100.0)
            # User voices.
            self._eng.user_voices = dict(self._doc["user_voices"])
        except Exception as exc:
            log.warning("tts._apply_to_engine: %s", exc)

    # ── RPC: voces catalog ───────────────────────────────────────────────

    def list_voices(self, _params: dict[str, Any]) -> dict[str, Any]:
        """Devuelve catálogo completo + agrupamiento por familia.

        Si el engine real está disponible, prefiere su `VOICES` dict
        (incluye voces que el core agregue). Si no, usa el fallback
        hardcoded de las 74 originales.
        """
        e = self._ensure()
        voices_out: list[dict[str, str]] = []
        seen: set[str] = set()
        if e is not None and hasattr(e, "VOICES"):
            try:
                for vid, vname in e.VOICES.items():
                    if not isinstance(vid, str):
                        continue
                    family = (
                        FALLBACK_VOICES.get(vid, {}).get("family") or "other"
                    )
                    voices_out.append(
                        {"id": vid, "name": str(vname), "family": family}
                    )
                    seen.add(vid)
            except Exception as exc:
                log.warning("list_voices from core failed: %s", exc)

        # Completar con fallback si el core no aportó.
        if not voices_out:
            for vid, meta in FALLBACK_VOICES.items():
                voices_out.append(
                    {"id": vid, "name": meta["name"], "family": meta["family"]}
                )

        return {
            "voices": voices_out,
            "families": {
                fid: FAMILY_LABELS.get(fid, fid.title())
                for fid in sorted({v["family"] for v in voices_out})
            },
            "total": len(voices_out),
        }

    # ── RPC: config ──────────────────────────────────────────────────────

    def config_get(self, _params: dict[str, Any]) -> dict[str, Any]:
        return {"config": dict(self._doc["config"])}

    def config_set(self, params: dict[str, Any]) -> dict[str, Any]:
        patch = params.get("patch") or {}
        if not isinstance(patch, dict):
            raise TypeError("patch requerido")
        with self._lock:
            merged = {**self._doc["config"], **patch}
            self._doc["config"] = _coerce_config(merged)
            self._write_doc()
            self._apply_to_engine()
        return {"ok": True, "config": dict(self._doc["config"])}

    # ── RPC: user voices ─────────────────────────────────────────────────

    def user_voices_list(self, _params: dict[str, Any]) -> dict[str, Any]:
        items = [
            {"username": u, "voice": v}
            for u, v in sorted(self._doc["user_voices"].items())
        ]
        return {"userVoices": items, "total": len(items)}

    def user_voices_upsert(self, params: dict[str, Any]) -> dict[str, Any]:
        username = normalize_username(params.get("username"))
        voice = params.get("voice")
        if not username:
            raise ValueError("username requerido")
        if not isinstance(voice, str) or not voice.strip():
            raise ValueError("voice requerido")
        with self._lock:
            self._doc["user_voices"][username] = voice.strip()
            self._write_doc()
            self._apply_to_engine()
        return {"ok": True, "username": username, "voice": voice.strip()}

    def user_voices_delete(self, params: dict[str, Any]) -> dict[str, Any]:
        username = normalize_username(params.get("username"))
        if not username:
            raise ValueError("username requerido")
        with self._lock:
            removed = self._doc["user_voices"].pop(username, None)
            if removed is not None:
                self._write_doc()
                self._apply_to_engine()
        return {"ok": True, "removed": removed is not None}

    def user_voices_clear(self, _params: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            count = len(self._doc["user_voices"])
            self._doc["user_voices"] = {}
            self._write_doc()
            self._apply_to_engine()
        return {"ok": True, "removed": count}

    # ── RPC: speak / test / stop / queue ─────────────────────────────────

    def speak(self, params: dict[str, Any]) -> dict[str, Any]:
        e = self._ensure()
        if e is None:
            return {"ok": False, "message": "core.tts_engine no disponible"}
        text = str(params.get("text") or "").strip()
        channel = str(params.get("channel") or "chat").lower()
        user = params.get("user")
        # Fallback por canal: si el caller no pasa `voice`, cada canal usa
        # SU voz configurada (paridad MARU `_social_speak` y `_social_fortune_speak`).
        # Antes todo el mundo caía a `default_voice` y la voz social/fortune
        # nunca se aplicaba.
        cfg = self._doc["config"]
        if channel == "social":
            voice = params.get("voice") or cfg.get("social_voice") or cfg["default_voice"]
        elif channel == "fortune":
            voice = params.get("voice") or cfg.get("fortune_voice") or cfg["default_voice"]
        else:
            voice = params.get("voice") or cfg["default_voice"]
        if not text:
            return {"ok": False, "message": "text requerido"}
        try:
            if channel == "social":
                ok = bool(e.speak_social(text, voice=voice))
            elif channel == "fortune":
                ok = bool(e.speak_fortune(text, voice=voice))
            else:
                ok = bool(e.speak(text, voice=voice, user=user))
        except Exception as exc:
            log.warning("tts.speak: %s", exc)
            return {"ok": False, "message": str(exc)}
        return {"ok": ok}

    def test(self, params: dict[str, Any]) -> dict[str, Any]:
        """Test inmediato — usa speak_now (priority queue) cuando aplica.

        Si vino `voice`, prueba ESA voz; si no, usa default_voice.
        Si vino `username`, anuncia "Hola, soy {user}" (paridad MARU).
        """
        e = self._ensure()
        if e is None:
            return {"ok": False, "message": "core.tts_engine no disponible"}
        voice = params.get("voice") or self._doc["config"]["default_voice"]
        username = params.get("username")
        if username:
            text = f"Hola, soy {normalize_username(username) or username}"
        else:
            text = str(params.get("text") or "Esta es una prueba del sistema TTS")
        try:
            ok = (
                bool(e.speak_now(text, voice=voice))
                if hasattr(e, "speak_now")
                else bool(e.speak(text, voice=voice))
            )
        except Exception as exc:
            return {"ok": False, "message": str(exc)}
        return {"ok": ok, "voice": voice, "text": text}

    def stop(self, _params: dict[str, Any]) -> dict[str, Any]:
        e = self._ensure()
        if e is None:
            return {"ok": True}
        try:
            e.stop()
        except Exception:
            pass
        return {"ok": True}

    def queue_sizes(self, _params: dict[str, Any]) -> dict[str, Any]:
        e = self._ensure()
        if e is None:
            return {"chat": 0, "social": 0, "fortune": 0}
        try:
            sizes = (
                e.get_queue_sizes()
                if hasattr(e, "get_queue_sizes")
                else {}
            ) or {}
            return {
                "chat": int(sizes.get("chat", 0)),
                "social": int(sizes.get("social", 0)),
                "fortune": int(sizes.get("fortune", 0)),
            }
        except Exception:
            return {"chat": 0, "social": 0, "fortune": 0}

    def clear_cache(self, _params: dict[str, Any]) -> dict[str, Any]:
        e = self._ensure()
        if e is None:
            return {"ok": False, "message": "core.tts_engine no disponible"}
        try:
            if hasattr(e, "clear_cache"):
                e.clear_cache()
        except Exception as exc:
            return {"ok": False, "message": str(exc)}
        return {"ok": True}
