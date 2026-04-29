"""Tests del EventBus — publish thread-safe + stream asyncio."""

from __future__ import annotations

import asyncio
import threading

import pytest

from maru_sidecar.event_bus import EventBus


@pytest.mark.asyncio
async def test_publish_from_main_thread() -> None:
    loop = asyncio.get_running_loop()
    bus = EventBus(loop=loop)
    bus.publish("test:hello", {"value": 1})
    stream = bus.stream()
    evt = await asyncio.wait_for(anext(stream), timeout=1.0)
    assert evt.name == "test:hello"
    assert evt.payload == {"value": 1}


@pytest.mark.asyncio
async def test_publish_from_other_thread() -> None:
    loop = asyncio.get_running_loop()
    bus = EventBus(loop=loop)

    def emit() -> None:
        bus.publish("from:thread", {"tid": threading.get_ident()})

    threading.Thread(target=emit, daemon=True).start()
    stream = bus.stream()
    evt = await asyncio.wait_for(anext(stream), timeout=1.0)
    assert evt.name == "from:thread"
    assert "tid" in evt.payload
