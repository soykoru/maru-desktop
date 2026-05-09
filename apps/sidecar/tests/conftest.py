"""Conftest para tests del sidecar — agrega `core/` legacy al sys.path.

`core.rule_engine` (RuleEngine + Rule + GameProfile) vive en
`LiveChaosEngine_Refactored/core/`, fuera del paquete `maru_sidecar`.
Sin esta inyección al path los tests no pueden importarlo.

Resolución:
1. Variable env `MARU_CORE_SRC` (CI/dev override)
2. Default: ../../LiveChaosEngine/LiveChaosEngine_Refactored/ relativo al sidecar

v1.1.8: si el core NO está disponible (caso típico en GitHub Actions
sin checkout del repo de LiveChaosEngine), los tests que dependen de
`core` se skipean con `pytest.importorskip('core.rule_engine')`. Los
demás tests del sidecar corren normal — el CI valida lo que se puede
sin acceso al core legacy.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent  # apps/sidecar/tests
_SIDECAR = _HERE.parent  # apps/sidecar


def _resolve_core_root() -> Path | None:
    env = os.environ.get("MARU_CORE_SRC", "").strip()
    if env:
        p = Path(env)
        if p.is_dir():
            return p
    # Default: subir hasta el monorepo y buscar LiveChaosEngine_Refactored.
    # apps/sidecar → apps → maru-desktop → MARU PRO → LiveChaosEngine
    candidates = [
        _SIDECAR.parents[2] / "LiveChaosEngine" / "LiveChaosEngine_Refactored",
        _SIDECAR.parents[1] / "LiveChaosEngine" / "LiveChaosEngine_Refactored",
    ]
    for c in candidates:
        if c.is_dir() and (c / "core" / "rule_engine.py").is_file():
            return c
    return None


# v1.1.8: flag explícita para forzar el skip de tests que requieren
# core en CI sin checkout de LiveChaosEngine. En local NUNCA setear esto.
_FORCE_SKIP = os.environ.get("MARU_SKIP_CORE_TESTS", "").strip() in ("1", "true", "yes")

_core_root = None if _FORCE_SKIP else _resolve_core_root()
if _core_root is not None and str(_core_root) not in sys.path:
    sys.path.insert(0, str(_core_root))


def _core_is_available() -> bool:
    """v1.1.8: chequeo barato — ¿el módulo `core.rule_engine` se puede
    importar? Tests que lo necesitan usan `pytest.importorskip` que
    llama esto indirectamente."""
    if _core_root is None:
        return False
    return (_core_root / "core" / "rule_engine.py").is_file()


# Exponemos una flag global para que tests que mezclan código del
# core con código del sidecar puedan condicionar fixtures.
CORE_AVAILABLE = _core_is_available()
