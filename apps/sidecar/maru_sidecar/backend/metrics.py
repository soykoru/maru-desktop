"""Adapter `system.metrics` — observabilidad en runtime.

Diseño:
  - Sin deps externas: `os`, `threading`, `resource`/`ctypes` para RAM.
  - `psutil` lo usamos *si* está disponible (mejor exactitud); si no,
    fallback con `resource.getrusage` (Linux/Mac) o `ctypes.windll`.
  - tracemalloc opcional (solo si `MARU_TRACEMALLOC=1` al boot).

Métricas reportadas:
  - rssMb         — Resident Set Size en MB
  - cpuPercent    — % de CPU promedio del proceso (windowed)
  - threadCount   — threads activos
  - busQueueSize  — backlog del EventBus
  - uptimeMs      — ms desde el boot
  - topAlloc      — solo si tracemalloc activo (5 lines)
"""

from __future__ import annotations

import os
import sys
import threading
import time
import tracemalloc
from typing import Any

from ..event_bus import get_event_bus
from ..logger import get_logger

log = get_logger(__name__)

_BOOT_MS = int(time.time() * 1000)
_TRACEMALLOC_ENABLED = os.environ.get("MARU_TRACEMALLOC") == "1"

if _TRACEMALLOC_ENABLED:
    tracemalloc.start(25)


def _try_psutil() -> Any:
    try:
        import psutil  # type: ignore
        return psutil.Process(os.getpid())
    except Exception:
        return None


_PSUTIL_PROC = _try_psutil()
_LAST_CPU_TIMES: tuple[float, float] | None = None


def _rss_mb() -> float:
    if _PSUTIL_PROC is not None:
        try:
            return _PSUTIL_PROC.memory_info().rss / (1024 * 1024)
        except Exception:
            pass
    if sys.platform != "win32":
        try:
            import resource

            ru = resource.getrusage(resource.RUSAGE_SELF)
            # macOS reporta bytes, Linux KB
            divisor = 1024 * 1024 if sys.platform == "darwin" else 1024
            return ru.ru_maxrss / divisor
        except Exception:
            return 0.0
    # Fallback Windows sin psutil
    try:
        import ctypes
        from ctypes import wintypes

        class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        psapi = ctypes.WinDLL("psapi.dll")
        kernel32 = ctypes.WinDLL("kernel32.dll")
        h = kernel32.GetCurrentProcess()
        pmc = PROCESS_MEMORY_COUNTERS()
        pmc.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
        psapi.GetProcessMemoryInfo(h, ctypes.byref(pmc), pmc.cb)
        return pmc.WorkingSetSize / (1024 * 1024)
    except Exception:
        return 0.0


def _cpu_percent() -> float:
    global _LAST_CPU_TIMES
    if _PSUTIL_PROC is not None:
        try:
            return float(_PSUTIL_PROC.cpu_percent(interval=None))
        except Exception:
            pass
    # Fallback: medir CPU time entre llamadas
    try:
        cpu = os.times()
        now_user = cpu.user
        now_sys = cpu.system
        now_wall = time.time()
    except Exception:
        return 0.0
    if _LAST_CPU_TIMES is None:
        _LAST_CPU_TIMES = (now_user + now_sys, now_wall)
        return 0.0
    last_total, last_wall = _LAST_CPU_TIMES
    elapsed = max(now_wall - last_wall, 0.001)
    delta = (now_user + now_sys) - last_total
    _LAST_CPU_TIMES = (now_user + now_sys, now_wall)
    return min(100.0, max(0.0, (delta / elapsed) * 100.0 / max(os.cpu_count() or 1, 1)))


def _bus_queue_size() -> int:
    try:
        bus = get_event_bus()
        # Usa atributo privado pero estable; el cap está en F6 a 512
        return bus._queue.qsize() if hasattr(bus, "_queue") else 0  # type: ignore[attr-defined]
    except Exception:
        return 0


def _top_alloc(limit: int = 5) -> list[dict[str, Any]] | None:
    if not _TRACEMALLOC_ENABLED:
        return None
    try:
        snap = tracemalloc.take_snapshot()
        stats = snap.statistics("lineno")[:limit]
        return [
            {
                "file": str(s.traceback[0].filename),
                "line": s.traceback[0].lineno,
                "sizeMb": round(s.size / (1024 * 1024), 3),
                "count": s.count,
            }
            for s in stats
        ]
    except Exception:
        return None


class MetricsService:
    def metrics(self, _params: dict[str, Any]) -> dict[str, Any]:
        return {
            "rssMb": round(_rss_mb(), 1),
            "cpuPercent": round(_cpu_percent(), 1),
            "threadCount": threading.active_count(),
            "busQueueSize": _bus_queue_size(),
            "uptimeMs": int(time.time() * 1000) - _BOOT_MS,
            "tracemallocEnabled": _TRACEMALLOC_ENABLED,
            "topAlloc": _top_alloc(),
            "psutilAvailable": _PSUTIL_PROC is not None,
        }
