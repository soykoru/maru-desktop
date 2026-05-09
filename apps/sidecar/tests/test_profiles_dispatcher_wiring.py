"""Tests del wiring profiles → dispatcher (v1.1.2 + v1.1.3).

Cubre:
- `ProfilesService.attach_dispatcher` — inyección
- `profiles.load` post-restore llama `dispatcher.refresh_profile(gid)`
  para per-game o `refresh_all_profiles()` para legacy
- `DataService.attach_dispatcher` — inyección (v1.1.3)
- `DataService.upsert/delete/bulk_delete/import_` llaman `_notify_engine`

Bug raíz cerrado en v1.1.2: cargar perfil per-game cambiaba el JSON en
disco pero el RuleEngine seguía con las reglas viejas en memoria. Estos
tests validan que el refresh sucede correctamente.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

import maru_sidecar.backend.data_catalog as data_mod
import maru_sidecar.backend.profiles as profiles_mod
from maru_sidecar.backend.data_catalog import DataService
from maru_sidecar.backend.profiles import ProfilesService


@pytest.fixture
def svc(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> ProfilesService:
    """ProfilesService con paths temporales y data sembrada."""
    data_dir = tmp_path / "data"
    profiles_dir = tmp_path / "profiles"
    data_dir.mkdir()
    profiles_dir.mkdir()
    monkeypatch.setattr(profiles_mod, "DATA_DIR", data_dir)
    monkeypatch.setattr(profiles_mod, "PROFILES_DIR", profiles_dir)
    monkeypatch.setattr(profiles_mod, "INDEX_PATH", profiles_dir / "index.json")
    # Sembrar archivos para minecraft (per-game)
    (data_dir / "rules_minecraft.json").write_text(
        json.dumps({"rules": [{"id": "r1", "name": "x"}]})
    )
    (data_dir / "data_minecraft.json").write_text(json.dumps({"entities": []}))
    (data_dir / "config.json").write_text(
        json.dumps({"theme": "midnight", "activeGame": "minecraft"})
    )
    return ProfilesService()


@pytest.fixture
def data_svc(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> DataService:
    """DataService con paths temporales."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "data_test.json").write_text(
        json.dumps({"entities": [], "items": [], "events": []})
    )
    monkeypatch.setattr(data_mod, "DATA_DIR", data_dir)
    return DataService(data_dir=data_dir)


# ── ProfilesService.attach_dispatcher ────────────────────────────────────


class TestProfilesAttachDispatcher:
    def test_attach_dispatcher_stores_ref(self, svc: ProfilesService) -> None:
        fake = MagicMock()
        svc.attach_dispatcher(fake)
        assert svc._dispatcher is fake

    def test_load_per_game_calls_refresh_profile(
        self, svc: ProfilesService
    ) -> None:
        """v1.1.2 fix raíz: tras restore per-game, dispatcher debe
        recargar el GameProfile del engine."""
        # Crear un perfil per-game para minecraft.
        p = svc.save({"name": "Identity", "gameId": "minecraft", "perGame": True})
        pid = p["profile"]["id"]
        # Inyectar dispatcher mock.
        fake_dispatcher = MagicMock()
        svc.attach_dispatcher(fake_dispatcher)
        # Cargar el perfil → debería llamar refresh_profile('minecraft').
        svc.load({"id": pid})
        fake_dispatcher.refresh_profile.assert_called_once_with("minecraft")
        # NO debe haber llamado refresh_all_profiles (es per-game, no legacy).
        fake_dispatcher.refresh_all_profiles.assert_not_called()

    def test_load_legacy_calls_refresh_all(
        self, svc: ProfilesService
    ) -> None:
        """Para perfiles legacy (snapshot completo) llamar
        refresh_all_profiles porque puede afectar varios gameIds."""
        # Save sin gameId/perGame → modo legacy.
        p = svc.save({"name": "Snapshot completo"})
        pid = p["profile"]["id"]
        fake_dispatcher = MagicMock()
        svc.attach_dispatcher(fake_dispatcher)
        svc.load({"id": pid})
        # Legacy → refresh_all_profiles, NO refresh_profile.
        fake_dispatcher.refresh_all_profiles.assert_called_once()
        fake_dispatcher.refresh_profile.assert_not_called()

    def test_load_works_without_dispatcher(self, svc: ProfilesService) -> None:
        """Si attach_dispatcher no se llamó, load no debe explotar.
        Sólo no se refresca el engine — el resto del flujo sigue."""
        p = svc.save({"name": "Test"})
        pid = p["profile"]["id"]
        # Sin dispatcher inyectado.
        assert svc._dispatcher is None
        # Load no debe crashear.
        result = svc.load({"id": pid})
        assert result.get("ok") is True or result.get("profile") is not None


# ── DataService.attach_dispatcher (v1.1.3) ───────────────────────────────


class TestDataAttachDispatcher:
    def test_attach_stores_ref(self, data_svc: DataService) -> None:
        fake = MagicMock()
        data_svc.attach_dispatcher(fake)
        assert data_svc._dispatcher is fake

    def test_upsert_calls_notify_engine(self, data_svc: DataService) -> None:
        """v1.1.3: tras upsert, el engine debe recargar el data_<gid>.json
        para que find_command(action_value) vea la entry nueva."""
        fake = MagicMock()
        data_svc.attach_dispatcher(fake)
        data_svc.upsert(
            {
                "gameId": "test",
                "kind": "entities",
                "entry": {"name": "🐗 Boar", "command": "Boar"},
            }
        )
        fake.refresh_profile.assert_called_once_with("test")

    def test_delete_calls_notify_engine(self, data_svc: DataService) -> None:
        # Sembrar una entry primero
        fake = MagicMock()
        data_svc.attach_dispatcher(fake)
        data_svc.upsert(
            {
                "gameId": "test",
                "kind": "entities",
                "entry": {"name": "X", "command": "X"},
            }
        )
        fake.refresh_profile.reset_mock()
        data_svc.delete({"gameId": "test", "kind": "entities", "name": "X"})
        fake.refresh_profile.assert_called_once_with("test")

    def test_bulk_delete_calls_notify_engine_when_removed(
        self, data_svc: DataService
    ) -> None:
        fake = MagicMock()
        data_svc.attach_dispatcher(fake)
        # Sembrar 2 entries
        for n in ["A", "B"]:
            data_svc.upsert(
                {
                    "gameId": "test",
                    "kind": "entities",
                    "entry": {"name": n, "command": n},
                }
            )
        fake.refresh_profile.reset_mock()
        # Borrar 2
        data_svc.bulk_delete(
            {"gameId": "test", "kind": "entities", "names": ["A", "B"]}
        )
        # Una sola llamada al engine (eficiente vs N llamadas).
        assert fake.refresh_profile.call_count == 1
        fake.refresh_profile.assert_called_with("test")

    def test_bulk_delete_no_call_when_nothing_removed(
        self, data_svc: DataService
    ) -> None:
        """Si bulk_delete no removió nada (todos missing), no notificar
        al engine — sería trabajo inútil."""
        fake = MagicMock()
        data_svc.attach_dispatcher(fake)
        data_svc.bulk_delete(
            {"gameId": "test", "kind": "entities", "names": ["NoExiste"]}
        )
        fake.refresh_profile.assert_not_called()

    def test_import_calls_notify_engine(self, data_svc: DataService) -> None:
        fake = MagicMock()
        data_svc.attach_dispatcher(fake)
        data_svc.import_(
            {
                "gameId": "test",
                "kind": "entities",
                "entries": [{"name": "X", "command": "X"}],
                "replace": True,
            }
        )
        fake.refresh_profile.assert_called_once_with("test")

    def test_works_without_dispatcher(self, data_svc: DataService) -> None:
        """Sin dispatcher inyectado, las mutaciones no rompen — solo no
        notifican al engine."""
        assert data_svc._dispatcher is None
        # No debe crashear.
        data_svc.upsert(
            {
                "gameId": "test",
                "kind": "entities",
                "entry": {"name": "Y", "command": "Y"},
            }
        )
