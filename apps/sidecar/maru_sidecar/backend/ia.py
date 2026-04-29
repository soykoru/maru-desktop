"""Adapter `ia.*` — wrap completo de `core.ia_engine.IAEngine` (G8).

Réplica de la tab IA del MARU original (`social_config.py`) +
persistencia propia (`data/ia.json`) para que el sidecar mantenga su
config IA sin depender del MainWindow viejo.

Capacidades:
  - 4 proveedores: Claude, Groq (gratis), Gemini (gratis), OpenAI.
  - Keys per-provider (cambiar de proveedor preserva la key del anterior).
  - Modelos por proveedor (`MODELS` dict).
  - Tarifas USD/1M tokens (`COST_RATES`) — solo modelos de pago.
  - SOYKORU_CONTEXT configurable desde la UI (mejora vs original que era
    hardcoded).
  - Test endpoint con timeout 15s (paridad MARU `_request_timeout`).
  - `is_ready` = `enabled` ∧ `api_key` válida.

Tolerante a core no disponible: si `core.ia_engine` falla al cargar,
los métodos devuelven shapes válidos (DEFAULT_CONFIG, providers meta
del fallback hardcoded) en vez de crashear.
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

# ── Defaults / Fallbacks ─────────────────────────────────────────────────


DEFAULT_CONFIG: dict[str, Any] = {
    "enabled": False,
    "provider": "claude",
    "api_key": "",
    "api_keys": {},
    "model": "",
    "max_response_length": 400,
    "cooldown_seconds": 10,
    "system_prompt": "",
}

DEFAULT_SOYKORU_CONTEXT = (
    "Este stream es del tiktoker y youtuber SOYKORU (también conocido como Koru). "
    "Soykoru es un creador de contenido latinoamericano. "
    "Es un gamer que se especializa en Minecraft, Roblox, Valheim, Terraria y más. "
    "Su comunidad es muy activa y participativa en los lives. "
    "Es amigable, divertido, casual y cercano con su comunidad."
)

# Espejo de `core.ia_engine.IAEngine.PROVIDERS` para fallback offline.
FALLBACK_PROVIDERS: dict[str, dict[str, Any]] = {
    "claude": {
        "name": "Claude / Anthropic",
        "url": "https://api.anthropic.com/v1/messages",
        "default_model": "claude-sonnet-4-6",
        "free": False,
        "icon": "🟣",
        "help_url": "https://console.anthropic.com/settings/keys",
        "help_text": "Obtené tu API key en console.anthropic.com → Settings → API Keys.",
    },
    "groq": {
        "name": "Groq (Gratis, recomendado)",
        "url": "https://api.groq.com/openai/v1/chat/completions",
        "default_model": "llama-3.3-70b-versatile",
        "free": True,
        "icon": "⚡",
        "help_url": "https://console.groq.com/keys",
        "help_text": "Gratis. Obtené tu key en console.groq.com → API Keys.",
    },
    "gemini": {
        "name": "Google Gemini (Gratis)",
        "url": "https://generativelanguage.googleapis.com/v1beta/models",
        "default_model": "gemini-2.5-flash-lite",
        "free": True,
        "icon": "🟢",
        "help_url": "https://aistudio.google.com/apikey",
        "help_text": "Gratis. Obtené tu key en aistudio.google.com → Get API key.",
    },
    "openai": {
        "name": "OpenAI",
        "url": "https://api.openai.com/v1/chat/completions",
        "default_model": "gpt-4o-mini",
        "free": False,
        "icon": "🔵",
        "help_url": "https://platform.openai.com/api-keys",
        "help_text": "De pago. Obtené tu key en platform.openai.com → API Keys.",
    },
}

# Espejo de `MODELS` del IAEngine.
FALLBACK_MODELS: dict[str, list[dict[str, str]]] = {
    "claude": [
        {"id": "claude-sonnet-4-6", "name": "⚡ Claude Sonnet 4.6 — Rápido y económico (recomendado)"},
        {"id": "claude-opus-4-6", "name": "💎 Claude Opus 4.6 — Máxima calidad"},
    ],
    "groq": [
        {"id": "llama-3.3-70b-versatile", "name": "⚡ Llama 3.3 70B — Potente, gratis (recomendado)"},
        {"id": "llama-3.1-8b-instant", "name": "🪶 Llama 3.1 8B — Ultra rápido, gratis"},
        {"id": "meta-llama/llama-4-scout-17b-16e-instruct", "name": "🔥 Llama 4 Scout 17B — Nuevo, gratis"},
        {"id": "qwen/qwen3-32b", "name": "🧠 Qwen3 32B — Potente, gratis"},
    ],
    "gemini": [
        {"id": "gemini-2.5-flash-lite", "name": "⚡ Gemini 2.5 Flash Lite — Rápido (recomendado)"},
        {"id": "gemini-2.5-flash", "name": "🔥 Gemini 2.5 Flash — Potente, gratis"},
        {"id": "gemini-2.5-pro", "name": "🧠 Gemini 2.5 Pro — Muy potente"},
    ],
    "openai": [
        {"id": "gpt-4o-mini", "name": "⚡ GPT-4o Mini — Económico (recomendado)"},
        {"id": "gpt-4o", "name": "🧠 GPT-4o — Potente"},
        {"id": "gpt-4.1-mini", "name": "⚡ GPT-4.1 Mini — Nuevo, económico"},
        {"id": "gpt-3.5-turbo", "name": "💬 GPT-3.5 Turbo — Clásico"},
    ],
}

# USD por 1M tokens — solo modelos de pago. Espejo `_COST_RATES`.
FALLBACK_COST_RATES: dict[str, dict[str, float]] = {
    "claude-sonnet-4-6": {"input": 3.0, "output": 15.0},
    "claude-opus-4-6": {"input": 15.0, "output": 75.0},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "gpt-4o": {"input": 2.50, "output": 10.0},
    "gpt-4.1-mini": {"input": 0.40, "output": 1.60},
    "gpt-3.5-turbo": {"input": 0.50, "output": 1.50},
}


def _config_path() -> Path:
    return DATA_DIR / "ia.json"


def _coerce_api_keys(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for k, v in raw.items():
        if isinstance(k, str) and k in FALLBACK_PROVIDERS and isinstance(v, str):
            out[k] = v
    return out


def _coerce_config(raw: Any) -> dict[str, Any]:
    """Coerce dict crudo al shape canónico, aplicando defaults."""
    if not isinstance(raw, dict):
        return dict(DEFAULT_CONFIG)
    out = dict(DEFAULT_CONFIG)
    out["enabled"] = bool(raw.get("enabled", False))
    provider = str(raw.get("provider") or "claude").strip().lower()
    if provider not in FALLBACK_PROVIDERS:
        provider = "claude"
    out["provider"] = provider
    out["api_key"] = str(raw.get("api_key") or "")
    out["api_keys"] = _coerce_api_keys(raw.get("api_keys"))
    # Si no había api_key plano pero sí en api_keys[provider], usarla.
    if not out["api_key"] and out["api_keys"].get(provider):
        out["api_key"] = out["api_keys"][provider]
    out["model"] = str(raw.get("model") or "").strip()
    if not out["model"]:
        out["model"] = FALLBACK_PROVIDERS[provider]["default_model"]
    out["max_response_length"] = max(
        100, min(800, int(raw.get("max_response_length") or 400))
    )
    out["cooldown_seconds"] = max(
        3, min(120, int(raw.get("cooldown_seconds") or 10))
    )
    out["system_prompt"] = str(raw.get("system_prompt") or "")
    return out


def _is_ready(cfg: dict[str, Any]) -> bool:
    return bool(cfg.get("enabled")) and bool((cfg.get("api_key") or "").strip())


# ── Service ──────────────────────────────────────────────────────────────


class IaService:
    def __init__(self) -> None:
        self._engine: Any = None
        self._lock = threading.Lock()
        self._config: dict[str, Any] = self._read_config()
        self._context: str = self._read_context()
        DATA_DIR.mkdir(parents=True, exist_ok=True)

    # ── Helpers de persistencia ──────────────────────────────────────────

    def _read_config(self) -> dict[str, Any]:
        path = _config_path()
        if not path.exists():
            return dict(DEFAULT_CONFIG)
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.error("ia.json corrupto — usando defaults")
            return dict(DEFAULT_CONFIG)
        return _coerce_config(raw if isinstance(raw, dict) else {})

    def _read_context(self) -> str:
        path = _config_path()
        if not path.exists():
            return DEFAULT_SOYKORU_CONTEXT
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return DEFAULT_SOYKORU_CONTEXT
        if isinstance(raw, dict) and isinstance(raw.get("context"), str):
            return raw["context"]
        return DEFAULT_SOYKORU_CONTEXT

    def _write_config(self) -> None:
        path = _config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            **self._config,
            "context": self._context,
            "updatedAt": int(time.time() * 1000),
        }
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)

    # ── Lazy engine ──────────────────────────────────────────────────────

    def _ensure(self) -> Any:
        if self._engine is not None:
            return self._engine
        try:
            from .. import core_bridge

            core_bridge.install()
            from core.ia_engine import IAEngine  # type: ignore
        except Exception as exc:
            log.warning("ia: core no disponible: %s", exc)
            return None
        try:
            self._engine = IAEngine(log=log.info)
            # Aplicar config actual.
            self._apply_to_engine()
            return self._engine
        except Exception as exc:
            log.exception("ia init error: %s", exc)
            return None

    def _apply_to_engine(self) -> None:
        if self._engine is None:
            return
        cfg = self._config
        try:
            self._engine.configure(
                enabled=cfg["enabled"],
                provider=cfg["provider"],
                api_key=cfg["api_key"],
                model=cfg["model"],
                max_length=cfg["max_response_length"],
                cooldown=cfg["cooldown_seconds"],
                system_prompt=cfg["system_prompt"],
                api_keys=cfg["api_keys"],
            )
            # Inyectar SOYKORU_CONTEXT si el engine lo soporta.
            if hasattr(self._engine, "SOYKORU_CONTEXT"):
                self._engine.SOYKORU_CONTEXT = self._context
        except Exception as exc:
            log.warning("ia._apply_to_engine: %s", exc)

    # ── RPC: status ──────────────────────────────────────────────────────

    def status(self, _params: dict[str, Any]) -> dict[str, Any]:
        return {
            "ready": _is_ready(self._config),
            "provider": self._config["provider"],
            "model": self._config["model"],
            "enabled": bool(self._config.get("enabled")),
        }

    # ── RPC: config ──────────────────────────────────────────────────────

    def config_get(self, _params: dict[str, Any]) -> dict[str, Any]:
        # Devolver una copia para que el caller no mute el estado interno.
        cfg = dict(self._config)
        cfg["api_keys"] = dict(self._config["api_keys"])
        return {"config": cfg, "ready": _is_ready(self._config)}

    def config_set(self, params: dict[str, Any]) -> dict[str, Any]:
        patch = params.get("patch") or {}
        if not isinstance(patch, dict):
            raise TypeError("patch requerido")

        with self._lock:
            new_cfg = dict(self._config)
            new_cfg["api_keys"] = dict(self._config["api_keys"])

            # Aplicar patch field-by-field.
            for key in (
                "enabled",
                "provider",
                "api_key",
                "model",
                "max_response_length",
                "cooldown_seconds",
                "system_prompt",
            ):
                if key in patch:
                    new_cfg[key] = patch[key]

            if "api_keys" in patch:
                new_cfg["api_keys"] = {
                    **new_cfg["api_keys"],
                    **_coerce_api_keys(patch["api_keys"]),
                }

            # Si cambiamos provider, restaurar la key guardada para ese provider.
            new_provider = (
                str(patch.get("provider") or new_cfg.get("provider") or "claude")
                .strip()
                .lower()
            )
            if new_provider in FALLBACK_PROVIDERS and (
                "provider" in patch or "api_key" not in patch
            ):
                stored = new_cfg["api_keys"].get(new_provider, "")
                if "api_key" not in patch:
                    new_cfg["api_key"] = stored
                # Fix model si quedó de un provider previo y no coincide.
                models_for_p = [m["id"] for m in FALLBACK_MODELS.get(new_provider, [])]
                if new_cfg["model"] not in models_for_p:
                    new_cfg["model"] = FALLBACK_PROVIDERS[new_provider]["default_model"]

            # Persistir api_key actual en api_keys[provider].
            if new_cfg["api_key"]:
                new_cfg["api_keys"][new_cfg["provider"]] = new_cfg["api_key"]

            self._config = _coerce_config(new_cfg)
            self._write_config()
            self._apply_to_engine()

        return {"ok": True, "config": self.config_get({})["config"]}

    # ── RPC: providers meta ──────────────────────────────────────────────

    def providers_meta(self, _params: dict[str, Any]) -> dict[str, Any]:
        """Devuelve PROVIDERS + MODELS + COST_RATES en una sola llamada."""
        # Si el engine real está disponible, preferir sus datos exactos.
        e = self._ensure()
        providers = dict(FALLBACK_PROVIDERS)
        models = {k: list(v) for k, v in FALLBACK_MODELS.items()}
        cost_rates = dict(FALLBACK_COST_RATES)
        if e is not None:
            try:
                if hasattr(e, "PROVIDERS"):
                    for pid, raw in e.PROVIDERS.items():
                        if not isinstance(raw, dict):
                            continue
                        prov = providers.setdefault(pid, dict(FALLBACK_PROVIDERS.get(pid, {})))
                        prov["name"] = str(raw.get("name") or prov.get("name") or pid)
                        prov["default_model"] = str(
                            raw.get("default_model") or prov.get("default_model") or ""
                        )
                        prov["free"] = bool(raw.get("free", prov.get("free", False)))
                if hasattr(e, "MODELS"):
                    for pid, raw_list in e.MODELS.items():
                        if not isinstance(raw_list, (list, tuple)):
                            continue
                        models[pid] = [
                            {"id": str(m[0]), "name": str(m[1])}
                            for m in raw_list
                            if isinstance(m, (list, tuple)) and len(m) >= 2
                        ]
                if hasattr(e, "_COST_RATES"):
                    cost_rates = {
                        str(k): {"input": float(v[0]), "output": float(v[1])}
                        for k, v in e._COST_RATES.items()
                        if isinstance(v, (list, tuple)) and len(v) >= 2
                    }
            except Exception as exc:
                log.warning("providers_meta: lectura de core falló: %s", exc)
        return {
            "providers": providers,
            "models": models,
            "costRates": cost_rates,
        }

    # ── RPC: context ─────────────────────────────────────────────────────

    def context_get(self, _params: dict[str, Any]) -> dict[str, Any]:
        return {
            "context": self._context,
            "isDefault": self._context == DEFAULT_SOYKORU_CONTEXT,
            "default": DEFAULT_SOYKORU_CONTEXT,
        }

    def context_set(self, params: dict[str, Any]) -> dict[str, Any]:
        ctx = params.get("context")
        if not isinstance(ctx, str):
            raise TypeError("context debe ser string")
        text = ctx.strip()
        if not text:
            text = DEFAULT_SOYKORU_CONTEXT
        with self._lock:
            self._context = text
            self._write_config()
            self._apply_to_engine()
        return {"ok": True, "context": self._context}

    # ── RPC: ask + test ──────────────────────────────────────────────────

    def ask(self, params: dict[str, Any]) -> dict[str, Any]:
        e = self._ensure()
        user = str(params.get("user") or "?").strip() or "?"
        question = params.get("question")
        if not isinstance(question, str) or not question.strip():
            return {"ok": False, "answer": "pregunta vacía"}
        if e is None:
            return {"ok": False, "answer": "IA no disponible"}
        if not _is_ready(self._config):
            return {
                "ok": False,
                "answer": "Configurá la IA primero (proveedor + API key + activar)",
            }
        try:
            ok, answer = e.ask(user, question)
            meta = getattr(e, "_last_meta", {}) or {}
        except Exception as exc:
            return {"ok": False, "answer": str(exc)}
        return {"ok": bool(ok), "answer": str(answer), "meta": dict(meta)}

    def test(self, params: dict[str, Any]) -> dict[str, Any]:
        """Test de conectividad/configuración con una pregunta simple.

        Retorna `{ok, answer, meta, latencyMs}`. No persiste nada — útil
        para validar config antes de guardar.
        """
        question = (params.get("question") or "Saluda al stream con 1 frase corta.").strip()
        e = self._ensure()
        if e is None:
            return {
                "ok": False,
                "answer": "core.ia_engine no disponible — instalá deps del sidecar",
                "latencyMs": 0,
            }
        if not _is_ready(self._config):
            return {
                "ok": False,
                "answer": "Configurá la IA primero (proveedor + API key + activar)",
                "latencyMs": 0,
            }
        t0 = time.time()
        try:
            ok, answer = e.ask("TestUser", question)
            meta = getattr(e, "_last_meta", {}) or {}
        except Exception as exc:
            return {
                "ok": False,
                "answer": str(exc),
                "latencyMs": int((time.time() - t0) * 1000),
            }
        return {
            "ok": bool(ok),
            "answer": str(answer),
            "meta": dict(meta),
            "latencyMs": int((time.time() - t0) * 1000),
        }
