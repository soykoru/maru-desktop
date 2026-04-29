"""Entry CLI del sidecar — `python -m maru_sidecar`.

Flags:
  --rpc-port N        Puerto WS sobre el que escuchar (default 8770).
  --log-level LEVEL   DEBUG | INFO | WARNING | ERROR (default INFO).
  --ready-stdout      Imprime `MARU_SIDECAR_READY <port>` por stdout cuando
                      el servidor esté listo. Electron parsea esa línea para
                      saber que puede conectar el cliente RPC.
"""

from __future__ import annotations

import argparse
import asyncio
import signal
import sys

from .backend.bootstrap import run_bootstrap_if_needed
from .event_bus import bind_event_bus
from .logger import configure as configure_logger
from .logger import get_logger
from .rpc import build_default_registry
from .runtime import ensure_runtime_dirs
from .server import RpcServer

READY_MARKER = "MARU_SIDECAR_READY"


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="maru_sidecar", description="MARU Live sidecar")
    parser.add_argument("--rpc-port", type=int, default=8770)
    parser.add_argument("--log-level", default="INFO",
                        choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    parser.add_argument("--ready-stdout", action="store_true")
    return parser.parse_args(argv)


async def _run(args: argparse.Namespace) -> int:
    log = get_logger("maru_sidecar.main")
    log.info("starting MARU sidecar (port=%d, log=%s)", args.rpc_port, args.log_level)

    ensure_runtime_dirs()
    seed = run_bootstrap_if_needed()
    if seed["seeded"]:
        log.info(
            "bootstrap: %d archivos sembrados desde %s",
            seed["seeded"],
            seed["sourceDir"],
        )
    bus = bind_event_bus(asyncio.get_running_loop())

    registry = build_default_registry()
    # Cablear RuleDispatcher al loop activo: ahora `tiktok:event` reales y
    # simulados disparan acciones de juego de verdad (HTTP/RCON).
    rule_dispatcher = getattr(registry, "rule_dispatcher", None)
    if rule_dispatcher is not None:
        rule_dispatcher.install(asyncio.get_running_loop())
    chat_dispatcher = getattr(registry, "chat_dispatcher", None)
    if chat_dispatcher is not None:
        chat_dispatcher.install(asyncio.get_running_loop())
    server = RpcServer(registry, port=args.rpc_port)
    ready: asyncio.Future[int] = asyncio.get_running_loop().create_future()

    serve_task = asyncio.create_task(server.serve_forever(on_ready=ready))
    pump_task = asyncio.create_task(server.pump_from_bus(bus))

    # Schedulers periódicos del sistema social — paridad MARU original
    # (`main_window.py:268-280`):
    #   - process_auto_rachas cada 1h: avanza días de racha auto.
    #   - cleanup_inactive_taps cada 6h: limpia usuarios inactivos.
    async def _social_schedulers() -> None:
        social_svc = getattr(registry, "social_svc", None)
        # Buscar el SocialService directo si no está en registry.
        if social_svc is None:
            try:
                from .backend.social import SocialService  # type: ignore
                # Buscar instancia ya construida en el registry handler.
                for _name in registry.list_names():
                    if _name == "social.command":
                        # SocialService está dentro del closure de los handlers;
                        # usamos un atajo: construir uno propio (singleton del core).
                        social_svc = SocialService()
                        break
            except Exception:
                pass
        if social_svc is None:
            log.warning("schedulers: SocialService no disponible — skip")
            return
        # Pequeño delay inicial (paridad MARU `singleShot(5000)`).
        await asyncio.sleep(5)
        while True:
            try:
                sys_inst = social_svc._ensure() if hasattr(social_svc, "_ensure") else None
                if sys_inst is not None:
                    if hasattr(sys_inst, "process_auto_rachas"):
                        sys_inst.process_auto_rachas()
            except Exception:
                log.exception("scheduler: process_auto_rachas")
            await asyncio.sleep(3600)  # 1 hora

    async def _taps_cleanup_scheduler() -> None:
        social_svc = getattr(registry, "social_svc", None)
        if social_svc is None:
            try:
                from .backend.social import SocialService  # type: ignore
                social_svc = SocialService()
            except Exception:
                return
        await asyncio.sleep(300)  # 5 min después de boot
        while True:
            try:
                sys_inst = social_svc._ensure() if hasattr(social_svc, "_ensure") else None
                if sys_inst is not None and hasattr(sys_inst, "cleanup_inactive_taps"):
                    sys_inst.cleanup_inactive_taps()
            except Exception:
                log.exception("scheduler: cleanup_inactive_taps")
            await asyncio.sleep(21600)  # 6 horas

    rachas_task = asyncio.create_task(_social_schedulers())
    cleanup_task = asyncio.create_task(_taps_cleanup_scheduler())

    # Spotify now-playing push scheduler — paridad `gui.py:9421` que usa
    # un QTimer cada 30s para el contexto + display global. Aquí publicamos
    # `spotify:now-playing` SOLO cuando el track o el estado cambia, para
    # que el header `🎵 ahora suena…` se actualice sin abrir el diálogo y
    # el monitor de cola/contexto siga corriendo (check_and_advance).
    async def _spotify_nowplaying_scheduler() -> None:
        spotify_svc = getattr(registry, "spotify_svc", None)
        if spotify_svc is None:
            log.info("scheduler: spotify no disponible — skip now-playing")
            return
        await asyncio.sleep(8)  # esperar conexión auto si la hay
        last_queue_key: str | None = None
        while True:
            try:
                payload = spotify_svc.poll_now_playing_for_push()
                if payload is not None:
                    bus.publish("spotify:now-playing", payload)
                # Cola: cada ciclo (5s) re-pulamos y publicamos si cambió.
                # Sin esto, la UI solo veía el snapshot al abrir el diálogo.
                queue_payload = spotify_svc.queue_list({})
                items = queue_payload.get("items") or []
                key = "|".join(
                    f"{i.get('trackId','')}:{i.get('requestedBy','')}"
                    for i in items
                )
                if key != last_queue_key:
                    last_queue_key = key
                    bus.publish("spotify:queue", {"items": items, "total": len(items)})
            except Exception:
                log.exception("scheduler: spotify now-playing/queue")
            # Más frecuente que antes (10s → 5s) para que el "en cola"
            # post-!play se vea casi inmediato sin saturar la API.
            await asyncio.sleep(5)

    spotify_np_task = asyncio.create_task(_spotify_nowplaying_scheduler())

    # Idle GC scheduler — cuando NO hay TikTok conectado, llamamos
    # gc.collect() periódicamente para liberar al SO la memoria de
    # objetos transitorios (RPC payloads, parsing JSON, etc). Sin esto,
    # la RSS del sidecar crece lentamente con uso normal y solo baja
    # cuando el GC generacional decide. En idle queremos baseline mínima.
    async def _idle_gc_scheduler() -> None:
        import gc as _gc
        # Esperar 60s post-boot antes del primer ciclo (no interferir
        # con el calentamiento inicial de imports/pygame/TikTokLive).
        await asyncio.sleep(60)
        while True:
            try:
                # Solo hacer GC si no estamos en plena conexión live —
                # durante un live activo el GC genera microhipos en el
                # processing de eventos. Lo detectamos viendo si el
                # TikTokService publicó status:connected recientemente.
                tiktok_svc = getattr(registry, "tiktok_svc", None)
                connected = bool(getattr(tiktok_svc, "_connected", False)) if tiktok_svc else False
                if not connected:
                    _gc.collect()
            except Exception:
                pass
            await asyncio.sleep(120)  # cada 2 min en idle

    idle_gc_task = asyncio.create_task(_idle_gc_scheduler())

    bound_port = await ready

    if args.ready_stdout:
        # Línea única, sin formato de logger. Electron parsea con regex.
        sys.stdout.write(f"{READY_MARKER} {bound_port}\n")
        sys.stdout.flush()

    stop_event = asyncio.Event()

    def _on_signal(*_: object) -> None:
        log.info("signal received → shutting down")
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _on_signal)
        except NotImplementedError:
            # Windows no soporta add_signal_handler; usamos signal.signal como fallback
            signal.signal(sig, lambda *_: _on_signal())

    await stop_event.wait()
    await server.stop()
    serve_task.cancel()
    pump_task.cancel()
    rachas_task.cancel()
    cleanup_task.cancel()
    spotify_np_task.cancel()
    idle_gc_task.cancel()
    return 0


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    configure_logger(args.log_level)
    try:
        return asyncio.run(_run(args))
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
