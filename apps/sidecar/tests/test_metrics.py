"""Tests del MetricsService — campos clave + tipos correctos."""

from __future__ import annotations

from maru_sidecar.backend.metrics import MetricsService


def test_metrics_returns_required_fields() -> None:
    svc = MetricsService()
    m = svc.metrics({})
    assert isinstance(m["rssMb"], float)
    assert m["rssMb"] >= 0
    assert isinstance(m["cpuPercent"], float)
    assert isinstance(m["threadCount"], int)
    assert m["threadCount"] >= 1
    assert isinstance(m["busQueueSize"], int)
    assert isinstance(m["uptimeMs"], int)
    assert m["uptimeMs"] >= 0
    assert isinstance(m["tracemallocEnabled"], bool)
    assert isinstance(m["psutilAvailable"], bool)


def test_metrics_topAlloc_none_when_disabled() -> None:
    svc = MetricsService()
    m = svc.metrics({})
    if not m["tracemallocEnabled"]:
        assert m["topAlloc"] is None


def test_metrics_cpu_in_range() -> None:
    svc = MetricsService()
    # 2 mediciones consecutivas para que el fallback de CPU compute delta
    svc.metrics({})
    m = svc.metrics({})
    assert 0.0 <= m["cpuPercent"] <= 100.0
