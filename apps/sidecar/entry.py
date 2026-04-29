"""Entry wrapper para PyInstaller.

PyInstaller ejecuta el script de entry como top-level, lo que rompe los
imports relativos `from .backend...` en `maru_sidecar/__main__.py`. Este
wrapper importa el paquete de forma absoluta y delega.
"""

from __future__ import annotations

import sys

from maru_sidecar.__main__ import main


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
