"""Smoke test end-to-end: levanta el server, conecta un WS cliente,
manda un ping y verifica la respuesta. Sin Electron, puro Python."""

from __future__ import annotations

import asyncio
import json

import pytest
import websockets

from maru_sidecar.rpc import build_default_registry
from maru_sidecar.server import RpcServer


@pytest.mark.asyncio
async def test_ping_roundtrip() -> None:
    server = RpcServer(build_default_registry(), port=0)  # 0 = puerto libre
    ready: asyncio.Future[int] = asyncio.get_running_loop().create_future()
    serve_task = asyncio.create_task(server.serve_forever(on_ready=ready))
    bound_port = await ready

    try:
        async with websockets.connect(f"ws://127.0.0.1:{bound_port}") as ws:
            await ws.send(json.dumps(
                {"jsonrpc": "2.0", "id": 1, "method": "ping", "params": {"echo": "hi"}}
            ))
            raw = await asyncio.wait_for(ws.recv(), timeout=2.0)
            msg = json.loads(raw)
            assert msg["id"] == 1
            assert msg["result"]["ok"] is True
            assert msg["result"]["echo"] == "hi"
    finally:
        await server.stop()
        serve_task.cancel()
