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
    # overlays.* — el método correcto es `set-config` (no `update`).
    # `set-enabled` se agregó en v1.0.69 (master switch ON/OFF).
    "overlays.list", "overlays.set-config", "overlays.test-event",
    "overlays.set-enabled",
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
async def test_games_list_includes_core_games() -> None:
    """Los 3 juegos core (valheim/terraria/minecraft) deben estar siempre.
    El catálogo se expande con el tiempo (v1.0.69: 7 juegos), por eso
    chequeamos subset y no equality."""
    reg = build_default_registry()
    res = await reg.dispatch("games.list", {})
    ids = {g["id"] for g in res["games"]}
    assert {"valheim", "terraria", "minecraft"}.issubset(ids)
    assert len(ids) >= 3
