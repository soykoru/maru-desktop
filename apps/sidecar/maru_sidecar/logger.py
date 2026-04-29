"""Logger central del sidecar.

Convención (heredada del refactor de MARU):
  - CERO `print()` en módulos del paquete.
  - Todos los componentes obtienen su logger con `get_logger(__name__)`.
  - El handshake `MARU_SIDECAR_READY <port>` se imprime con `print()` en
    __main__ porque DEBE salir por stdout limpio para que Electron lo parsee.

Salidas:
  - StreamHandler a stderr (lo lee Electron para forwardear al renderer).
  - RotatingFileHandler a `runtime/logs/sidecar.log` (5 MB × 5 archivos).
"""

from __future__ import annotations

import logging
import logging.handlers
import sys
from typing import Final

_CONFIGURED: bool = False
_FORMAT: Final[str] = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
_DATEFMT: Final[str] = "%H:%M:%S"
_FILE_FORMAT: Final[str] = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
_FILE_DATEFMT: Final[str] = "%Y-%m-%d %H:%M:%S"


def configure(level: str = "INFO") -> None:
    global _CONFIGURED
    if _CONFIGURED:
        return

    root = logging.getLogger()
    root.setLevel(level.upper())
    root.handlers.clear()

    stream = logging.StreamHandler(sys.stderr)
    stream.setFormatter(logging.Formatter(_FORMAT, datefmt=_DATEFMT))
    root.addHandler(stream)

    # File handler con rotación — defer import para evitar crear runtime dirs
    # antes de que `ensure_runtime_dirs` corra.
    try:
        from .runtime import LOGS_DIR
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        log_file = LOGS_DIR / "sidecar.log"
        file_handler = logging.handlers.RotatingFileHandler(
            log_file, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
        )
        file_handler.setFormatter(logging.Formatter(_FILE_FORMAT, datefmt=_FILE_DATEFMT))
        root.addHandler(file_handler)
    except Exception as exc:  # noqa: BLE001 — fallback silencioso si no podemos escribir
        root.warning("no pude inicializar file logger: %s", exc)

    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
