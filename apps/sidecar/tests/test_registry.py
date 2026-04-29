"""Tests del registry RPC: dispatch, errores y método ping."""

from __future__ import annotations

import pytest

from maru_sidecar.rpc import RpcError, RpcErrorCode, build_default_registry


@pytest.mark.asyncio
async def test_ping_returns_pong_at_and_protocol_version() -> None:
    reg = build_default_registry()
    res = await reg.dispatch("ping", {})
    assert res["ok"] is True
    assert isinstance(res["pongAt"], int)
    assert res["protocolVersion"] == 1


@pytest.mark.asyncio
async def test_ping_echoes_string() -> None:
    reg = build_default_registry()
    res = await reg.dispatch("ping", {"echo": "hola"})
    assert res["echo"] == "hola"


@pytest.mark.asyncio
async def test_unknown_method_raises_method_not_found() -> None:
    reg = build_default_registry()
    with pytest.raises(RpcError) as exc:
        await reg.dispatch("does.not.exist", {})
    assert exc.value.code == RpcErrorCode.METHOD_NOT_FOUND
