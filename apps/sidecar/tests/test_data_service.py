"""Tests del DataService — CRUD, búsqueda, import/export."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from maru_sidecar.backend.backups import BackupService
from maru_sidecar.backend.data_catalog import DataService


@pytest.fixture
def svc(tmp_path: Path) -> DataService:
    backups = BackupService(backups_dir=tmp_path / "backups", data_dir=tmp_path)
    return DataService(data_dir=tmp_path, backups=backups)


def test_upsert_and_list(svc: DataService) -> None:
    svc.upsert({"gameId": "valheim", "kind": "entities", "entry": {"name": "Troll Furioso", "command": "Troll"}})
    res = svc.list({"gameId": "valheim", "kind": "entities"})
    assert res["entries"][0]["name"] == "Troll Furioso"
    assert res["total"] == 1


def test_search_filters(svc: DataService) -> None:
    svc.import_({"gameId": "valheim", "kind": "items", "entries": [
        {"name": "Espada Hierro", "command": "SwordIron"},
        {"name": "Escudo Madera", "command": "ShieldWood"},
    ]})
    res = svc.list({"gameId": "valheim", "kind": "items", "query": "esp"})
    assert len(res["entries"]) == 1
    assert res["entries"][0]["name"] == "Espada Hierro"


def test_rename_via_previousName(svc: DataService) -> None:
    svc.upsert({"gameId": "valheim", "kind": "entities", "entry": {"name": "Troll", "command": "Troll"}})
    svc.upsert({
        "gameId": "valheim",
        "kind": "entities",
        "entry": {"name": "Troll Furioso", "command": "Troll"},
        "previousName": "Troll",
    })
    res = svc.list({"gameId": "valheim", "kind": "entities"})
    assert len(res["entries"]) == 1
    assert res["entries"][0]["name"] == "Troll Furioso"


def test_delete(svc: DataService) -> None:
    svc.upsert({"gameId": "valheim", "kind": "entities", "entry": {"name": "X", "command": "X"}})
    svc.delete({"gameId": "valheim", "kind": "entities", "name": "X"})
    assert svc.list({"gameId": "valheim", "kind": "entities"})["total"] == 0


def test_import_replace(svc: DataService) -> None:
    svc.upsert({"gameId": "valheim", "kind": "events", "entry": {"name": "Old", "command": "old"}})
    res = svc.import_({
        "gameId": "valheim",
        "kind": "events",
        "entries": [{"name": "New", "command": "new"}],
        "replace": True,
    })
    assert res["total"] == 1
    listing = svc.list({"gameId": "valheim", "kind": "events"})
    assert listing["entries"][0]["name"] == "New"


def test_invalid_kind_raises(svc: DataService) -> None:
    """La validación de kind es SINTÁCTICA (regex), no whitelist —
    permite kinds custom (ej. 'weapons', 'spells') para juegos custom.
    Solo falla con strings que rompan el shape de identificador."""
    with pytest.raises(ValueError):
        svc.list({"gameId": "valheim", "kind": "in valid!"})  # espacio + bang


def test_export_returns_array(svc: DataService) -> None:
    svc.upsert({"gameId": "terraria", "kind": "items", "entry": {"name": "A", "command": "a"}})
    res = svc.export({"gameId": "terraria", "kind": "items"})
    assert isinstance(res["entries"], list)
    assert len(res["entries"]) == 1
