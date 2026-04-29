"""Servidor JSON-RPC 2.0 sobre WebSocket.

Endpoint único en `ws://127.0.0.1:<port>`. Cada cliente (Electron main) abre
una conexión y envía requests JSON-RPC; el server responde y, opcionalmente,
empuja notifications (push events) cuando ocurren cosas en el backend.

Fase 0: solo request/response (ping). Push events se introducen en Fase 1.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import websockets
from websockets.asyncio.server import ServerConnection, serve

from .logger import get_logger
from .rpc import MethodRegistry, RpcError, RpcErrorCode

log = get_logger(__name__)


class RpcServer:
    def __init__(self, registry: MethodRegistry, host: str = "127.0.0.1", port: int = 8770):
        self.registry = registry
        self.host = host
        self.port = port
        self._server: websockets.asyncio.server.Server | None = None
        self._clients: set[ServerConnection] = set()

    async def serve_forever(self, on_ready: "asyncio.Future[int] | None" = None) -> None:
        self._server = await serve(self._handle_client, self.host, self.port)
        bound_port = self._actual_port()
        log.info("rpc server listening on %s:%d", self.host, bound_port)
        if on_ready is not None and not on_ready.done():
            on_ready.set_result(bound_port)
        try:
            await self._server.wait_closed()
        finally:
            log.info("rpc server stopped")

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    async def broadcast(self, method: str, params: dict[str, Any]) -> None:
        """Empuja un push event (notification) a todos los clientes conectados."""
        if not self._clients:
            return
        payload = json.dumps({"jsonrpc": "2.0", "method": method, "params": params})
        await asyncio.gather(
            *(self._safe_send(c, payload) for c in list(self._clients)),
            return_exceptions=True,
        )

    async def pump_from_bus(self, bus: "Any") -> None:
        """Drena el EventBus y broadcastea cada evento como notification.

        Tarea de larga vida: vive durante toda la sesión del server.
        """
        async for evt in bus.stream():
            await self.broadcast(evt.name, evt.payload)

    def _actual_port(self) -> int:
        assert self._server is not None
        for sock in self._server.sockets or []:
            return sock.getsockname()[1]
        return self.port

    async def _handle_client(self, conn: ServerConnection) -> None:
        self._clients.add(conn)
        log.info("client connected: %s", conn.remote_address)
        try:
            async for raw in conn:
                await self._handle_message(conn, raw if isinstance(raw, str) else raw.decode("utf-8"))
        except websockets.ConnectionClosed:
            pass
        finally:
            self._clients.discard(conn)
            log.info("client disconnected: %s", conn.remote_address)

    async def _handle_message(self, conn: ServerConnection, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            await self._send_error(conn, None, RpcErrorCode.PARSE_ERROR, "parse error")
            return

        if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
            await self._send_error(conn, msg.get("id") if isinstance(msg, dict) else None,
                                   RpcErrorCode.INVALID_REQUEST, "invalid request")
            return

        method = msg.get("method")
        params = msg.get("params") or {}
        msg_id = msg.get("id")

        if not isinstance(method, str):
            await self._send_error(conn, msg_id, RpcErrorCode.INVALID_REQUEST, "missing method")
            return
        if not isinstance(params, dict):
            await self._send_error(conn, msg_id, RpcErrorCode.INVALID_PARAMS, "params must be object")
            return

        try:
            result = await self.registry.dispatch(method, params)
        except RpcError as err:
            await self._send_error(conn, msg_id, err.code, err.message, err.data)
            return

        if msg_id is None:
            return  # notification, no response
        await self._safe_send(conn, json.dumps({"jsonrpc": "2.0", "id": msg_id, "result": result}))

    async def _send_error(
        self,
        conn: ServerConnection,
        msg_id: Any,
        code: RpcErrorCode,
        message: str,
        data: Any = None,
    ) -> None:
        body: dict[str, Any] = {"code": int(code), "message": message}
        if data is not None:
            body["data"] = data
        await self._safe_send(
            conn, json.dumps({"jsonrpc": "2.0", "id": msg_id, "error": body})
        )

    @staticmethod
    async def _safe_send(conn: ServerConnection, payload: str) -> None:
        try:
            await conn.send(payload)
        except websockets.ConnectionClosed:
            pass
