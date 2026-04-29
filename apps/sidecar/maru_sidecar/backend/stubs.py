"""Stubs de Fase 1 para los dominios que se conectan en Fase 4.

Cada stub cumple el contrato de `@maru/shared` con respuestas razonables
(values vacíos o "not configured"). Esto deja la UI cableable contra el
sidecar real sin esperar a tener todos los adapters listos, y produce
mensajes de error explícitos cuando se intenta una operación no implementada.
"""

from __future__ import annotations

from typing import Any


def _not_configured(domain: str) -> dict[str, Any]:
    return {"ok": False, "message": f"{domain}: no configurado en F1 — ver F4"}


class RulesService:
    def list(self, _p: dict[str, Any]) -> dict[str, Any]:
        return {"rules": []}

    def upsert(self, params: dict[str, Any]) -> dict[str, Any]:
        return {"rule": params.get("rule", {})}

    def delete(self, _p: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True}

    def toggle(self, _p: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True}

    def test(self, _p: dict[str, Any]) -> dict[str, Any]:
        return {"ok": False, "messages": ["test no implementado en F1"]}


class GamesService:
    def list(self, _p: dict[str, Any]) -> dict[str, Any]:
        return {
            "games": [
                {"id": "valheim", "name": "Valheim", "connected": False},
                {"id": "terraria", "name": "Terraria", "connected": False},
                {"id": "minecraft", "name": "Minecraft", "connected": False},
                {"id": "custom", "name": "Custom", "connected": False},
            ]
        }

    def configure(self, _p: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True}

    def test(self, params: dict[str, Any]) -> dict[str, Any]:
        return _not_configured(f"games.{params.get('gameId')}")

    def spawn(self, params: dict[str, Any]) -> dict[str, Any]:
        return _not_configured(f"games.spawn ({params.get('gameId')})")

    def give_item(self, params: dict[str, Any]) -> dict[str, Any]:
        return _not_configured(f"games.give-item ({params.get('gameId')})")

    def trigger_event(self, params: dict[str, Any]) -> dict[str, Any]:
        return _not_configured(f"games.trigger-event ({params.get('gameId')})")


class SocialService:
    def command(self, _p: dict[str, Any]) -> dict[str, Any]:
        return {"handled": False}

    def config_get(self, _p: dict[str, Any]) -> dict[str, Any]:
        return {"config": {}}

    def config_set(self, _p: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True}


class SpotifyService:
    def status(self, _p: dict[str, Any]) -> dict[str, Any]:
        return {"connected": False}

    def now_playing(self, _p: dict[str, Any]) -> dict[str, Any]:
        return {"isPlaying": False}

    def play_request(self, params: dict[str, Any]) -> dict[str, Any]:
        return _not_configured("spotify.play-request")

    def skip(self, _p: dict[str, Any]) -> dict[str, Any]:
        return {"ok": False}

    def toggle_playback(self, _p: dict[str, Any]) -> dict[str, Any]:
        return _not_configured("spotify.toggle-playback")


class IaService:
    def status(self, _p: dict[str, Any]) -> dict[str, Any]:
        return {"ready": False}

    def ask(self, _p: dict[str, Any]) -> dict[str, Any]:
        return {"ok": False, "answer": "IA no configurada en F1"}

    def config_set(self, _p: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True}


class TtsService:
    def speak(self, _p: dict[str, Any]) -> dict[str, Any]:
        return {"ok": False}

    def stop(self, _p: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True}

    def queue_sizes(self, _p: dict[str, Any]) -> dict[str, Any]:
        return {"chat": 0, "social": 0, "fortune": 0}


class OverlaysService:
    def list(self, _p: dict[str, Any]) -> dict[str, Any]:
        return {"overlays": []}

    def update(self, _p: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True}

    def test_event(self, _p: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True}
