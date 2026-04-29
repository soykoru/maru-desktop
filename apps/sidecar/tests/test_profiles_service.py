"""Tests del ProfilesService — save/load/duplicate/export/import."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import maru_sidecar.backend.profiles as profiles_mod
from maru_sidecar.backend.profiles import ProfilesService


@pytest.fixture
def svc(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> ProfilesService:
    # Re-route runtime dirs al tmp_path
    data_dir = tmp_path / "data"
    profiles_dir = tmp_path / "profiles"
    data_dir.mkdir()
    profiles_dir.mkdir()
    monkeypatch.setattr(profiles_mod, "DATA_DIR", data_dir)
    monkeypatch.setattr(profiles_mod, "PROFILES_DIR", profiles_dir)
    monkeypatch.setattr(profiles_mod, "INDEX_PATH", profiles_dir / "index.json")
    # Sembrar algo de data
    (data_dir / "rules_valheim.json").write_text(json.dumps({"rules": [{"id": "r1", "name": "x"}]}))
    (data_dir / "data_valheim.json").write_text(json.dumps({"entities": []}))
    (data_dir / "config.json").write_text(json.dumps({"theme": "midnight"}))
    return ProfilesService()


def test_save_and_list(svc: ProfilesService) -> None:
    res = svc.save({"name": "Setup A", "description": "test"})
    assert res["profile"]["name"] == "Setup A"
    listing = svc.list({})["profiles"]
    assert len(listing) == 1
    assert listing[0]["sha256"]


def test_duplicate(svc: ProfilesService) -> None:
    p = svc.save({"name": "Original"})["profile"]
    dup = svc.duplicate({"id": p["id"], "name": "Clon"})["profile"]
    assert dup["name"] == "Clon"
    assert dup["id"] != p["id"]
    assert len(svc.list({})["profiles"]) == 2


def test_load_restores_data(svc: ProfilesService, monkeypatch: pytest.MonkeyPatch) -> None:
    p = svc.save({"name": "snap"})["profile"]
    # Corrompo el data
    (profiles_mod.DATA_DIR / "config.json").write_text("{}")
    svc.load({"id": p["id"]})
    cfg = json.loads((profiles_mod.DATA_DIR / "config.json").read_text())
    assert cfg.get("theme") == "midnight"


def test_export_roundtrip(svc: ProfilesService) -> None:
    p = svc.save({"name": "exp"})["profile"]
    bundle = svc.export({"id": p["id"]})["json"]
    res = svc.import_({"json": bundle, "name": "imported"})
    assert res["profile"]["name"] == "imported"


def test_delete(svc: ProfilesService) -> None:
    p = svc.save({"name": "del"})["profile"]
    svc.delete({"id": p["id"]})
    assert len(svc.list({})["profiles"]) == 0
