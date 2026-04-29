"""Adapter `system.*` — health, ping, shutdown."""

from __future__ import annotations

import time
from typing import Any

from .. import __version__

_BOOT_MS = int(time.time() * 1000)


class SystemService:
    def ping(self, params: dict[str, Any]) -> dict[str, Any]:
        echo = params.get("echo")
        out: dict[str, Any] = {
            "ok": True,
            "pongAt": int(time.time() * 1000),
            "protocolVersion": 1,
        }
        if isinstance(echo, str):
            out["echo"] = echo
        return out

    def health(self, _params: dict[str, Any]) -> dict[str, Any]:
        return {
            "sidecarVersion": __version__,
            "uptimeMs": int(time.time() * 1000) - _BOOT_MS,
        }

    def shutdown(self, _params: dict[str, Any]) -> dict[str, Any]:
        # El server lo intercepta y dispara su shutdown limpio
        return {"ok": True}
