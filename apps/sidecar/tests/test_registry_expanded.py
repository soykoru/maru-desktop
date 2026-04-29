"""Verifica que el registry default cubre todos los métodos del contrato."""

from __future__ import annotations

import pytest

from maru_sidecar.rpc import build_default_registry

EXPECTED = {
    "system.ping", "system.health", "system.shutdown", "ping",
    "tiktok.connect", "tiktok.disconnect", "tiktok.status",
    "rules.list", "rules.upsert", "rules.delete", "rules.toggle", "rules.test",
    "games.list", "games.configure", "games.test",
    "games.spawn", "games.give-item", "games.trigger-event",
    "social.command", "social.config.get", "social.config.set",
    "spotify.status", "spotify.now-playing", "spotify.play-request",
    "spotify.skip", "spotify.toggle-playback",
    "ia.status", "ia.ask", "ia.config.set",
    "tts.speak", "tts.stop", "tts.queue-sizes",
    "overlays.list", "overlays.update", "overlays.test-event",
    "settings.get", "settings.set",
    "backups.list", "backups.create", "backups.restore", "backups.delete",
}


def test_all_methods_registered() -> None:
    reg = build_default_registry()
    have = set(reg.list_names())
    missing = EXPECTED - have
    assert not missing, f"métodos faltantes: {sorted(missing)}"


@pytest.mark.asyncio
async def test_system_health_returns_uptime() -> None:
    reg = build_default_registry()
    res = await reg.dispatch("system.health", {})
    assert "sidecarVersion" in res
    assert isinstance(res["uptimeMs"], int)


@pytest.mark.asyncio
async def test_games_list_returns_4_games() -> None:
    reg = build_default_registry()
    res = await reg.dispatch("games.list", {})
    ids = {g["id"] for g in res["games"]}
    assert ids == {"valheim", "terraria", "minecraft", "custom"}
