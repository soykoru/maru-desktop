"""Tests para `backend.spotify` — capa SafeCache anti-bug-raíz.

Cubre el bug raíz documentado en memoria (`feedback_spotify_cache_borrado_bug`):

  El MARU core original (`core/spotify_client.py:_try_cached_token`) borra
  el refresh_token al primer error transitorio:

      except Exception as e:
          if not rate_limit:
              os.remove(self._cache_path)  # ← bug raíz

  Cualquier glitch de red durante el polling normal destruye el refresh
  token y obliga a hacer OAuth browser cada vez que el user abre la app.

  Fix en el sidecar: `SpotifyService._patch_safe_cached_token` reemplaza
  el método con una versión segura que NO borra el cache. Más
  `_backup_cache_if_valid` y `_restore_cache_from_backup` para
  redundancia (.bak file).

Estos tests blindan que esa protección no se rompa accidentalmente.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from maru_sidecar.backend import spotify as spotify_mod
from maru_sidecar.backend.spotify import SpotifyService


# ─────────────────────────────────────────────────────────────────────
# Fixture: instancia "vacía" sin disparar el __init__ pesado.
# `SpotifyService.__init__` lee config, instala bus listener, y dispara
# eager warmup (thread). Para tests unitarios necesitamos solo los
# métodos — ningún side-effect.
# ─────────────────────────────────────────────────────────────────────

@pytest.fixture
def svc():
    """SpotifyService con __init__ saltado, listo para invocar métodos."""
    inst = SpotifyService.__new__(SpotifyService)  # bypass __init__
    return inst


@pytest.fixture
def tmp_secrets(tmp_path, monkeypatch):
    """Reemplaza SPOTIFY_SECRETS_DIR por una carpeta temporal aislada.
    Esto evita tocar el cache real del user durante los tests."""
    secrets_dir = tmp_path / "spotify_secrets"
    secrets_dir.mkdir()
    monkeypatch.setattr(spotify_mod, "SPOTIFY_SECRETS_DIR", secrets_dir)
    return secrets_dir


# ─────────────────────────────────────────────────────────────────────
# _patch_safe_cached_token — REGRESSION del bug raíz Spotify cache
# ─────────────────────────────────────────────────────────────────────

class TestPatchSafeCachedToken:
    """Si alguien rompe el monkey-patch, los tests fallan inmediatamente.

    Comportamiento esperado tras el patch:
      1. Un client cuyo `_auth.get_cached_token()` lanza excepción NO
         debe propagarla y NO debe borrar el cache file.
      2. Un client cuyo `_auth.get_cached_token()` devuelve None debe
         seguir devolviendo None (path normal de "no hay cache").
      3. Un client cuyo `_auth.get_cached_token()` devuelve un dict
         debe devolverlo intacto.
    """

    def test_patch_replaces_method(self):
        """Tras patchear, `client._try_cached_token` ya NO es el
        original — debe ser nuestra función segura."""
        original = MagicMock(name="original_try_cached_token")
        fake_auth = MagicMock()
        fake_auth.get_cached_token.return_value = {"access_token": "x"}

        client = SimpleNamespace(
            _try_cached_token=original,
            _auth=fake_auth,
            _cache_path="/tmp/should/not/touch",
        )

        SpotifyService._patch_safe_cached_token(client)

        assert client._try_cached_token is not original, (
            "El monkey-patch no reemplazó el método. "
            "Verificar SpotifyService._patch_safe_cached_token."
        )

    def test_safe_version_returns_token_on_success(self):
        """Si `auth.get_cached_token()` devuelve un dict, el safe
        retorna ese dict tal cual."""
        token = {"access_token": "abc", "refresh_token": "ref"}
        fake_auth = MagicMock()
        fake_auth.get_cached_token.return_value = token

        # client necesita tener `_try_cached_token` para que el patch
        # lo reemplace (`if not hasattr` early return).
        client = SimpleNamespace(
            _try_cached_token=lambda: None,
            _auth=fake_auth,
            _cache_path="x",
        )
        SpotifyService._patch_safe_cached_token(client)

        result = client._try_cached_token()
        assert result == token

    def test_safe_version_returns_none_on_no_cache(self):
        """Si no hay cache, el método devuelve None (no crashea)."""
        fake_auth = MagicMock()
        fake_auth.get_cached_token.return_value = None

        client = SimpleNamespace(
            _try_cached_token=lambda: None,
            _auth=fake_auth,
            _cache_path="x",
        )
        SpotifyService._patch_safe_cached_token(client)

        assert client._try_cached_token() is None

    def test_safe_version_does_not_raise_on_exception(self, tmp_path):
        """REGRESSION CRÍTICA del bug raíz: si `get_cached_token()` lanza
        excepción (network glitch, disk error, etc), la versión safe NO
        debe propagarla NI borrar el cache file. Debe devolver None."""
        # Crear un cache file real para verificar que NO se borra.
        cache_file = tmp_path / "cache"
        cache_file.write_text("refresh_token=PRECIOUS_VALUE")
        original_size = cache_file.stat().st_size

        fake_auth = MagicMock()
        fake_auth.get_cached_token.side_effect = ConnectionError(
            "transient network glitch"
        )

        client = SimpleNamespace(
            _try_cached_token=lambda: None,
            _auth=fake_auth,
            _cache_path=str(cache_file),
        )
        SpotifyService._patch_safe_cached_token(client)

        # No debe propagar la excepción
        result = client._try_cached_token()
        assert result is None

        # CRÍTICO: el cache file NO se borra
        assert cache_file.exists(), (
            "BUG RAÍZ REGRESIÓN: el cache fue borrado tras un error "
            "transitorio. Esto fuerza al user a hacer OAuth browser cada "
            "vez que la app arranca."
        )
        assert cache_file.stat().st_size == original_size, (
            "El cache fue modificado tras el error transitorio."
        )
        assert "PRECIOUS_VALUE" in cache_file.read_text()

    def test_no_op_if_client_lacks_method(self):
        """Si el client no tiene `_try_cached_token`, el patch debe
        ser no-op (no crashear)."""
        client = SimpleNamespace()  # sin atributo _try_cached_token
        # No debe levantar
        SpotifyService._patch_safe_cached_token(client)

    def test_safe_version_handles_missing_auth(self):
        """Si el client no tiene `_auth` (estado raro), el safe version
        debe devolver None sin crashear."""
        client = SimpleNamespace(_try_cached_token=lambda: None)
        # _auth missing
        SpotifyService._patch_safe_cached_token(client)

        result = client._try_cached_token()
        assert result is None


# ─────────────────────────────────────────────────────────────────────
# _backup_cache_if_valid — segunda capa de protección
# ─────────────────────────────────────────────────────────────────────

class TestBackupCacheIfValid:
    """El backup .bak preserva el refresh token si por alguna razón el
    cache primary se pierde (otra app lo borra, hot-restart, etc)."""

    def test_backup_created_when_cache_valid(self, svc, tmp_secrets):
        cache = tmp_secrets / "cache"
        cache.write_text("refresh_token=ABC")

        svc._backup_cache_if_valid()

        backup = tmp_secrets / "cache.bak"
        assert backup.exists(), "El backup .bak no se creó"
        assert backup.read_text() == "refresh_token=ABC"

    def test_no_backup_when_cache_missing(self, svc, tmp_secrets):
        """Si no hay cache primary, no hay nada que respaldar."""
        # No creamos cache file
        svc._backup_cache_if_valid()

        backup = tmp_secrets / "cache.bak"
        assert not backup.exists(), (
            "Se creó un backup vacío sin cache primary"
        )

    def test_no_backup_when_cache_empty(self, svc, tmp_secrets):
        """Cache de tamaño 0 NO debe backupearse (estaría corrupto)."""
        cache = tmp_secrets / "cache"
        cache.write_text("")  # vacío

        svc._backup_cache_if_valid()

        backup = tmp_secrets / "cache.bak"
        assert not backup.exists()

    def test_backup_idempotent_when_unchanged(self, svc, tmp_secrets):
        """Llamar dos veces no debe rescribir el backup si el cache no
        cambió (evita IO innecesario)."""
        cache = tmp_secrets / "cache"
        cache.write_text("refresh_token=ABC")

        svc._backup_cache_if_valid()
        backup = tmp_secrets / "cache.bak"
        first_mtime = backup.stat().st_mtime_ns

        # Esperar mínimo para que mtime sea distinto si rescribiera
        import time
        time.sleep(0.05)

        svc._backup_cache_if_valid()
        second_mtime = backup.stat().st_mtime_ns

        assert first_mtime == second_mtime, (
            "Backup fue rescrito innecesariamente (mismo contenido)"
        )

    def test_backup_updates_when_cache_changes(self, svc, tmp_secrets):
        """Si el cache primary cambia, el backup se actualiza."""
        cache = tmp_secrets / "cache"
        cache.write_text("refresh_token=OLD")
        svc._backup_cache_if_valid()
        backup = tmp_secrets / "cache.bak"
        assert backup.read_text() == "refresh_token=OLD"

        cache.write_text("refresh_token=NEW")
        svc._backup_cache_if_valid()
        assert backup.read_text() == "refresh_token=NEW"


# ─────────────────────────────────────────────────────────────────────
# _restore_cache_from_backup — recuperación si el primary se pierde
# ─────────────────────────────────────────────────────────────────────

class TestRestoreCacheFromBackup:
    def test_restore_when_primary_missing_and_backup_exists(self, svc, tmp_secrets):
        """Caso happy path: primary borrado, backup intacto → restaura."""
        backup = tmp_secrets / "cache.bak"
        backup.write_text("refresh_token=BACKUP_VALUE")

        result = svc._restore_cache_from_backup()

        assert result is True, "_restore debe devolver True cuando restauró"
        cache = tmp_secrets / "cache"
        assert cache.exists()
        assert cache.read_text() == "refresh_token=BACKUP_VALUE"

    def test_no_restore_when_primary_present(self, svc, tmp_secrets):
        """Si el primary ya existe y no está vacío, NO se sobrescribe."""
        cache = tmp_secrets / "cache"
        cache.write_text("refresh_token=PRIMARY")
        backup = tmp_secrets / "cache.bak"
        backup.write_text("refresh_token=BACKUP")

        result = svc._restore_cache_from_backup()

        assert result is False
        assert cache.read_text() == "refresh_token=PRIMARY", (
            "_restore sobrescribió el primary que era válido"
        )

    def test_no_restore_when_no_backup(self, svc, tmp_secrets):
        """Sin backup → no se puede restaurar."""
        # Nada existe
        result = svc._restore_cache_from_backup()

        assert result is False
        assert not (tmp_secrets / "cache").exists()

    def test_restore_when_primary_empty(self, svc, tmp_secrets):
        """Cache primary de tamaño 0 también se considera "missing"
        (puede pasar si el cache fue borrado pero touch crea 0-byte)."""
        cache = tmp_secrets / "cache"
        cache.write_text("")
        backup = tmp_secrets / "cache.bak"
        backup.write_text("refresh_token=GOOD")

        result = svc._restore_cache_from_backup()

        assert result is True
        assert cache.read_text() == "refresh_token=GOOD"


# ─────────────────────────────────────────────────────────────────────
# Integración: backup + restore E2E
# ─────────────────────────────────────────────────────────────────────

class TestBackupRestoreCycle:
    """Simulamos el escenario real: hago backup, alguien borra el cache,
    al próximo boot se restaura."""

    def test_full_cycle(self, svc, tmp_secrets):
        cache = tmp_secrets / "cache"
        cache.write_text("refresh_token=ORIGINAL")

        # Boot 1: backup
        svc._backup_cache_if_valid()
        assert (tmp_secrets / "cache.bak").exists()

        # Algo borra el cache (network glitch, otra app, etc)
        cache.unlink()
        assert not cache.exists()

        # Boot 2: restaurar antes de intentar usar
        restored = svc._restore_cache_from_backup()
        assert restored is True
        assert cache.exists()
        assert cache.read_text() == "refresh_token=ORIGINAL"
