"""Tests del RulesService — CRUD, persistencia atómica, reorder, validación."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from maru_sidecar.backend.backups import BackupService
from maru_sidecar.backend.rules import RulesService


@pytest.fixture
def svc(tmp_path: Path) -> RulesService:
    backups = BackupService(backups_dir=tmp_path / "backups", data_dir=tmp_path)
    return RulesService(data_dir=tmp_path, backups=backups)


def _sample(name: str = "x", trigger_kind: str = "follow") -> dict:
    return {
        "id": f"r-{name}",
        "enabled": True,
        "name": name,
        "trigger": {"kind": trigger_kind},
        "actions": [{"kind": "spawn", "entity": "Troll", "amount": 1}],
        "randomPick": False,
    }


def test_upsert_creates_then_updates(svc: RulesService, tmp_path: Path) -> None:
    res = svc.upsert({"gameId": "valheim", "rule": _sample("a")})
    assert res["rule"]["id"] == "r-a"
    listing = svc.list({"gameId": "valheim"})["rules"]
    assert len(listing) == 1

    # Update mismo id
    updated = _sample("a")
    updated["name"] = "renamed"
    svc.upsert({"gameId": "valheim", "rule": updated})
    listing = svc.list({"gameId": "valheim"})["rules"]
    assert len(listing) == 1
    assert listing[0]["name"] == "renamed"

    # Verificar que el archivo persistió
    p = tmp_path / "rules_valheim.json"
    assert p.exists()
    doc = json.loads(p.read_text(encoding="utf-8"))
    assert doc["rules"][0]["name"] == "renamed"


def test_toggle_changes_enabled(svc: RulesService) -> None:
    svc.upsert({"gameId": "valheim", "rule": _sample("a")})
    svc.toggle({"gameId": "valheim", "ruleId": "r-a", "enabled": False})
    rules = svc.list({"gameId": "valheim"})["rules"]
    assert rules[0]["enabled"] is False


def test_delete_removes_rule(svc: RulesService) -> None:
    svc.upsert({"gameId": "valheim", "rule": _sample("a")})
    svc.upsert({"gameId": "valheim", "rule": _sample("b")})
    svc.delete({"gameId": "valheim", "ruleId": "r-a"})
    rules = svc.list({"gameId": "valheim"})["rules"]
    assert len(rules) == 1
    assert rules[0]["id"] == "r-b"


def test_reorder(svc: RulesService) -> None:
    for n in ("a", "b", "c"):
        svc.upsert({"gameId": "valheim", "rule": _sample(n)})
    svc.reorder({"gameId": "valheim", "orderedIds": ["r-c", "r-a", "r-b"]})
    ids = [r["id"] for r in svc.list({"gameId": "valheim"})["rules"]]
    assert ids == ["r-c", "r-a", "r-b"]


def test_invalid_game_raises(svc: RulesService) -> None:
    """La validación de gameId es SINTÁCTICA (regex), no whitelist —
    el user puede agregar juegos custom con cualquier id alfa válido.
    Solo falla con strings que rompan el shape de identificador."""
    with pytest.raises(ValueError):
        svc.list({"gameId": "sky rim!"})  # espacio + bang inválidos


def test_invalid_rule_raises(svc: RulesService) -> None:
    with pytest.raises(ValueError):
        svc.upsert({"gameId": "valheim", "rule": {"id": "x", "name": "bad", "trigger": {"kind": "nope"}, "actions": []}})
