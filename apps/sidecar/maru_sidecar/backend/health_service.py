"""Healthcheck periódico contra el mod del juego ACTIVO.

v1.0.72: feature nueva. Loop async cada 30s que verifica si el mod del
juego actualmente seleccionado está respondiendo. Sin este healthcheck, el
user solo descubría que el mod cayó cuando una regla fallaba en mitad del
live.

Diseño:
  - Solo monitorea el juego ACTIVO (lectura via callback inyectado, ej:
    `RuleDispatcher._read_active_game`). No saturamos con pings a los 7
    juegos cuando solo se usa uno.
  - Llama a `game.test_connection()` (que ya existe en cada clase del
    core). No reinventa el wheel — reusa la lógica de detección de cada
    juego (HTTP /status, POST vacío, socket raw para HTTP; conn+auth para
    RCON).
  - Ejecuta el test_connection en un thread (es sync con socket, hasta
    1.5s en el peor caso) → no bloquea el loop asyncio.
  - Mide latencia round-trip.
  - Publica `game:health` al EventBus en cada tick (UI lo consume y
    actualiza el badge). Política simple, sin dedupe — el UI puede
    decidir si re-renderiza o no por shallow compare.
  - Snapshot in-memory para que el dialog pueda pintar estado inicial al
    abrir (RPC `games.health.snapshot`).

Latencia thresholds:
  - <1500 ms          → status "ok"   (verde)
  - 1500-5000 ms      → status "slow" (amarillo)
  - timeout / error   → status "down" (rojo)

Reversibilidad:
  - Borrar este archivo + las 3 secciones marcadas con
    `MARU-HEALTH-INTEGRATION` en `registry.py` + `__main__.py` +
    `event-wire.ts` + `HealthBadge.tsx` vuelve al estado pre-feature sin
    rastros.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from typing import Any

from ..event_bus import EventBus, get_event_bus
from ..logger import get_logger

log = get_logger(__name__)

# Timeout total por check. `test_connection` internamente usa 0.5s timeout
# por intento (3 intentos en HTTP, ~1.5s peor caso). RCON intenta una
# conexión TCP + auth (puede tardar más en redes lentas). 5s da margen.
_CHECK_TIMEOUT_S = 5.0

# Intervalo entre checks. 30s detecta caídas razonablemente rápido sin
# saturar el mod (que en muchos casos es un HTTPListener muy simple).
_CHECK_INTERVAL_S = 30.0

# Threshold "lento" → si el round-trip excede este valor, status=slow.
_SLOW_LATENCY_MS = 1500


class HealthCheckService:
    """Monitorea salud del juego activo cada 30s."""

    def __init__(
        self,
        games_svc: Any,
        bus: EventBus | None = None,
    ) -> None:
        self._games_svc = games_svc
        self._bus = bus or get_event_bus()
        # Snapshot por gameId. Solo guardamos el último resultado.
        self._snapshot: dict[str, dict[str, Any]] = {}
        self._task: asyncio.Task[None] | None = None
        self._active_game_reader: Callable[[], str | None] | None = None
        self._stopped = False

    def attach_active_game_reader(
        self,
        reader: Callable[[], str | None],
    ) -> None:
        """Setea el callback para leer el `gameId` activo.

        Permite reusar `RuleDispatcher._read_active_game` (con su cache TTL
        de 1.5s) sin duplicar I/O contra `data/config.json`.
        """
        self._active_game_reader = reader

    def install(self, loop: asyncio.AbstractEventLoop) -> None:
        """Arranca el loop async. Idempotente: llamarlo 2x es no-op."""
        if self._task is not None and not self._task.done():
            return
        self._stopped = False
        self._task = loop.create_task(self._loop())

    async def stop(self) -> None:
        self._stopped = True
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass

    async def snapshot(self, _params: dict[str, Any]) -> dict[str, Any]:
        """RPC `games.health.snapshot` → estado actual de juegos chequeados."""
        return {"games": dict(self._snapshot)}

    # ── Internals ────────────────────────────────────────────────────────

    async def _loop(self) -> None:
        # Delay inicial: 10s post-boot. Evita pinguear durante el
        # warmup de imports y permite que el user vea la UI primero.
        await asyncio.sleep(10)
        while not self._stopped:
            try:
                await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("healthcheck tick error")
            try:
                await asyncio.sleep(_CHECK_INTERVAL_S)
            except asyncio.CancelledError:
                raise

    async def _tick(self) -> None:
        if self._active_game_reader is None:
            return
        try:
            gid = self._active_game_reader()
        except Exception:
            log.exception("healthcheck: read active_game falló")
            return
        if not gid:
            return

        try:
            inst = self._games_svc.get_instance(gid)
        except Exception:
            log.exception("healthcheck: get_instance(%s)", gid)
            return
        if inst is None:
            return

        loop = asyncio.get_running_loop()
        t0 = time.monotonic()
        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(None, inst.test_connection),
                timeout=_CHECK_TIMEOUT_S,
            )
        except asyncio.TimeoutError:
            latency_ms = int(_CHECK_TIMEOUT_S * 1000)
            self._publish(gid, alive=False, latency_ms=latency_ms,
                          message="⏰ Timeout (>5s)")
            return
        except Exception as exc:
            self._publish(gid, alive=False, latency_ms=0,
                          message=f"❌ {str(exc)[:60]}")
            return

        latency_ms = int((time.monotonic() - t0) * 1000)
        if isinstance(result, tuple) and len(result) == 2:
            ok, msg = result
            self._publish(gid, alive=bool(ok), latency_ms=latency_ms,
                          message=str(msg))
        else:
            self._publish(gid, alive=True, latency_ms=latency_ms,
                          message=str(result))

    def _publish(
        self,
        gid: str,
        *,
        alive: bool,
        latency_ms: int,
        message: str,
    ) -> None:
        if not alive:
            status = "down"
        elif latency_ms > _SLOW_LATENCY_MS:
            status = "slow"
        else:
            status = "ok"
        prev = self._snapshot.get(gid)
        prev_status = prev.get("status") if prev else None
        payload: dict[str, Any] = {
            "gameId": gid,
            "alive": alive,
            "latencyMs": latency_ms,
            "message": message,
            "status": status,
            "ts": int(time.time() * 1000),
        }
        self._snapshot[gid] = payload
        self._bus.publish("game:health", payload)

        # Log estructurado SOLO al cambiar de estado — sin esto saturaríamos
        # el panel con un INFO cada 30s. Las transiciones que importan al user:
        #   - * → down  : el mod se cayó (warning visible).
        #   - down → ok : el mod volvió (info visible, alivio).
        #   - * → slow  : latencia alta (warning silencioso).
        if prev_status != status:
            if status == "down":
                log.warning(
                    "🔴 %s: mod no responde (%s) — verificá si está corriendo",
                    gid, message,
                )
            elif status == "slow":
                log.warning(
                    "🟡 %s: respuesta lenta (%dms) — el mod está congestionado",
                    gid, latency_ms,
                )
            elif prev_status == "down":
                log.info("🟢 %s: mod respondiendo de nuevo (%dms)", gid, latency_ms)
