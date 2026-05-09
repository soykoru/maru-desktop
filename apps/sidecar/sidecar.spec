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

# Localizar el `core/` de LiveChaosEngine_Refactored para incluirlo en
# el bundle. Sin esto, en producción el sidecar arrancaba pero el
# `core_bridge.install()` fallaba al hacer `from core.tiktok_client
# import TikTokWorker` → todos los backends quedaban en stub-mode y la
# app se quedaba colgada en el splash.
#
# Estrategia: copiar `core/` (~1MB, 48 archivos) al root del bundle de
# PyInstaller. En runtime, `core_bridge._resolve_core_root` reconoce el
# `sys._MEIPASS` y agrega `core/` al sys.path.
#
# El ENV var `MARU_CORE_SRC` permite override en CI/máquinas distintas.
_core_src_env = os.environ.get("MARU_CORE_SRC", "").strip()
if _core_src_env:
    CORE_SRC = Path(_core_src_env)
else:
    # Default: ../../LiveChaosEngine/LiveChaosEngine_Refactored/core
    # Layout esperado: <root>/maru-desktop/apps/sidecar/   y
    #                  <root>/LiveChaosEngine/LiveChaosEngine_Refactored/core/
    CORE_SRC = HERE.parents[2] / "LiveChaosEngine" / "LiveChaosEngine_Refactored" / "core"

if not CORE_SRC.is_dir():
    raise SystemExit(
        f"sidecar.spec: core/ no encontrado en {CORE_SRC}. "
        "Definí MARU_CORE_SRC=<ruta absoluta del core/> o ajustá la heurística."
    )

# `datas` de PyInstaller: copia recursiva ignorando __pycache__.
core_datas = []
for p in CORE_SRC.rglob("*"):
    if p.is_file() and "__pycache__" not in p.parts and not p.name.endswith(".pyc"):
        rel_dir = p.parent.relative_to(CORE_SRC)
        dest = ("core" / rel_dir).as_posix() if str(rel_dir) != "." else "core"
        core_datas.append((str(p), dest))


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
    "maru_sidecar.backend.utils",
    "maru_sidecar.backend.utils.tts_text",
    "maru_sidecar.backend.keyboard",
    # pynput — acciones de teclado (action_type='keyboard'). Cross-platform.
    # Los submódulos win32/xorg/darwin son lazy según OS al import — los
    # listamos explícitos para que PyInstaller los embeba en Windows.
    "pynput",
    "pynput.keyboard",
    "pynput.keyboard._win32",
    "pynput.mouse",
    "pynput.mouse._win32",
    "pynput._util",
    "pynput._util.win32",
    # pygetwindow — filtro opcional de ventana enfocada para acciones
    # de teclado. Si no está disponible, KeyboardService hace fail-soft
    # (no aplica filtro). Aún así lo embebemos para que el filtro funcione.
    "pygetwindow",
    "pyrect",
    # core/ del LiveChaosEngine_Refactored — empaquetado vía datas.
    # Lo declaramos como hidden imports también para que PyInstaller
    # incluya sus deps transitivas (PyQt6, pygame, requests, etc).
    "core",
    "core.tiktok_client",
    "core.rule_engine",
    "core.games",
    "core.social_system",
    "core.spotify_client",
    "core.ia_engine",
    "core.tts_engine",
    "core.config_store",
    "core.paths",
    "core.logger",
    "core.minigames",
    "core.minigame_stats",
    "core.overlays",
    # Deps del core (PyQt6 lo usa TikTokWorker, pygame el TTS)
    "PyQt6",
    "PyQt6.QtCore",
    "PyQt6.QtGui",
    "PyQt6.QtWidgets",
    "pygame",
    "pygame.mixer",
    "TikTokLive",
    "TikTokLive.client",
    "TikTokLive.events",
    "spotipy",
    "requests",
    "httpx",
    "betterproto",
    "protobuf",
]

# Excluimos toolchains pesados que no usamos en el sidecar.
# OJO: PIL ya NO está excluido — TikTokLive 6.6.5 lo necesita
# transitivamente para algunos parsers de imagen.
excludes = [
    "tkinter",
    "matplotlib",
    "numpy.tests",
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
    datas=core_datas,
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
