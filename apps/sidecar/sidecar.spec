# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec — MARU Live sidecar.

Estrategia:
  - `--onedir` (vía bundle abajo): el binario va junto a sus deps en una
    carpeta. Más rápido que onefile (no extrae cada arranque) y compatible
    con `electron-builder` `extraResources`.
  - Excluimos PyQt6 / pygame / spotipy / TikTokLive de los hidden imports
    explícitos: el `core_bridge` los carga lazy via `core/`. Si están
    instaladas en el entorno se incluyen automáticamente; si no, el sidecar
    arranca igual y los servicios respectivos quedan en stub-mode.
  - El binario expone `MARU_SIDECAR_READY <port>` por stdout — el harness
    Electron lo parsea para sincronizar.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

block_cipher = None

HERE = Path(os.path.dirname(os.path.abspath(SPEC)))  # noqa: F821 — SPEC inyectado por PyInstaller


# Hidden imports — websockets y submódulos del package que PyInstaller a veces
# no detecta por la lazy loading interna.
hidden = [
    "websockets",
    "websockets.legacy",
    "websockets.legacy.server",
    "websockets.asyncio",
    "websockets.asyncio.server",
    "maru_sidecar",
    "maru_sidecar.__main__",
    "maru_sidecar.server",
    "maru_sidecar.event_bus",
    "maru_sidecar.runtime",
    "maru_sidecar.logger",
    "maru_sidecar.core_bridge",
    "maru_sidecar.rpc",
    "maru_sidecar.rpc.registry",
    "maru_sidecar.backend.system",
    "maru_sidecar.backend.tiktok",
    "maru_sidecar.backend.rules",
    "maru_sidecar.backend.data_catalog",
    "maru_sidecar.backend.games",
    "maru_sidecar.backend.social",
    "maru_sidecar.backend.spotify",
    "maru_sidecar.backend.ia",
    "maru_sidecar.backend.tts",
    "maru_sidecar.backend.overlays",
    "maru_sidecar.backend.profiles",
    "maru_sidecar.backend.settings",
    "maru_sidecar.backend.backups",
    "maru_sidecar.backend.logs",
    "maru_sidecar.backend.metrics",
]

# Excluimos toolchains pesados que no usamos en el sidecar
excludes = [
    "tkinter",
    "matplotlib",
    "numpy.tests",
    "PIL",
    "test",
    "unittest",
    "pydoc",
    "doctest",
    "lib2to3",
    "setuptools",
]

a = Analysis(
    ["entry.py"],
    pathex=[str(HERE)],
    binaries=[],
    datas=[],
    hiddenimports=hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,           # UPX puede romper en algunos AVs; preferimos sin
    console=True,        # stdout debe estar disponible para el handshake
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="sidecar",  # carpeta resultante: dist/sidecar/
)
