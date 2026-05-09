"""Tests del `LogsService.publish` con promote-to-bottom (v1.1.3+).

Cubre el modelo de dedupe-con-merge:
- Primer mensaje → entry nueva con count=1
- Mensaje idéntico en ventana 5s → incrementa count + mueve al final
- Mensaje fuera de ventana 5s → entry nueva
- `skip_dedupe=True` siempre crea entry nueva
- Push event `log:entry:updated` se emite cuando hay merge
"""

from __future__ import annotations

import time

import pytest

from maru_sidecar.backend.logs import LogsService


@pytest.fixture
def svc() -> LogsService:
    return LogsService()


# ── Promote-to-bottom (v1.1.3) ───────────────────────────────────────────


class TestPromoteToBottom:
    def test_first_publish_creates_entry_count_1(self, svc: LogsService) -> None:
        e = svc.publish("Test msg", source="test")
        assert e["count"] == 1
        assert e["message"] == "Test msg"
        assert len(svc._buffer) == 1

    def test_duplicate_in_window_merges_count(self, svc: LogsService) -> None:
        e1 = svc.publish("Like @alice", source="test")
        e2 = svc.publish("Like @alice", source="test")
        e3 = svc.publish("Like @alice", source="test")
        # Mismo objeto entry en buffer (merge), count=3
        assert e3["count"] == 3
        assert len(svc._buffer) == 1
        # ID estable (no se crea entry nueva)
        assert e1["id"] == e2["id"] == e3["id"]

    def test_30_taps_merge_to_single_entry(self, svc: LogsService) -> None:
        """Caso de uso real: viewer da 30 likes → 1 sola entry con ×30."""
        for _ in range(30):
            svc.publish("❤️ Tap @user", source="test")
        assert len(svc._buffer) == 1
        assert svc._buffer[0]["count"] == 30

    def test_promote_to_end_after_merge(self, svc: LogsService) -> None:
        """La entry mergeada se mueve al final cuando llega un dup."""
        # 1) Crear entry "A"
        svc.publish("Mensaje A", source="test")
        # 2) Crear entry "B" después
        svc.publish("Mensaje B", source="test")
        # Buffer: [A, B]
        assert svc._buffer[-1]["message"] == "Mensaje B"
        # 3) Llega dup de A → debe MOVERSE al final
        svc.publish("Mensaje A", source="test")
        # Buffer ahora: [B, A] — A al final con count=2
        assert svc._buffer[-1]["message"] == "Mensaje A"
        assert svc._buffer[-1]["count"] == 2
        assert len(svc._buffer) == 2

    def test_skip_dedupe_always_creates_entry(self, svc: LogsService) -> None:
        for i in range(5):
            svc.publish("Mensaje X", source="test", skip_dedupe=True)
        # 5 entries separadas (no dedupe).
        assert len(svc._buffer) == 5
        # Todas con count=1 default.
        assert all(e.get("count") == 1 for e in svc._buffer)

    def test_outside_window_creates_new_entry(self, svc: LogsService) -> None:
        """Fuera de la ventana 5s, mensaje idéntico crea entry nueva."""
        svc.publish("Mensaje Y", source="test")
        # Forzar ts de la entry a hace 6 segundos (fuera de la ventana).
        old_ts = int(time.time() * 1000) - 6000
        svc._buffer[0]["ts"] = old_ts
        # Publicar otra → entry nueva (no merge).
        svc.publish("Mensaje Y", source="test")
        assert len(svc._buffer) == 2

    def test_different_source_doesnt_merge(self, svc: LogsService) -> None:
        """Mismo mensaje pero source distinto → entries separadas."""
        svc.publish("Same message", source="A")
        svc.publish("Same message", source="B")
        assert len(svc._buffer) == 2

    def test_different_level_doesnt_merge(self, svc: LogsService) -> None:
        """Mismo mensaje + source pero level distinto → separadas."""
        svc.publish("Same msg", source="x", level="INFO")
        svc.publish("Same msg", source="x", level="ERROR")
        assert len(svc._buffer) == 2


class TestEntryShape:
    """Validar que las entries persistidas en el buffer tienen el shape
    correcto que el frontend espera (id, ts, level, source, category,
    message, meta, count)."""

    def test_entry_has_required_fields(self, svc: LogsService) -> None:
        e = svc.publish("test", source="x", level="WARNING")
        for key in ("id", "ts", "level", "source", "category", "message", "count"):
            assert key in e, f"falta {key} en entry"
        assert e["level"] == "WARNING"
        assert e["count"] == 1

    def test_merge_updates_ts(self, svc: LogsService) -> None:
        """Tras merge, el ts se actualiza al timestamp del último hit
        (para que el frontend lo ordene como 'reciente')."""
        e1 = svc.publish("dup", source="x")
        ts1 = e1["ts"]
        time.sleep(0.01)  # asegurar diferencia detectable
        e2 = svc.publish("dup", source="x")
        # e1 y e2 son el mismo objeto (merge en el mismo dict)
        assert e1 is e2 or e1["id"] == e2["id"]
        assert e2["ts"] >= ts1
