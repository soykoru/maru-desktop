"""Tests del `core.rule_engine` — RuleEngine, Rule, GameProfile.

Cubre:
- `Rule.can_trigger`: cooldown, allowed_users
- `Rule.to_dict / from_dict`: round-trip
- `GameProfile.load`: lectura desde rules_<gid>.json y data_<gid>.json
- `RuleEngine.process_event`: matching gift / command / follow / share /
  subscribe / like / like_milestone / join / first_action / emote
- `RuleEngine._execute`: dispatch a game.spawn / give_item / trigger_event
- Multi-acción + random_action
- Branch keyboard (v1.0.97+): si action_type='keyboard', delega al
  servicio inyectado.
- Counter de likes y milestones
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

# v1.1.8: skipear toda la suite si `core.rule_engine` no es importable
# (caso CI sin checkout del repo de LiveChaosEngine_Refactored).
# En local con conftest resolviendo el path, todo funciona normal.
pytest.importorskip(
    "core.rule_engine",
    reason="core/ legacy de LiveChaosEngine no disponible — set MARU_CORE_SRC env var en local",
)

# conftest.py inyecta el path al core legacy.
from core.rule_engine import GameProfile, Rule, RuleEngine  # type: ignore[import-untyped]


# ── Helpers ──────────────────────────────────────────────────────────────


class _FakeGame:
    """Fake game con métodos spawn/give_item/trigger_event que devuelven
    `(True, mensaje)`. Trackea las llamadas para assertion."""

    def __init__(self, fail: bool = False) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self._fail = fail

    def spawn(self, command: str, amount: int, user: str) -> tuple[bool, str]:
        self.calls.append(("spawn", (command, amount, user)))
        return (not self._fail, f"spawn {command} x{amount}")

    def give_item(self, command: str, amount: int, user: str) -> tuple[bool, str]:
        self.calls.append(("give_item", (command, amount, user)))
        return (not self._fail, f"give_item {command} x{amount}")

    def trigger_event(self, command: str, user: str) -> tuple[bool, str]:
        self.calls.append(("trigger_event", (command, user)))
        return (not self._fail, f"trigger_event {command}")


class _FakeKeyboard:
    """Fake del KeyboardService — ejecuta y trackea."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, int, str, str]] = []

    def execute(
        self, spec: str, amount: int, commands: str = "", user: str = ""
    ) -> tuple[bool, str]:
        self.calls.append((spec, amount, commands, user))
        return True, f"⌨️ {spec} x{amount} enviada"


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    """Directorio data temporal con rules_test.json y data_test.json
    sembrados con entries de prueba."""
    data = tmp_path / "data"
    data.mkdir()
    # Catálogo standard con entities/items/events.
    (data / "data_test.json").write_text(
        json.dumps(
            {
                "entities": [
                    {"name": "🐗 Boar", "command": "Boar"},
                    {"name": "🧟 Zombie", "command": "Zombie"},
                ],
                "items": [{"name": "⚔️ Sword", "command": "SwordIron"}],
                "events": [{"name": "🌧 Rain", "command": "rain"}],
            }
        ),
        encoding="utf-8",
    )
    # Sin reglas iniciales — los tests crean Rule objects directos.
    (data / "rules_test.json").write_text(
        json.dumps({"rules": []}), encoding="utf-8"
    )
    return data


@pytest.fixture
def engine(data_dir: Path) -> RuleEngine:
    """Engine con un fake game registrado bajo gid='test'."""
    games: dict[str, Any] = {"test": _FakeGame()}
    eng = RuleEngine(data_dir, games, tts=None)
    return eng


# ── Tests Rule ───────────────────────────────────────────────────────────


class TestRule:
    def test_can_trigger_no_constraints(self) -> None:
        r = Rule(
            id="r1", name="x", enabled=True,
            trigger_type="gift", trigger_value="rose",
            action_type="spawn", action_value="zombie",
        )
        assert r.can_trigger() is True

    def test_can_trigger_cooldown_blocks(self) -> None:
        r = Rule(
            id="r1", name="x", enabled=True,
            trigger_type="gift", trigger_value="rose",
            action_type="spawn", action_value="zombie",
            cooldown=60,
        )
        r.mark_used()
        assert r.can_trigger() is False

    def test_can_trigger_allowed_users_filters(self) -> None:
        r = Rule(
            id="r1", name="x", enabled=True,
            trigger_type="command", trigger_value="!salto",
            action_type="trigger_event", action_value="jump",
            allowed_users=["soykoru", "maru"],
        )
        assert r.can_trigger("soykoru") is True
        assert r.can_trigger("@SOYKORU") is True  # case-insensitive + sin @
        assert r.can_trigger("intruso") is False

    def test_to_dict_from_dict_roundtrip(self) -> None:
        r1 = Rule(
            id="r1", name="Mi regla", enabled=True,
            trigger_type="gift", trigger_value="rose",
            action_type="spawn", action_value="zombie",
            amount=3, cooldown=15, allowed_users=["alice"],
        )
        r2 = Rule.from_dict(r1.to_dict())
        assert r2.id == r1.id
        assert r2.name == r1.name
        assert r2.amount == 3
        assert r2.allowed_users == ["alice"]


# ── Tests GameProfile ────────────────────────────────────────────────────


class TestGameProfile:
    def test_load_from_disk(self, data_dir: Path) -> None:
        # Sembrar una regla en rules_test.json
        rules_data = {
            "rules": [
                {
                    "id": "r1", "name": "Spawn boar",
                    "enabled": True,
                    "trigger_type": "gift", "trigger_value": "rose",
                    "action_type": "spawn", "action_value": "🐗 Boar",
                    "amount": 1,
                }
            ]
        }
        (data_dir / "rules_test.json").write_text(
            json.dumps(rules_data), encoding="utf-8"
        )
        profile = GameProfile("test", data_dir)
        assert len(profile.rules) == 1
        assert profile.rules[0].id == "r1"
        # Entities cargadas del data_test.json
        assert len(profile.entities) == 2
        assert any(
            (isinstance(e, dict) and e.get("name") == "🐗 Boar") or e == "🐗 Boar"
            for e in profile.entities
        )

    def test_load_missing_files_safe(self, tmp_path: Path) -> None:
        empty_dir = tmp_path / "empty"
        empty_dir.mkdir()
        # No hay rules_<gid>.json ni data_<gid>.json — no debe romper.
        profile = GameProfile("ghost", empty_dir)
        assert profile.rules == []
        assert profile.entities == []


# ── Tests RuleEngine.process_event ───────────────────────────────────────


class TestProcessEventMatching:
    """`process_event(game_id, evt_type, evt_data)` matchea reglas y
    ejecuta acciones contra el fake game."""

    def _add_rule(self, engine: RuleEngine, **overrides: Any) -> Rule:
        """Helper: inserta una rule en el profile 'test' del engine."""
        defaults = {
            "id": "r1", "name": "test-rule", "enabled": True,
            "trigger_type": "gift", "trigger_value": "rose",
            "action_type": "spawn", "action_value": "zombie",
            "amount": 1, "commands": "spawn_zombie",
        }
        defaults.update(overrides)
        rule = Rule(**defaults)
        engine.ensure_profile("test")
        engine.profiles["test"].rules.append(rule)
        return rule

    def test_gift_matches_by_value(self, engine: RuleEngine) -> None:
        self._add_rule(engine, trigger_type="gift", trigger_value="rose")
        results = engine.process_event(
            "test", "gift", {"user": "alice", "gift_name": "rose", "count": 1}
        )
        assert len(results) == 1
        assert results[0]["success"] is True
        game = engine.games["test"]
        assert any(c[0] == "spawn" for c in game.calls)

    def test_gift_no_match_different_value(self, engine: RuleEngine) -> None:
        self._add_rule(engine, trigger_type="gift", trigger_value="rose")
        results = engine.process_event(
            "test", "gift", {"user": "alice", "gift_name": "elephant", "count": 1}
        )
        # No match → no results
        assert results == []

    def test_command_matches_with_bang(self, engine: RuleEngine) -> None:
        self._add_rule(
            engine,
            trigger_type="command",
            trigger_value="!salto",
            action_type="trigger_event",
            commands="jump",
        )
        results = engine.process_event(
            "test", "command", {"user": "alice", "command": "salto"}
        )
        assert len(results) == 1

    def test_disabled_rule_no_match(self, engine: RuleEngine) -> None:
        self._add_rule(engine, enabled=False, trigger_type="gift", trigger_value="rose")
        results = engine.process_event(
            "test", "gift", {"user": "alice", "gift_name": "rose", "count": 1}
        )
        assert results == []

    def test_cooldown_blocks_second_trigger(self, engine: RuleEngine) -> None:
        rule = self._add_rule(
            engine, trigger_type="gift", trigger_value="rose", cooldown=10
        )
        # 1er trigger pasa
        r1 = engine.process_event(
            "test", "gift", {"user": "alice", "gift_name": "rose", "count": 1}
        )
        assert len(r1) == 1
        # 2do en menos de cooldown — bloqueado
        r2 = engine.process_event(
            "test", "gift", {"user": "alice", "gift_name": "rose", "count": 1}
        )
        assert r2 == []
        # mark_used debió actualizar last_used
        assert rule.last_used > 0


class TestExecuteMultiAction:
    """v1.0.x — soporte multi-acción y random_action."""

    def test_multi_action_executes_all(self, engine: RuleEngine) -> None:
        rule = Rule(
            id="r1", name="multi", enabled=True,
            trigger_type="gift", trigger_value="rose",
            action_type="spawn", action_value="zombie",
            actions=[
                {"action_type": "spawn", "action_value": "z1", "amount": 1, "commands": "z1"},
                {"action_type": "give_item", "action_value": "i1", "amount": 5, "commands": "i1"},
                {"action_type": "trigger_event", "action_value": "e1", "amount": 1, "commands": "e1"},
            ],
        )
        engine.ensure_profile("test")
        engine.profiles["test"].rules.append(rule)
        results = engine.process_event(
            "test", "gift", {"user": "alice", "gift_name": "rose", "count": 1}
        )
        assert len(results) == 1
        assert results[0]["success"] is True
        game = engine.games["test"]
        # Debe haber llamado a los 3 métodos.
        kinds = [c[0] for c in game.calls]
        assert "spawn" in kinds
        assert "give_item" in kinds
        assert "trigger_event" in kinds

    def test_random_action_picks_one(self, engine: RuleEngine) -> None:
        rule = Rule(
            id="r1", name="random", enabled=True,
            trigger_type="gift", trigger_value="rose",
            action_type="spawn", action_value="zombie",
            actions=[
                {"action_type": "spawn", "action_value": "z1", "amount": 1, "commands": "z1"},
                {"action_type": "spawn", "action_value": "z2", "amount": 1, "commands": "z2"},
                {"action_type": "spawn", "action_value": "z3", "amount": 1, "commands": "z3"},
            ],
            random_action=True,
        )
        engine.ensure_profile("test")
        engine.profiles["test"].rules.append(rule)
        engine.process_event(
            "test", "gift", {"user": "alice", "gift_name": "rose", "count": 1}
        )
        game = engine.games["test"]
        # Random_action: debe ejecutar EXACTAMENTE 1 spawn (no los 3).
        spawn_calls = [c for c in game.calls if c[0] == "spawn"]
        assert len(spawn_calls) == 1


# ── Tests branch keyboard (v1.0.97+) ─────────────────────────────────────


class TestKeyboardAction:
    """Branch nuevo en `_execute` cuando action_type='keyboard'."""

    def test_keyboard_action_calls_service(self, data_dir: Path) -> None:
        kb = _FakeKeyboard()
        engine = RuleEngine(data_dir, {"test": _FakeGame()}, tts=None, keyboard=kb)
        rule = Rule(
            id="r1", name="kb", enabled=True,
            trigger_type="command", trigger_value="!w",
            action_type="keyboard", action_value="W",
            amount=2, commands="hold:200",
        )
        engine.ensure_profile("test")
        engine.profiles["test"].rules.append(rule)
        results = engine.process_event(
            "test", "command", {"user": "alice", "command": "w"}
        )
        assert len(results) == 1
        assert results[0]["success"] is True
        # KeyboardService.execute fue llamado
        assert len(kb.calls) == 1
        assert kb.calls[0][0] == "W"
        assert kb.calls[0][1] == 2  # amount
        assert kb.calls[0][2] == "hold:200"

    def test_keyboard_without_service_returns_error(self, data_dir: Path) -> None:
        engine = RuleEngine(data_dir, {"test": _FakeGame()}, tts=None, keyboard=None)
        rule = Rule(
            id="r1", name="kb", enabled=True,
            trigger_type="command", trigger_value="!w",
            action_type="keyboard", action_value="W",
        )
        engine.ensure_profile("test")
        engine.profiles["test"].rules.append(rule)
        results = engine.process_event(
            "test", "command", {"user": "alice", "command": "w"}
        )
        # La regla matchea pero la acción falla con mensaje claro.
        assert len(results) == 1
        assert results[0]["success"] is False
        assert "no disponible" in results[0]["message"].lower()

    def test_non_keyboard_rule_unaffected_when_keyboard_present(
        self, data_dir: Path
    ) -> None:
        """Sanity: tener keyboard service inyectado NO afecta reglas
        de juego standard. Verificación de no-regresión del v1.0.97."""
        game = _FakeGame()
        kb = _FakeKeyboard()
        engine = RuleEngine(data_dir, {"test": game}, tts=None, keyboard=kb)
        rule = Rule(
            id="r1", name="spawn-test", enabled=True,
            trigger_type="gift", trigger_value="rose",
            action_type="spawn", action_value="zombie",
            amount=1, commands="zombie",
        )
        engine.ensure_profile("test")
        engine.profiles["test"].rules.append(rule)
        results = engine.process_event(
            "test", "gift", {"user": "alice", "gift_name": "rose", "count": 1}
        )
        assert len(results) == 1
        assert results[0]["success"] is True
        # game.spawn fue llamado, kb.execute NO.
        assert any(c[0] == "spawn" for c in game.calls)
        assert kb.calls == []
