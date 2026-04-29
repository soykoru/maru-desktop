"""Runtime paths del sidecar de MARU Desktop.

Mejora respecto al original:
  - Datos de la app nueva viven en `apps/sidecar/runtime_data/` por defecto
    (variable `MARU_RUNTIME_DIR` lo override).
  - En producción (PyInstaller) se redirige a `%APPDATA%/MARU Live` o equivalente.
  - Subcarpetas separadas: data/, logs/, backups/, cache/, secrets/.

Esto reemplaza al `core.paths` del original, que tenía rutas hardcodeadas
relativas al ROOT_DIR del repo. Cuando se importa `core/` desde el bridge,
parchamos sus constantes de paths para que apunten aquí.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Final

# Detección dev vs prod (PyInstaller bundle)
_IS_FROZEN: Final[bool] = getattr(sys, "frozen", False)


def _default_runtime_dir() -> Path:
    env = os.environ.get("MARU_RUNTIME_DIR")
    if env:
        return Path(env).expanduser().resolve()

    if _IS_FROZEN:
        # En prod: %APPDATA%/MARU Live (Windows) o ~/.local/share/MARU Live (Linux)
        if sys.platform == "win32":
            base = Path(os.environ.get("APPDATA", Path.home())) / "MARU Live"
        elif sys.platform == "darwin":
            base = Path.home() / "Library" / "Application Support" / "MARU Live"
        else:
            base = Path.home() / ".local" / "share" / "MARU Live"
        return base

    # Dev: junto al sidecar
    return Path(__file__).resolve().parents[2] / "runtime_data"


RUNTIME_DIR: Final[Path] = _default_runtime_dir()
DATA_DIR: Final[Path] = RUNTIME_DIR / "data"
LOGS_DIR: Final[Path] = RUNTIME_DIR / "logs"
BACKUPS_DIR: Final[Path] = RUNTIME_DIR / "backups"
CACHE_DIR: Final[Path] = RUNTIME_DIR / "cache"
TTS_CACHE_DIR: Final[Path] = CACHE_DIR / "tts"
SECRETS_DIR: Final[Path] = RUNTIME_DIR / "secrets"
SPOTIFY_SECRETS_DIR: Final[Path] = SECRETS_DIR / "spotify"
# Emotes — uno por streamer (multi-account). Estructura:
#   runtime_data/data/emotes/<streamer>/avatar.png
#   runtime_data/data/emotes/<streamer>/<emote_id>.png
#   runtime_data/data/emotes/<streamer>/manifest.json (sound assignments)
EMOTES_DIR: Final[Path] = RUNTIME_DIR / "data" / "emotes"


def _default_bundle_data_dir() -> Path:
    """Bundle de imágenes (read-only) — separado del runtime data del user.

    Layout en bundle (G2):
        bundleDataDir/
            donaciones/<file>.png
            icons_triggers/<file>.png
            game_images/<gid>/<cat>/<file>.png
            game_images/_templates/<file>.png

    Lookup order:
      1) `MARU_BUNDLE_DATA_DIR` env var (override explícito).
      2) PyInstaller frozen: junto al exe, en `_internal/data` o `data/`.
      3) Dev: `apps/desktop/resources/data/` desde la raíz del workspace.
      4) Fallback al RUNTIME_DIR (solo para tests).
    """
    env = os.environ.get("MARU_BUNDLE_DATA_DIR")
    if env:
        return Path(env).expanduser().resolve()

    if _IS_FROZEN:
        exe_dir = Path(sys.executable).resolve().parent
        for cand in (
            exe_dir / "data",
            exe_dir / "_internal" / "data",
            exe_dir.parent / "data",
        ):
            if cand.exists():
                return cand
        return exe_dir / "data"

    here = Path(__file__).resolve()
    # parents[0]=maru_sidecar, [1]=apps/sidecar, [2]=apps, [3]=workspace
    if len(here.parents) >= 4:
        candidate = here.parents[3] / "apps" / "desktop" / "resources" / "data"
        if candidate.exists():
            return candidate
    return DATA_DIR  # fallback


BUNDLE_DATA_DIR: Final[Path] = _default_bundle_data_dir()
BUNDLE_DONACIONES_DIR: Final[Path] = BUNDLE_DATA_DIR / "donaciones"
BUNDLE_TRIGGERS_DIR: Final[Path] = BUNDLE_DATA_DIR / "icons_triggers"
BUNDLE_GAME_IMAGES_DIR: Final[Path] = BUNDLE_DATA_DIR / "game_images"
BUNDLE_TEMPLATES_DIR: Final[Path] = BUNDLE_GAME_IMAGES_DIR / "_templates"

# User data (writable) — donde se guardan PNGs auto-descargados runtime.
USERDATA_DONACIONES_DIR: Final[Path] = DATA_DIR / "donaciones"


def ensure_runtime_dirs() -> None:
    for d in (
        DATA_DIR,
        LOGS_DIR,
        BACKUPS_DIR,
        CACHE_DIR,
        TTS_CACHE_DIR,
        SECRETS_DIR,
        SPOTIFY_SECRETS_DIR,
        USERDATA_DONACIONES_DIR,
    ):
        d.mkdir(parents=True, exist_ok=True)


def resolve_spotify_secret(filename: str) -> Path:
    return SPOTIFY_SECRETS_DIR / filename


__all__ = [
    "RUNTIME_DIR",
    "DATA_DIR",
    "LOGS_DIR",
    "BACKUPS_DIR",
    "CACHE_DIR",
    "TTS_CACHE_DIR",
    "SECRETS_DIR",
    "SPOTIFY_SECRETS_DIR",
    "BUNDLE_DATA_DIR",
    "BUNDLE_DONACIONES_DIR",
    "BUNDLE_TRIGGERS_DIR",
    "BUNDLE_GAME_IMAGES_DIR",
    "BUNDLE_TEMPLATES_DIR",
    "USERDATA_DONACIONES_DIR",
    "ensure_runtime_dirs",
    "resolve_spotify_secret",
]
