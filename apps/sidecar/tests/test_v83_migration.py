"""Test de la migración v1.0.83 — re-import forzado de data files RCON.

Bug del user (07/05 noche): después de v1.0.82 los comandos seguían
viejos. Causa: la migración v82 usaba `MARU_SEED_DIR` env var (solo set
en dev) y marcaba el gid como migrado SIEMPRE, incluso cuando no podía
copiar el seed.

v1.0.83 fix:
  1. seed_dir lookup usa BUNDLE_DATA_DIR (resuelve en dev y prod)
  2. Re-migración v83 detecta data files viejos por threshold de entries
     y los reemplaza con backup automático.

Este test simula el escenario de producción con un data file viejo
(formato pre-v82) en userdata + un seed nuevo en bundle, y verifica
que la migración:
  - Detecta el data file viejo
  - Hace backup en BACKUPS_DIR
  - Reemplaza con el seed nuevo
  - Marca el marker para no re-ejecutar
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from maru_sidecar.backend import games as games_mod


@pytest.fixture
def tmp_runtime(tmp_path, monkeypatch):
    """Setup runtime dirs aislados para este test.

    Estructura:
      tmp_path/
        runtime/data/             ← DATA_DIR
        runtime/backups/          ← BACKUPS_DIR
        bundle/                   ← BUNDLE_DATA_DIR (seed source)
            data_project_zomboid.json (nuevo, 149 entries)
            data_ark_ascended.json (nuevo, 177 entries)
    """
    data_dir = tmp_path / "runtime" / "data"
    backups_dir = tmp_path / "runtime" / "backups"
    bundle_dir = tmp_path / "bundle"
    data_dir.mkdir(parents=True)
    backups_dir.mkdir(parents=True)
    bundle_dir.mkdir(parents=True)

    monkeypatch.setattr(games_mod, "DATA_DIR", data_dir)
    monkeypatch.setattr(games_mod, "BACKUPS_DIR", backups_dir)
    monkeypatch.setattr(games_mod, "BUNDLE_DATA_DIR", bundle_dir)

    # No usar env var — queremos forzar BUNDLE_DATA_DIR como source.
    monkeypatch.delenv("MARU_SEED_DIR", raising=False)

    return {
        "data_dir": data_dir,
        "backups_dir": backups_dir,
        "bundle_dir": bundle_dir,
    }


def _write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data), encoding="utf-8")


def _make_old_pz_data() -> dict:
    """Data file viejo del user — 30 entries totales como pre-v82."""
    return {
        "entities": [
            "Mini Horda (5):createhorde 5 \"{user}\"",
            "Horda Pequeña (10):createhorde 10 \"{user}\"",
        ] * 5,  # 10 entries
        "items": [f"Item{i}:additem \"{{user}}\" \"Base.X{i}\" 1" for i in range(10)],
        "events": [f"Evento{i}:cmd{i}" for i in range(10)],
        "valuables": [],
    }


def _make_new_pz_seed() -> dict:
    """Data file nuevo del bundle — 149 entries (target post-v82)."""
    return {
        "entities": [f"Horda{i}:createhorde {i} \"{{user}}\"" for i in range(26)],
        "items": [f"Item{i}:additem \"{{user}}\" \"Base.X{i}\" 1" for i in range(78)],
        "events": [f"Evento{i}:cmd{i}" for i in range(35)],
        "valuables": [f"Joya{i}:additem \"{{user}}\" \"Base.J{i}\" 1" for i in range(10)],
    }


class TestV83Migration:
    """Verifica que la migración v83 ejecuta correctamente sin env var
    MARU_SEED_DIR (escenario producción)."""

    def test_old_data_file_gets_replaced_with_seed(self, tmp_runtime, monkeypatch):
        """Caso real del user: data file viejo del user + seed nuevo en
        bundle → migración detecta viejo y reemplaza."""
        # Setup: data file viejo del user (30 entries)
        old_data = _make_old_pz_data()
        user_data_path = tmp_runtime["data_dir"] / "data_project_zomboid.json"
        _write_json(user_data_path, old_data)
        old_total = sum(len(old_data.get(k, [])) for k in ("entities", "items", "events", "valuables"))
        assert old_total < 100, "test setup: viejo debe estar bajo threshold"

        # Setup: seed nuevo en bundle (149 entries)
        new_seed = _make_new_pz_seed()
        seed_path = tmp_runtime["bundle_dir"] / "data_project_zomboid.json"
        _write_json(seed_path, new_seed)
        new_total = sum(len(new_seed.get(k, [])) for k in ("entities", "items", "events", "valuables"))
        assert new_total >= 100, "test setup: seed debe estar sobre threshold"

        # Setup: games.json con marker v82 ya presente (caso del user
        # que actualizó a v1.0.82 con el bug)
        games_json = {
            "version": 3,
            "games": {
                "project_zomboid": {
                    "id": "project_zomboid",
                    "name": "Project Zomboid",
                    "connectionType": "rcon",
                    "categories": [],
                    "hasEntities": True,
                    "hasItems": True,
                    "hasEvents": True,
                },
            },
            "migratedV82RconCommands": ["project_zomboid"],  # ← ya marcado por v82 buggy
        }
        games_json_path = tmp_runtime["data_dir"] / "games.json"
        _write_json(games_json_path, games_json)

        # Acción: instanciar el GamesService que dispara migración al boot
        from maru_sidecar.backend.games import GamesService
        svc = GamesService()
        # _migrate_if_needed es lo que ejecuta el flow completo de migración
        # El __init__ ya lo llama indirectamente via _read

        # Forzar lectura+migración
        doc = svc._read()

        # Verificar 1: el marker v83 quedó set
        assert "project_zomboid" in (doc.get("migratedV83ForceReimport") or [])

        # Verificar 2: el data file del user fue reemplazado
        actual = json.loads(user_data_path.read_text(encoding="utf-8"))
        actual_total = sum(len(actual.get(k, [])) for k in ("entities", "items", "events", "valuables"))
        assert actual_total == new_total, (
            f"data file no fue reemplazado. esperaba {new_total} entries, hay {actual_total}"
        )

        # Verificar 3: hay un backup en BACKUPS_DIR
        backups = list(tmp_runtime["backups_dir"].glob("data_project_zomboid_pre_v83_*.json"))
        assert len(backups) == 1, f"esperaba 1 backup, hay {len(backups)}"
        backup_data = json.loads(backups[0].read_text(encoding="utf-8"))
        backup_total = sum(len(backup_data.get(k, [])) for k in ("entities", "items", "events", "valuables"))
        assert backup_total == old_total, "backup debería tener el contenido viejo"

    def test_new_data_file_not_re_migrated(self, tmp_runtime, monkeypatch):
        """Si el user ya tiene data file nuevo (>=100 entries), NO se re-migra."""
        new_data = _make_new_pz_seed()
        user_data_path = tmp_runtime["data_dir"] / "data_project_zomboid.json"
        _write_json(user_data_path, new_data)

        # Seed también nuevo (idéntico)
        seed_path = tmp_runtime["bundle_dir"] / "data_project_zomboid.json"
        _write_json(seed_path, new_data)

        games_json = {
            "version": 3,
            "games": {"project_zomboid": {"id": "project_zomboid", "name": "PZ"}},
        }
        games_json_path = tmp_runtime["data_dir"] / "games.json"
        _write_json(games_json_path, games_json)

        from maru_sidecar.backend.games import GamesService
        svc = GamesService()
        svc._read()

        # No hay backups (no se re-migró)
        backups = list(tmp_runtime["backups_dir"].glob("data_project_zomboid_pre_v83_*.json"))
        assert len(backups) == 0, "no debería haber backup si data file ya estaba nuevo"

    def test_auto_retry_when_data_file_still_old(self, tmp_runtime, monkeypatch):
        """v1.0.84: si el marker está set PERO el data file todavía es
        viejo (caso del bug de v83), debe AUTO-RE-MIGRAR — no quedarse
        atrapado en estado roto.

        Escenario real del user: v83 marcó el gid (porque el código viejo
        marcaba siempre) pero NO copió el seed (porque seed_dir was None
        en producción). v84 detecta que data file sigue viejo y reintenta.
        """
        old_data = _make_old_pz_data()
        user_data_path = tmp_runtime["data_dir"] / "data_project_zomboid.json"
        _write_json(user_data_path, old_data)

        new_seed = _make_new_pz_seed()
        seed_path = tmp_runtime["bundle_dir"] / "data_project_zomboid.json"
        _write_json(seed_path, new_seed)

        games_json = {
            "version": 3,
            "games": {"project_zomboid": {"id": "project_zomboid", "name": "PZ"}},
            "migratedV83ForceReimport": ["project_zomboid"],  # ya marcado pero data viejo
        }
        games_json_path = tmp_runtime["data_dir"] / "games.json"
        _write_json(games_json_path, games_json)

        from maru_sidecar.backend.games import GamesService
        svc = GamesService()
        svc._read()

        # CRÍTICO: debe haber backup pre-v84 (v84 detectó viejo y re-migró)
        backups = list(tmp_runtime["backups_dir"].glob("data_project_zomboid_pre_v84_*.json"))
        assert len(backups) == 1, (
            "v84 debe auto-re-migrar cuando data file sigue viejo aunque "
            "marker esté set (bug del user post v83)."
        )
        # Y el data file debe estar nuevo
        actual = json.loads(user_data_path.read_text(encoding="utf-8"))
        actual_total = sum(len(actual.get(k, [])) for k in ("entities", "items", "events", "valuables"))
        assert actual_total >= 100

    def test_no_re_migration_when_data_file_already_new(self, tmp_runtime, monkeypatch):
        """Si data file ya es nuevo Y marker set → no hace nada (idempotente
        correcto)."""
        new_data = _make_new_pz_seed()
        user_data_path = tmp_runtime["data_dir"] / "data_project_zomboid.json"
        _write_json(user_data_path, new_data)

        seed_path = tmp_runtime["bundle_dir"] / "data_project_zomboid.json"
        _write_json(seed_path, new_data)

        games_json = {
            "version": 3,
            "games": {"project_zomboid": {"id": "project_zomboid", "name": "PZ"}},
            "migratedV83ForceReimport": ["project_zomboid"],
        }
        games_json_path = tmp_runtime["data_dir"] / "games.json"
        _write_json(games_json_path, games_json)

        from maru_sidecar.backend.games import GamesService
        svc = GamesService()
        svc._read()

        # No re-migración: data file ya OK
        backups = list(tmp_runtime["backups_dir"].glob("data_project_zomboid_pre_v84_*.json"))
        assert len(backups) == 0
