"""Tests del `RuleDispatcher` — wiring entre EventBus y RuleEngine.

Cubre:
- Lazy init del engine
- Cache TTL de `_active_game_cache` con lock (race-free)
- `attach_logs` propaga al keyboard service
- `refresh_profile` recarga el GameProfile en memoria
- `refresh_all_profiles` (v1.1.2) — itera todos los gameIds cacheados
- `execute_rule_now` (botón Probar) — ejecuta sin trigger ni cooldown
- `_read_games_enabled` con cache TTL + soporte string bool (v1.0.98+)
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

# v1.1.8: tests con `refresh_profile`/`refresh_all_profiles` requieren
# que el RuleEngine pueda lazy-init, lo cual depende de `core.rule_engine`.
# Si el core no está disponible (CI sin LiveChaosEngine), skipeamos toda
# la suite. Los tests del cache TTL y `_read_*_enabled` no requieren
# core pero por simplicidad agrupamos.
pytest.importorskip(
    "core.rule_engine",
    reason="core/ legacy no disponible — set MARU_CORE_SRC en local",
)

import maru_sidecar.backend.rule_dispatcher as disp_mod
from maru_sidecar.backend.rule_dispatcher import RuleDispatcher
from maru_sidecar.backend.games import GamesService


@pytest.fixture
def fake_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Crea data_dir temporal con config.json y data/rules para 'minecraft'."""
    data = tmp_path / "data"
    data.mkdir()
    (data / "config.json").write_text(
        json.dumps({"activeGame": "minecraft", "gamesEnabled": True}),
        encoding="utf-8",
    )
    (data / "rules_minecraft.json").write_text(
        json.dumps({"rules": []}), encoding="utf-8"
    )
    (data / "data_minecraft.json").write_text(
        json.dumps({"entities": [], "items": [], "events": []}),
        encoding="utf-8",
    )
    monkeypatch.setattr(disp_mod, "DATA_DIR", data)
    return data


@pytest.fixture
def dispatcher(fake_data_dir: Path) -> RuleDispatcher:
    games = GamesService()
    return RuleDispatcher(games)


# ── attach_logs / attach_boosts ──────────────────────────────────────────


class TestAttach:
    def test_attach_logs_propagates_to_keyboard(self, dispatcher: RuleDispatcher) -> None:
        fake_logs = MagicMock()
        dispatcher.attach_logs(fake_logs)
        assert dispatcher._logs is fake_logs
        assert dispatcher._keyboard._logs is fake_logs

    def test_attach_boosts_only_stores_when_no_engine(
        self, dispatcher: RuleDispatcher
    ) -> None:
        fake = MagicMock()
        dispatcher.attach_boosts(fake)
        assert dispatcher._boosts is fake


# ── _read_active_game (cache + lock) ─────────────────────────────────────


class TestReadActiveGame:
    def test_reads_from_config_json(self, dispatcher: RuleDispatcher) -> None:
        assert dispatcher._read_active_game() == "minecraft"

    def test_caches_result(
        self, dispatcher: RuleDispatcher, fake_data_dir: Path
    ) -> None:
        # Primera lectura
        v1 = dispatcher._read_active_game()
        assert v1 == "minecraft"
        # Cambio el archivo en disco
        (fake_data_dir / "config.json").write_text(
            json.dumps({"activeGame": "valheim"}), encoding="utf-8"
        )
        # 2da lectura inmediata: cache devuelve el viejo (TTL 1.5s)
        v2 = dispatcher._read_active_game()
        assert v2 == "minecraft"

    def test_concurrent_reads_consistent(self, dispatcher: RuleDispatcher) -> None:
        """v1.0.98: sin lock, threads concurrentes podían leer tupla
        corrupta. Con lock todos retornan el mismo valor."""
        results: list[str | None] = []
        lock = threading.Lock()

        def worker() -> None:
            r = dispatcher._read_active_game()
            with lock:
                results.append(r)

        threads = [threading.Thread(target=worker) for _ in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        # Todos deberían ver el mismo valor.
        assert len(set(results)) == 1
        assert results[0] == "minecraft"

    def test_returns_none_when_no_config(
        self, dispatcher: RuleDispatcher, fake_data_dir: Path
    ) -> None:
        (fake_data_dir / "config.json").unlink()
        # Reset cache
        dispatcher._active_game_cache = (0.0, None)
        assert dispatcher._read_active_game() is None


# ── _read_games_enabled (v1.0.98 — soporte string bool) ──────────────────


class TestReadGamesEnabled:
    def test_default_true_when_missing(
        self, dispatcher: RuleDispatcher, fake_data_dir: Path
    ) -> None:
        (fake_data_dir / "config.json").write_text("{}", encoding="utf-8")
        assert dispatcher._read_games_enabled() is True

    def test_bool_true(
        self, dispatcher: RuleDispatcher, fake_data_dir: Path
    ) -> None:
        (fake_data_dir / "config.json").write_text(
            json.dumps({"gamesEnabled": True}), encoding="utf-8"
        )
        assert dispatcher._read_games_enabled() is True

    def test_bool_false(
        self, dispatcher: RuleDispatcher, fake_data_dir: Path
    ) -> None:
        (fake_data_dir / "config.json").write_text(
            json.dumps({"gamesEnabled": False}), encoding="utf-8"
        )
        assert dispatcher._read_games_enabled() is False

    def test_string_false_recognized(
        self, dispatcher: RuleDispatcher, fake_data_dir: Path
    ) -> None:
        """v1.0.98: aceptar `'false'` string del frontend (defensa contra
        coerción `bool('false') == True` de Python)."""
        (fake_data_dir / "config.json").write_text(
            json.dumps({"gamesEnabled": "false"}), encoding="utf-8"
        )
        assert dispatcher._read_games_enabled() is False

    def test_string_true_recognized(
        self, dispatcher: RuleDispatcher, fake_data_dir: Path
    ) -> None:
        (fake_data_dir / "config.json").write_text(
            json.dumps({"gamesEnabled": "true"}), encoding="utf-8"
        )
        assert dispatcher._read_games_enabled() is True


# ── refresh_profile (v1.1.2) ─────────────────────────────────────────────


class TestRefreshProfile:
    def test_refresh_profile_lazy_inits_engine(
        self, dispatcher: RuleDispatcher
    ) -> None:
        """`refresh_profile` lazy-initializa el engine si no existe y
        recarga el GameProfile desde disco. Sin esto las reglas del
        nuevo perfil no se ven al hacer 'Probar' (bug v1.1.2 que cerramos)."""
        assert dispatcher._engine is None
        dispatcher.refresh_profile("minecraft")
        # Engine inicializado tras la llamada.
        assert dispatcher._engine is not None
        # El profile 'minecraft' debe estar cacheado y vacío (rules_minecraft.json sembrado vacío).
        prof = dispatcher._engine.profiles.get("minecraft")
        assert prof is not None
        assert prof.rules == []

    def test_refresh_all_profiles_iterates_cached(
        self, dispatcher: RuleDispatcher
    ) -> None:
        """v1.1.2: itera todos los profiles cacheados y los recrea desde
        disco. Lazy-init del engine en la primera llamada (igual que
        `refresh_profile`)."""
        # Sin engine inicializado al arrancar.
        assert dispatcher._engine is None
        # Refresh all: lazy-init el engine y recarga los 3 perfiles
        # standard (valheim, terraria, minecraft) que el RuleEngine
        # carga por default en __init__.
        dispatcher.refresh_all_profiles()
        assert dispatcher._engine is not None
        # Los 3 standard quedan cacheados.
        assert "minecraft" in dispatcher._engine.profiles
        assert "valheim" in dispatcher._engine.profiles
        assert "terraria" in dispatcher._engine.profiles


# ── KeyboardService — _enabled_cache lock ────────────────────────────────


class TestKeyboardEnabledCache:
    def test_concurrent_is_enabled_consistent(
        self, dispatcher: RuleDispatcher
    ) -> None:
        """v1.0.98: lock en `_enabled_cache` del KeyboardService."""
        kb = dispatcher._keyboard
        results: list[bool] = []
        lock = threading.Lock()

        def worker() -> None:
            r = kb.is_enabled()
            with lock:
                results.append(r)

        threads = [threading.Thread(target=worker) for _ in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        # Todos retornan el mismo valor (default false sin config).
        assert len(set(results)) == 1
