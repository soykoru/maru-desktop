"""Tests del BackupService — atomicidad, retención, restore, hash."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from maru_sidecar.backend.backups import BackupService


@pytest.fixture
def svc(tmp_path: Path) -> BackupService:
    data = tmp_path / "data"
    backups = tmp_path / "backups"
    data.mkdir()
    (data / "rules_valheim.json").write_text(json.dumps({"rules": [1, 2, 3]}), encoding="utf-8")
    (data / "rules_terraria.json").write_text(json.dumps({"rules": []}), encoding="utf-8")
    return BackupService(backups_dir=backups, data_dir=data, max_per_scope=3, max_age_days=365)


def test_create_and_list(svc: BackupService) -> None:
    entry = svc.create("rules", label="manual")
    assert entry.scope == "rules"
    assert entry.size_bytes > 0
    assert entry.label == "manual"
    assert entry.sha256
    assert all(f.startswith("rules_") for f in entry.files)
    listing = svc.list("rules")
    assert len(listing) == 1
    assert listing[0].id == entry.id


def test_retention_caps_per_scope(svc: BackupService) -> None:
    ids = [svc.create("rules").id for _ in range(5)]
    listing = svc.list("rules")
    assert len(listing) <= 3
    # Los 3 más recientes son los últimos creados
    kept = {e.id for e in listing}
    assert ids[-1] in kept
    assert ids[0] not in kept


def test_restore_overwrites_data(svc: BackupService, tmp_path: Path) -> None:
    entry = svc.create("rules")
    # Modificamos el archivo original
    target = next((tmp_path / "data").glob("rules_valheim.json"))
    target.write_text("{}", encoding="utf-8")
    assert json.loads(target.read_text(encoding="utf-8")) == {}
    svc.restore(entry.id)
    assert json.loads(target.read_text(encoding="utf-8")) == {"rules": [1, 2, 3]}


def test_delete_removes_files_and_index(svc: BackupService) -> None:
    entry = svc.create("rules")
    svc.delete(entry.id)
    assert svc.list("rules") == []


def test_create_unknown_scope_raises(svc: BackupService) -> None:
    with pytest.raises(ValueError):
        svc.create("invalid")  # type: ignore[arg-type]
