"""Adapter `overlays.*` — usa el `OverlayClient` del core para listar y
testear overlays. La galería completa con preview se mantiene en el cliente."""

from __future__ import annotations

import threading
from typing import Any

from ..logger import get_logger

log = get_logger(__name__)

_FALLBACK_OVERLAYS = [
    {
        "id": "taps",
        "name": "Meta de Taps",
        "icon": "❤️",
        "description": "Barra de progreso animada con meta de likes",
        "config": {"goal": 1000, "color": "#1DB954"},
    },
    {
        "id": "streak",
        "name": "Racha (!racha)",
        "icon": "🔥",
        "description": "Llama animada con días de racha (comando !racha)",
        "config": {"duration": 6000, "label": "DÍAS DE RACHA"},
    },
]

# Placeholders "próximamente" que el original muestra como tarjetas
# inactivas en la galería.
_PLACEHOLDERS = [
    {
        "id": "_gifts_placeholder",
        "name": "Alerta de Gifts",
        "icon": "🎁",
        "description": "Pop-up animado al llegar regalos. Próximamente.",
        "placeholder": True,
    },
    {
        "id": "_top_likers_placeholder",
        "name": "Top Likers",
        "icon": "👥",
        "description": "Ranking en vivo de los que más likes dan. Próximamente.",
        "placeholder": True,
    },
    {
        "id": "_follows_placeholder",
        "name": "Alerta de Follows",
        "icon": "⭐",
        "description": "Pop-up al llegar nuevos seguidores. Próximamente.",
        "placeholder": True,
    },
]


class OverlaysService:
    def __init__(self) -> None:
        self._client: Any = None
        self._lock = threading.Lock()

    def _ensure(self) -> Any:
        if self._client is not None:
            return self._client
        try:
            from .. import core_bridge
            core_bridge.install()
            from core.overlays import OverlayClient  # type: ignore
        except Exception as exc:
            log.warning("overlays: core no disponible: %s", exc)
            return None
        try:
            self._client = OverlayClient()
            return self._client
        except Exception as exc:
            log.exception("overlays init error: %s", exc)
            return None

    def _registry(self) -> dict[str, Any]:
        """Lee el OVERLAY_REGISTRY real del core (single source of truth)."""
        try:
            from .. import core_bridge
            core_bridge.install()
            from core.overlays import OVERLAY_REGISTRY  # type: ignore
            return dict(OVERLAY_REGISTRY)
        except Exception:
            return {}

    def list(self, _params: dict[str, Any]) -> dict[str, Any]:
        c = self._ensure()
        registry = self._registry()
        result: list[dict[str, Any]] = []

        # Overlays reales del registry del core (taps, streak, futuros).
        if registry:
            for oid, spec in registry.items():
                url = ""
                cfg = dict(spec.get("default") or {})
                enabled = bool(cfg.get("enabled", True))
                if c is not None:
                    try:
                        if hasattr(c, "get_overlay_url"):
                            url = c.get_overlay_url(oid) or ""
                        if hasattr(c, "get_overlay_config"):
                            cfg = c.get_overlay_config(oid) or cfg
                        if hasattr(c, "is_overlay_enabled"):
                            enabled = bool(c.is_overlay_enabled(oid))
                    except Exception as exc:
                        log.debug("overlay %s: %s", oid, exc)
                result.append({
                    "id": oid,
                    "name": spec.get("name") or oid.title(),
                    "icon": spec.get("icon") or "🎬",
                    "description": spec.get("description") or "",
                    "url": url,
                    "enabled": enabled,
                    "config": cfg,
                    "placeholder": False,
                })
        else:
            # Fallback si el core no está disponible
            for spec in _FALLBACK_OVERLAYS:
                result.append({
                    **spec,
                    "url": "",
                    "enabled": True,
                    "placeholder": False,
                })

        # Placeholders "próximamente" (paridad MARU original)
        for ph in _PLACEHOLDERS:
            result.append({
                **ph,
                "url": "",
                "enabled": False,
                "config": {},
            })

        return {"overlays": result}

    def update(self, params: dict[str, Any]) -> dict[str, Any]:
        c = self._ensure()
        oid = params.get("overlayId")
        patch = params.get("patch") or {}
        if not isinstance(oid, str):
            raise TypeError("overlayId requerido")
        if c is None:
            return {"ok": False}
        try:
            c.update_overlay(oid, **patch)
            return {"ok": True}
        except Exception as exc:
            log.warning("overlays.update: %s", exc)
            return {"ok": False}

    def test_event(self, params: dict[str, Any]) -> dict[str, Any]:
        c = self._ensure()
        oid = params.get("overlayId")
        event_type = params.get("eventType", "tap")
        data = params.get("data") or {"count": 1}
        if not isinstance(oid, str):
            raise TypeError("overlayId requerido")
        if c is None:
            return {"ok": False}
        try:
            c.send_event(event_type, data)
            return {"ok": True}
        except Exception as exc:
            log.warning("overlays.test_event: %s", exc)
            return {"ok": False}
