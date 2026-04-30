"""EventBus thread-safe con bridge a asyncio.

Problema que resuelve:
  - Los componentes del core (TikTok client, social, etc.) corren en QThreads
    o ThreadPoolExecutor y emiten señales/callbacks desde threads no-asyncio.
  - El RpcServer corre en un event loop asyncio y necesita serializar y
    enviar JSON-RPC notifications por WebSocket.

Diseño:
  - `EventBus.publish(event, payload)` es **sync** y thread-safe → cualquiera
    puede llamarlo.
  - Internamente encola en un asyncio.Queue del loop principal usando
    `loop.call_soon_threadsafe`.
  - El consumidor (RpcServer) hace `async for evt in bus.stream()` y los
    broadcastea como notifications.

Beneficios vs. el original:
  - Cero acoplamiento a Qt en el sidecar.
  - Los adapters publican con una sola línea, sin saber del WS.
  - Tests unitarios fáciles: instanciar bus, publicar, leer queue.
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

from .logger import get_logger

log = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class BusEvent:
    name: str
    payload: dict[str, Any]


class EventBus:
    """Bus pub/sub thread→asyncio. Una sola instancia por proceso."""

    def __init__(self, loop: asyncio.AbstractEventLoop | None = None) -> None:
        self._loop = loop or asyncio.get_event_loop()
        # Cap moderado: en stream típico vemos 20-50 ev/s; 512 da headroom
        # de 10s antes de saturar. Más allá la política FIFO drop activa.
        self._queue: asyncio.Queue[BusEvent] = asyncio.Queue(maxsize=512)
        self._listeners_lock = threading.Lock()
        self._listeners: dict[str, list[Callable[[dict[str, Any]], None]]] = {}

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        """Cambia el loop al que se hace dispatch (útil si el bus se crea
        antes que el loop, p. ej. en imports)."""
        self._loop = loop

    def publish(self, name: str, payload: dict[str, Any]) -> None:
        """Sync, thread-safe. Llamable desde cualquier thread."""
        evt = BusEvent(name=name, payload=payload)
        try:
            self._loop.call_soon_threadsafe(self._enqueue, evt)
        except RuntimeError:
            # Loop cerrado durante shutdown — drop silencioso, no rompemos al caller.
            log.debug("event dropped (loop closed): %s", name)

    def subscribe(
        self,
        name: str,
        callback: Callable[[dict[str, Any]], None],
    ) -> None:
        """Registrar callback in-process para `name`. Se ejecuta en el loop
        antes de encolar al stream WS — fan-out interno (rule dispatcher,
        métricas, etc.) sin robarle eventos al consumidor del stream.

        IDEMPOTENTE: si el MISMO callback (por identidad) ya está en la
        lista para el mismo evento, no se vuelve a registrar. Sin esto,
        un install() llamado 2x (race de inicialización, reconexión, hot-
        reload) creaba listeners duplicados y los TTS de comandos se
        leían 2 veces.
        """
        with self._listeners_lock:
            lst = self._listeners.setdefault(name, [])
            if callback in lst:
                return
            lst.append(callback)

    def _enqueue(self, evt: BusEvent) -> None:
        # Fan-out a listeners in-process (en el loop del sidecar).
        with self._listeners_lock:
            listeners = list(self._listeners.get(evt.name, ()))
        for cb in listeners:
            try:
                cb(evt.payload)
            except Exception:
                log.exception("listener error for %s", evt.name)
        try:
            self._queue.put_nowait(evt)
        except asyncio.QueueFull:
            # Política: dropear el más viejo y meter el nuevo (FIFO con presión)
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            self._queue.put_nowait(evt)
            log.warning("event queue saturada — descartado evento más viejo")

    async def stream(self) -> AsyncIterator[BusEvent]:
        while True:
            evt = await self._queue.get()
            yield evt


# Instancia global lazily inicializada
_BUS: EventBus | None = None


def get_event_bus() -> EventBus:
    global _BUS
    if _BUS is None:
        _BUS = EventBus()
    return _BUS


def bind_event_bus(loop: asyncio.AbstractEventLoop) -> EventBus:
    """Llamar UNA vez al arrancar el loop principal del sidecar."""
    bus = get_event_bus()
    bus.bind(loop)
    return bus
