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

# Forzar UTF-8 en stdout/stderr ANTES de cualquier import que pueda escribir
# (logger, spotipy, etc.). En Windows, cuando el sidecar.exe corre vía
# Electron spawn, Python detecta `cp1252` (charmap) por defecto y CUALQUIER
# emoji en log.info/print revienta con
# `'charmap' codec can't encode character '\U0001f3b5'` (la 🎵 de Spotify
# es la más visible, pero afecta a TODOS los emojis del proyecto).
# `reconfigure` está disponible desde Python 3.7. errors="replace" garantiza
# que un caracter raro nunca tira el proceso.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
except (AttributeError, OSError):
    # Streams no reconfigurables (p.ej. capturados por testrunner): seguir.
    pass

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
    # Marcador único por arranque — el hydrate_from_file lo usa para
    # cargar SOLO las entries del último boot, evitando que el panel
    # del frontend muestre logs de boots previos como duplicados.
    log.info("=== MARU BOOT === (pid=%d)", __import__("os").getpid())
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
    # MARU-OVERLAYS-INTEGRATION (1/1 en __main__): arranca el WS uplink
    # del relay. Suscriptor pasivo del bus + reconexión automática.
    overlays_svc = getattr(registry, "overlays_svc", None)
    if overlays_svc is not None:
        overlays_svc.install(asyncio.get_running_loop())
    # MARU-HEALTH-INTEGRATION: arranca loop async del healthcheck.
    # Ping cada 30s al juego ACTIVO (no a los 7) → publica `game:health`.
    health_svc = getattr(registry, "health_svc", None)
    if health_svc is not None:
        health_svc.install(asyncio.get_running_loop())
    # Optimización RAM: forzar GC después del bootstrap. Los imports
    # iniciales (registry building, instanciación de services) dejan
    # bastante objeto temporal — un ciclo de gc libera ~10-20 MB.
    try:
        import gc
        gc.collect()
    except Exception:
        pass
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
                # CRÍTICO v1.0.61: estos calls hacen HTTP a Spotify Web API.
                # Antes corrían SÍNCRONOS en el loop asyncio cada 5s,
                # bloqueándolo durante el request (200ms-3s típico, hasta
                # 30s si Spotify rate-limita). Eso era invisible en uso
                # normal pero durante el OAuth manual del user TAMBIÉN
                # corría → bloqueo combinado → renderer pierde RPC →
                # pantalla negra. Ahora delegamos a thread y el loop
                # asyncio queda libre para procesar otros RPCs.
                payload = await asyncio.to_thread(
                    spotify_svc.poll_now_playing_for_push
                )
                if payload is not None:
                    bus.publish("spotify:now-playing", payload)
                # Cola: cada ciclo (5s) re-pulamos y publicamos si cambió.
                # Sin esto, la UI solo veía el snapshot al abrir el diálogo.
                # Suprimida durante OAuth para no competir con el
                # authenticate() en thread.
                if not spotify_svc.is_oauth_in_progress:
                    queue_payload = await asyncio.to_thread(
                        spotify_svc.queue_list, {}
                    )
                    items = queue_payload.get("items") or []
                    key = "|".join(
                        f"{i.get('trackId','')}:{i.get('requestedBy','')}"
                        for i in items
                    )
                    if key != last_queue_key:
                        last_queue_key = key
                        bus.publish(
                            "spotify:queue",
                            {"items": items, "total": len(items)},
                        )
            except Exception:
                log.exception("scheduler: spotify now-playing/queue")
            # Más frecuente que antes (10s → 5s) para que el "en cola"
            # post-!play se vea casi inmediato sin saturar la API.
            await asyncio.sleep(5)

    spotify_np_task = asyncio.create_task(_spotify_nowplaying_scheduler())

    # GC scheduler — corre SIEMPRE para liberar memoria de objetos
    # transitorios (RPC payloads, parsing JSON, eventos del bus, etc).
    #
    # v1.0.69: doble política según estado de conexión:
    #   - IDLE (sin live): full collect cada 2 min (gen=2). Libera todo.
    #   - LIVE ACTIVO: gen=0 cada 3 min. Solo objetos jóvenes (rápido,
    #     <1ms, sin microhipos perceptibles en el processing de eventos).
    #
    # Sin esto, la RSS del sidecar crece monotonicamente durante un live
    # de 6h porque el GC generacional default solo corre cuando llena
    # thresholds internos — en bursts de likes (50-200/seg) los objetos
    # transitorios se acumulan más rápido de lo que el GC libera.
    async def _idle_gc_scheduler() -> None:
        import gc as _gc
        # Esperar 60s post-boot antes del primer ciclo (no interferir
        # con el calentamiento inicial de imports/pygame/TikTokLive).
        await asyncio.sleep(60)
        while True:
            try:
                tiktok_svc = getattr(registry, "tiktok_svc", None)
                connected = bool(getattr(tiktok_svc, "_connected", False)) if tiktok_svc else False
                if connected:
                    # Live activo: solo gen=0 (rápido, libera objetos jóvenes).
                    _gc.collect(0)
                    sleep_s = 180  # cada 3 min
                else:
                    # Idle: full collect (gen=2, libera todo).
                    _gc.collect()
                    sleep_s = 120  # cada 2 min
            except Exception:
                sleep_s = 180
            await asyncio.sleep(sleep_s)

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
    # MARU-HEALTH-INTEGRATION: cancelar loop del healthcheck en shutdown
    # para no dejarlo corriendo huérfano.
    if health_svc is not None:
        await health_svc.stop()
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
