"""Registry de métodos JSON-RPC.

Mantiene contrato 1:1 con `packages/shared/src/rpc/methods.ts`. La construcción
del registry default se separa en `build_default_registry()` que cablea todos
los servicios reales.
"""

from __future__ import annotations

import enum
import inspect
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

Handler = Callable[[dict[str, Any]], "Awaitable[Any] | Any"]

# Referencia global al TikTokService — se setea durante register_all.
# SocialService la consume para preguntar `is_super_fan` en vivo sin
# necesidad de inyectarlo en su constructor.
_GLOBAL_TIKTOK_SVC: Any = None
_GLOBAL_SOCIAL_SVC: Any = None


class RpcErrorCode(enum.IntEnum):
    PARSE_ERROR = -32700
    INVALID_REQUEST = -32600
    METHOD_NOT_FOUND = -32601
    INVALID_PARAMS = -32602
    INTERNAL_ERROR = -32603
    SIDECAR_DISCONNECTED = -32000
    TIKTOK_NOT_CONNECTED = -32001
    GAME_NOT_CONFIGURED = -32002
    BACKUP_NOT_FOUND = -32003


@dataclass(frozen=True)
class RpcError(Exception):
    code: RpcErrorCode
    message: str
    data: Any = None

    def __str__(self) -> str:  # pragma: no cover
        return f"RpcError({self.code.name}, {self.message!r})"


class MethodRegistry:
    def __init__(self) -> None:
        self._methods: dict[str, Handler] = {}

    def register(self, name: str, handler: Handler) -> None:
        if name in self._methods:
            raise ValueError(f"method already registered: {name}")
        self._methods[name] = handler

    def has(self, name: str) -> bool:
        return name in self._methods

    def list_names(self) -> list[str]:
        return sorted(self._methods.keys())

    async def dispatch(self, name: str, params: dict[str, Any]) -> Any:
        handler = self._methods.get(name)
        if handler is None:
            raise RpcError(RpcErrorCode.METHOD_NOT_FOUND, f"method not found: {name}")
        try:
            result = handler(params)
            if inspect.isawaitable(result):
                result = await result
            return result
        except RpcError:
            raise
        except (TypeError, ValueError) as exc:
            raise RpcError(RpcErrorCode.INVALID_PARAMS, str(exc)) from exc
        except FileNotFoundError as exc:
            raise RpcError(RpcErrorCode.BACKUP_NOT_FOUND, str(exc)) from exc
        except Exception as exc:
            raise RpcError(RpcErrorCode.INTERNAL_ERROR, str(exc)) from exc


def build_default_registry() -> MethodRegistry:
    """Construye el registry con todos los servicios reales de F4."""
    from ..backend.data_catalog import DataService
    from ..backend.donations import DonationsService
    from ..backend.fortunes import FortunesService
    from ..backend.games import GamesService
    from ..backend.games_doc import GamesDocService
    # MARU-HEALTH-INTEGRATION (1/3): import del healthcheck.
    # Reversibilidad: borrar este import + las 2 secciones marcadas en
    # este archivo + el archivo `backend/health_service.py` la app vuelve
    # al estado pre-healthcheck.
    from ..backend.health_service import HealthCheckService
    from ..backend.ia import IaService
    from ..backend.images import ImagesService
    from ..backend.logs import LogsService, install_logs_bridge
    from ..backend.metrics import MetricsService
    from ..backend.migrations import MigrationService
    # MARU-OVERLAYS-INTEGRATION (1/3): import del relay v2 aislado.
    # Reversibilidad: borrando este import + las 2 secciones marcadas en
    # este archivo + el archivo `backend/overlays_relay.py` la app vuelve
    # al estado pre-overlays.
    from ..backend.overlays_relay import OverlaysRelayService
    from ..backend.chat_dispatcher import ChatDispatcher
    from ..backend.emotes import EmotesService
    from ..backend.profiles import ProfilesService
    from ..backend.rule_boosts import RuleBoostsService
    from ..backend.rule_dispatcher import RuleDispatcher
    from ..backend.rules import RulesService
    from ..backend.top_lives import TopLivesService
    from ..backend.settings import SettingsService
    from ..backend.simulator import SimulatorService
    from ..backend.social import SocialService
    from ..backend.sounds import SoundsService
    from ..backend.spotify import SpotifyService
    from ..backend.system import SystemService
    from ..backend.tiktok import TikTokService
    from ..backend.tts import TtsService

    # CRÍTICO v1.0.60: instalar `core_bridge` AQUÍ (main thread del proceso),
    # antes de que cualquier RPC handler pueda dispararse. El bridge importa
    # `from PyQt6.QtCore import pyqtSignal` y SUBCLASEA `QObject` con
    # metaclass de Qt, lo cual SOLO se permite desde el main thread del
    # proceso. Cuando `spotify.connect` se hizo `async + asyncio.to_thread`,
    # el primer `_ensure_client()` empezó a correr en un thread del executor
    # → si era el primer caller del bridge, llamaba a Qt desde un thread no-main
    # → PyQt6 corrompía estado interno (Qt metaclass + signals) → el sidecar
    # quedaba inconsistente → el renderer perdía RPC → pantalla negra.
    # Fix raíz: instalar el bridge AQUÍ una sola vez en main thread; los
    # `core_bridge.install()` lazy de cada servicio quedan como no-op
    # idempotentes (gated por `_INSTALLED`).
    try:
        from .. import core_bridge
        core_bridge.install()
    except Exception:
        # Tolerante: si por algún motivo el bridge falla acá, los servicios
        # pueden caer al `core no disponible` con sus mensajes esperables.
        # Pero NO permitimos que Qt se inicialice en un thread.
        import logging as _log
        _log.getLogger(__name__).exception(
            "core_bridge.install eager falló — Qt patches pueden quedar sin instalar"
        )

    reg = MethodRegistry()

    sys_svc = SystemService()
    metrics_svc = MetricsService()
    migration_svc = MigrationService()
    tiktok_svc = TikTokService()
    simulator_svc = SimulatorService()
    donations_svc = DonationsService()
    rules_svc = RulesService()
    data_svc = DataService()
    games_svc = GamesService()
    # v1.0.71: documentación maestra de juegos (sección 13 del MD se
    # inyecta dinámicamente con los juegos cargados).
    games_doc_svc = GamesDocService()
    games_doc_svc.attach_games(games_svc)
    # Cableo overlays↔games al final (después de instanciar overlays_svc).
    social_svc = SocialService()
    spotify_svc = SpotifyService()
    ia_svc = IaService()
    tts_svc = TtsService()
    # MARU-OVERLAYS-INTEGRATION (2/3): instanciación del relay.
    overlays_svc = OverlaysRelayService()
    # Inyectar games_svc para que el tracker del taps pueda disparar
    # acciones al cumplir meta (spawn/give_item/trigger_event).
    profiles_svc = ProfilesService()
    settings_svc = SettingsService()
    logs_svc = LogsService()
    install_logs_bridge(logs_svc)
    images_svc = ImagesService()
    sounds_svc = SoundsService()
    # Logs cableado para que cada sound.play emita un log:entry
    # category=sound (visible en LogPanel + agrupable como likes/gifts).
    sounds_svc.attach_logs(logs_svc)
    fortunes_svc = FortunesService(settings=settings_svc, tts=tts_svc)
    emotes_svc = EmotesService()
    emotes_svc.attach_sounds(sounds_svc)
    # Inyectar dependencias en TikTokService DESPUÉS de instanciar todos
    # los servicios que necesita (donations, logs, emotes).
    tiktok_svc.attach_donations(donations_svc)
    tiktok_svc.attach_logs(logs_svc)
    tiktok_svc.attach_emotes(emotes_svc)
    simulator_svc.attach_logs(logs_svc)

    # RuleBoostsService: panel externo de multiplicadores acumulables.
    # El RuleDispatcher consulta `boosts.compute_factor(rule_id, evt_data)`
    # antes de ejecutar acciones del juego para multiplicar `trigger_times`.
    rule_boosts_svc = RuleBoostsService()

    # RuleDispatcher: cablea tiktok:event → RuleEngine real → game.{spawn,
    # give_item, trigger_event}. Sin esto, las reglas nunca llegan al juego.
    rule_dispatcher = RuleDispatcher(games_svc)
    # Pasamos LogsService al dispatcher para que las publicaciones de
    # `✅ regla → acción · @user` pasen por dedupe + buffer (antes iban
    # directo a bus.publish, sin dedupe → 30 lineas idénticas cuando
    # múltiples reglas matcheaban el mismo trigger).
    rule_dispatcher.attach_logs(logs_svc)
    rule_dispatcher.attach_boosts(rule_boosts_svc)
    rules_svc.attach_dispatcher(rule_dispatcher)
    # v1.1.3: data → dispatcher para que mutar entries del catálogo
    # refresque el GameProfile del engine en memoria. Sin esto, juegos
    # HTTP que usan find_command(action_value→command) podían usar el
    # catálogo viejo cacheado tras un upsert/delete/import.
    data_svc.attach_dispatcher(rule_dispatcher)

    # MARU-HEALTH-INTEGRATION (2/3): instanciación del healthcheck.
    # Reusamos el `_read_active_game()` del dispatcher (cache TTL 1.5s)
    # para no duplicar I/O contra config.json.
    health_svc = HealthCheckService(games_svc)
    health_svc.attach_active_game_reader(rule_dispatcher._read_active_game)
    reg.health_svc = health_svc  # type: ignore[attr-defined]

    # v1.0.69: profiles → boosts. Cuando el user carga un profile, los
    # archivos en disco cambian (incluido `rule_boosts.json`); el doc en
    # memoria del RuleBoostsService debe recargarse para que los boosts
    # del profile recién cargado se apliquen al instante.
    profiles_svc.attach_boosts(rule_boosts_svc)
    # v1.1.2 — FIX RAÍZ: profiles → dispatcher para que el RuleEngine
    # recargue las reglas del juego cuando se carga un profile per-game.
    # Sin esto, el engine ve el profile anterior cacheado y "Probar"
    # devuelve 'regla no existe' aunque la UI las muestre.
    profiles_svc.attach_dispatcher(rule_dispatcher)

    # TopLivesService: tracking automático de likes por sesión + snapshot
    # del top 3 cuando el live termina. Listener en bus tiktok:status.
    top_lives_svc = TopLivesService()
    top_lives_svc.attach_social(social_svc)
    top_lives_svc.install()
    reg.rule_dispatcher = rule_dispatcher  # type: ignore[attr-defined]
    # Exponemos social_svc para que __main__.py pueda agendar los timers
    # de auto-rachas y cleanup-taps directamente sobre el servicio.
    reg.social_svc = social_svc  # type: ignore[attr-defined]

    # SocialSystem necesita TTS real para cantar resultados de duelos /
    # interacciones; antes recibía un callback no-op.
    social_svc.attach_tts(tts_svc)
    # LogsService → recibe los logs internos del SocialSystem (`🎵 !play`,
    # `⚔️ duelo`, etc.) y los envía al panel del frontend. Antes solo
    # iban al stderr de Python.
    social_svc.attach_logs(logs_svc)

    # Cablear SpotifyService ↔ SocialService (paridad `gui.py:9400`):
    #   - `social._sys.spotify` apunta al SpotifyClient real → `!play` y
    #     `!skip` funcionan vía `_cmd_music` con throttle/registro/TTS.
    #   - tras `spotify.connect`, SpotifyService llama a
    #     `social.refresh_spotify_link()` para activar la conexión.
    social_svc.attach_spotify(spotify_svc)
    spotify_svc.attach_social(social_svc)
    # TikTokService notifica a SpotifyService cada vez que un comment
    # trae el flag `is_super_fan` → la lista de PlayFan se mantiene
    # sincronizada en vivo con el rol real del live, sin gestión manual.
    tiktok_svc.attach_spotify(spotify_svc)
    # Expone tiktok_svc al módulo registry para que SocialService pueda
    # consultar el cache de rangos vivo (`_is_super_fan_now`) sin
    # romper su contrato de constructor.
    global _GLOBAL_TIKTOK_SVC, _GLOBAL_SOCIAL_SVC  # type: ignore[name-defined]
    _GLOBAL_TIKTOK_SVC = tiktok_svc  # type: ignore[name-defined]
    _GLOBAL_SOCIAL_SVC = social_svc  # type: ignore[name-defined]

    # Avatares persistentes del social: subscribe al bus de
    # comment-enriched. Cada vez que un viewer comenta/entra/dona, si
    # trae `avatar_url`, lo persistimos en data/social_avatars.json
    # (con debounce). Esos avatares se usan para pintar las tablas de
    # registrados / ranking / likes en el SocialDialog.
    try:
        from ..event_bus import get_event_bus
        _bus = get_event_bus()

        def _on_enriched_for_avatar(payload: dict[str, Any]) -> None:  # type: ignore[name-defined]
            try:
                user = payload.get("user") if isinstance(payload, dict) else None
                avatar_url = (
                    payload.get("avatar_url")
                    or payload.get("avatar")
                    if isinstance(payload, dict)
                    else None
                )
                if isinstance(user, str) and isinstance(avatar_url, str):
                    social_svc.remember_avatar(user, avatar_url)
            except Exception:
                pass

        _bus.subscribe("tiktok:comment-enriched", _on_enriched_for_avatar)
    except Exception:
        # No bloquear el bootstrap si el bus no está disponible.
        pass
    # Exponemos para los schedulers en __main__.py.
    reg.spotify_svc = spotify_svc  # type: ignore[attr-defined]

    # ChatDispatcher: cablea tiktok:event con type=comment/command/gift al
    # ecosistema de "valor" — !ia, !play, !skip, !suerte, comentarios libres
    # con TTS, y trigger de fortuna por gift. Sin esto el chat bot nunca
    # responde en vivo.
    chat_dispatcher = ChatDispatcher(
        social=social_svc,
        ia=ia_svc,
        spotify=spotify_svc,
        tts=tts_svc,
        fortunes=fortunes_svc,
        sounds=sounds_svc,
        donations=donations_svc,
        logs=logs_svc,
    )
    reg.chat_dispatcher = chat_dispatcher  # type: ignore[attr-defined]

    # system.*
    reg.register("system.ping", sys_svc.ping)
    reg.register("system.health", sys_svc.health)
    reg.register("system.metrics", metrics_svc.metrics)
    reg.register("system.shutdown", sys_svc.shutdown)
    reg.register("ping", sys_svc.ping)  # compat F0

    # tiktok.*
    reg.register("tiktok.connect", tiktok_svc.connect)
    reg.register("tiktok.disconnect", tiktok_svc.disconnect)
    reg.register("tiktok.status", tiktok_svc.status)
    reg.register("tiktok.sign-key.get", tiktok_svc.sign_key_get)
    reg.register("tiktok.sign-key.set", tiktok_svc.sign_key_set)

    # simulator.*
    reg.register("simulator.gift", simulator_svc.gift)
    reg.register("simulator.like", simulator_svc.like)
    reg.register("simulator.like-milestone", simulator_svc.like_milestone)
    reg.register("simulator.follow", simulator_svc.follow)
    reg.register("simulator.share", simulator_svc.share)
    reg.register("simulator.comment", simulator_svc.comment)
    reg.register("simulator.command", simulator_svc.command)
    reg.register("simulator.subscribe", simulator_svc.subscribe)
    reg.register("simulator.emote", simulator_svc.emote)
    reg.register("simulator.join", simulator_svc.join)

    # donations.*
    reg.register("donations.list", donations_svc.list)
    reg.register("donations.upsert", donations_svc.upsert)
    reg.register("donations.delete", donations_svc.delete)
    reg.register("donations.reset-counters", donations_svc.reset_counters)
    reg.register("donations.scan-folder", donations_svc.scan_folder)
    reg.register("donations.import-from-folder", donations_svc.import_from_folder)

    # rules.*
    reg.register("rules.list", rules_svc.list)
    reg.register("rules.upsert", rules_svc.upsert)
    reg.register("rules.delete", rules_svc.delete)
    reg.register("rules.toggle", rules_svc.toggle)
    reg.register("rules.reorder", rules_svc.reorder)
    reg.register("rules.duplicate", rules_svc.duplicate)
    reg.register("rules.test", rules_svc.test)
    reg.register("rules.validate-all", rules_svc.validate_all)

    # keyboard.* — acciones de teclado (v1.0.97+).
    # `keyboard.test` ejecuta la combinación AHORA mismo (saltándose el
    # toggle global, ya que el user explícitamente apretó "Probar").
    # v1.0.98+: el resultado SIEMPRE se publica al panel de logs para
    # que el user vea qué pasó sin necesidad de toast (mismo patrón
    # que rules.test). El user pidió: "que el log capture estas
    # acciones y muestre en el log cuando se envían".
    def _keyboard_test(params: dict) -> dict:
        keys = str(params.get("keys") or "")
        amount = int(params.get("amount") or 1)
        commands = str(params.get("commands") or "")
        # Bypass del toggle: el user explícitamente apretó probar.
        # Forzamos enabled=true en el cache temporal del service.
        import time as _t
        kb = rule_dispatcher._keyboard
        kb._enabled_cache = (_t.time(), True)
        ok, msg = kb.execute(keys, amount, commands, user="tester")
        # Publicar al panel de logs (visible en la UI) — INFO si OK,
        # ERROR si falló. `[PROBAR]` distingue del flow de eventos reales.
        try:
            log_msg = f"{'⌨️' if ok else '❌'} {msg} [PROBAR]"
            logs_svc.publish(
                log_msg,
                level="INFO" if ok else "ERROR",
                source="keyboard",
                category="rule",
                meta={
                    "keys": keys,
                    "amount": amount,
                    "commands": commands,
                    "trigger": "manual_test",
                    "success": bool(ok),
                },
                skip_dedupe=True,
            )
        except Exception:
            log.exception("keyboard.test: no pude publicar log:entry")
        return {"ok": bool(ok), "message": msg}

    reg.register("keyboard.test", _keyboard_test)

    # data.*
    reg.register("data.list", data_svc.list)
    reg.register("data.upsert", data_svc.upsert)
    reg.register("data.delete", data_svc.delete)
    reg.register("data.bulk-delete", data_svc.bulk_delete)
    reg.register("data.import", data_svc.import_)
    # profile cover RPCs (v1.0.94+)
    reg.register("data.export", data_svc.export)
    reg.register("data.all-categories", data_svc.all_categories)
    reg.register("data.tutorial", data_svc.tutorial)

    # games.*
    reg.register("games.list", games_svc.list)
    reg.register("games.configure", games_svc.configure)
    reg.register("games.update", games_svc.update)
    reg.register("games.create-custom", games_svc.create_custom)
    reg.register("games.duplicate", games_svc.duplicate)
    reg.register("games.delete-custom", games_svc.delete_custom)
    reg.register("games.test", games_svc.test)
    reg.register("games.spawn", games_svc.spawn)
    reg.register("games.give-item", games_svc.give_item)
    reg.register("games.trigger-event", games_svc.trigger_event)
    # v1.0.71: documentación maestra de juegos (descarga MD).
    reg.register("games-doc.get", games_doc_svc.get)
    # MARU-HEALTH-INTEGRATION (3/3): RPC para snapshot inicial al abrir UI.
    # El push periódico va por EventBus → `game:health`.
    reg.register("games.health.snapshot", health_svc.snapshot)

    # social.*
    reg.register("social.command", social_svc.command)
    reg.register("social.config.get", social_svc.config_get)
    reg.register("social.config.set", social_svc.config_set)
    reg.register("social.commands.meta", social_svc.commands_meta)
    reg.register("social.users.list", social_svc.users_list)
    reg.register("social.users.get", social_svc.users_get)
    reg.register("social.users.register", social_svc.users_register)
    reg.register("social.users.unregister", social_svc.users_unregister)
    reg.register("social.users.delete", social_svc.users_delete)
    reg.register("social.users.set-racha", social_svc.users_set_racha)
    reg.register("social.users.reset-racha", social_svc.users_reset_racha)
    reg.register("social.users.reset-relaciones", social_svc.users_reset_relaciones)
    reg.register("social.users.remove-marriage", social_svc.users_remove_marriage)
    reg.register("social.users.remove-relationship", social_svc.users_remove_relationship)
    reg.register("social.users.activate-auto-racha", social_svc.users_activate_auto_racha)
    reg.register("social.users.deactivate-auto-racha", social_svc.users_deactivate_auto_racha)
    reg.register("social.stats", social_svc.stats)
    reg.register("social.taps.top", social_svc.taps_top)
    reg.register("social.taps.cleanup", social_svc.taps_cleanup)
    reg.register("social.reset-all", social_svc.reset_all)

    # spotify.*
    reg.register("spotify.status", spotify_svc.status)
    reg.register("spotify.now-playing", spotify_svc.now_playing)
    reg.register("spotify.play-request", spotify_svc.play_request)
    reg.register("spotify.skip", spotify_svc.skip)
    reg.register("spotify.toggle-playback", spotify_svc.toggle_playback)
    reg.register("spotify.connect", spotify_svc.connect)
    reg.register("spotify.disconnect", spotify_svc.disconnect)
    reg.register("spotify.queue.list", spotify_svc.queue_list)
    reg.register("spotify.queue.clear", spotify_svc.queue_clear)
    reg.register("spotify.queue.remove", spotify_svc.queue_remove)
    reg.register("spotify.devices", spotify_svc.devices)
    reg.register("spotify.accounts.list", spotify_svc.accounts_list)
    reg.register("spotify.accounts.save", spotify_svc.accounts_save)
    reg.register("spotify.accounts.load", spotify_svc.accounts_load)
    reg.register("spotify.accounts.delete", spotify_svc.accounts_delete)
    reg.register("spotify.config.get", spotify_svc.config_get)
    reg.register("spotify.config.set", spotify_svc.config_set)
    reg.register("spotify.priority-user.set", spotify_svc.priority_user_set)
    reg.register("spotify.priority-user.remove", spotify_svc.priority_user_remove)
    # Super fans (sync auto desde TikTok is_super_fan).
    reg.register("spotify.super-fans.list", spotify_svc.super_fans_list)
    reg.register("spotify.super-fans.set-uses", spotify_svc.super_fan_set_uses)
    reg.register("spotify.super-fans.remove", spotify_svc.super_fan_remove)
    reg.register("spotify.playfan-default.set", spotify_svc.playfan_default_set)

    # ia.*
    reg.register("ia.status", ia_svc.status)
    reg.register("ia.ask", ia_svc.ask)
    reg.register("ia.config.get", ia_svc.config_get)
    reg.register("ia.config.set", ia_svc.config_set)
    reg.register("ia.providers-meta", ia_svc.providers_meta)
    reg.register("ia.context.get", ia_svc.context_get)
    reg.register("ia.context.set", ia_svc.context_set)
    reg.register("ia.test", ia_svc.test)

    # tts.*
    reg.register("tts.speak", tts_svc.speak)
    reg.register("tts.stop", tts_svc.stop)
    reg.register("tts.queue-sizes", tts_svc.queue_sizes)
    reg.register("tts.list-voices", tts_svc.list_voices)
    reg.register("tts.config.get", tts_svc.config_get)
    reg.register("tts.config.set", tts_svc.config_set)
    reg.register("tts.user-voices.list", tts_svc.user_voices_list)
    reg.register("tts.user-voices.upsert", tts_svc.user_voices_upsert)
    reg.register("tts.user-voices.delete", tts_svc.user_voices_delete)
    reg.register("tts.user-voices.clear", tts_svc.user_voices_clear)
    reg.register("tts.test", tts_svc.test)
    reg.register("tts.clear-cache", tts_svc.clear_cache)

    # MARU-OVERLAYS-INTEGRATION (3/3): registro de RPCs del relay v2.
    # Pass-through al Cloudflare Worker; cero storage local de configs.
    reg.register("overlays.list", overlays_svc.list)
    reg.register("overlays.get-config", overlays_svc.get_config)
    reg.register("overlays.set-config", overlays_svc.set_config)
    reg.register("overlays.test-event", overlays_svc.test_event)
    reg.register("overlays.reload", overlays_svc.reload)
    reg.register("overlays.identity-get", overlays_svc.identity_get)
    reg.register("overlays.identity-set", overlays_svc.identity_set)
    reg.register("overlays.timer-control", overlays_svc.timer_control)
    reg.register("overlays.timer-state", overlays_svc.timer_state)
    reg.register("overlays.music-state", overlays_svc.music_state)
    # v1.0.69: master switch para apagar todos los loops + uplink WS
    # cuando el user no usa overlays. Ahorra ~25-40MB de RAM.
    reg.register("overlays.set-enabled", overlays_svc.set_enabled)
    # Inyectar games_svc al overlays para acciones al cumplir meta.
    overlays_svc.attach_games(games_svc)
    # Inyectar donations_svc para resolver coins de gifts en el extensible.
    overlays_svc.attach_donations(donations_svc)
    # Inyectar spotify_svc para overlay music.
    overlays_svc.attach_spotify(spotify_svc)
    # Exponer social_svc global para que overlay relay haga toplikes.
    import maru_sidecar.rpc.registry as _self_mod  # type: ignore
    _self_mod._GLOBAL_SOCIAL_SVC = social_svc
    _self_mod._GLOBAL_TOPLIVES_SVC = top_lives_svc
    # El relay también expone su propio servicio para que `__main__.py`
    # pueda llamar `install(loop)` cuando arranque el event loop.
    reg.overlays_svc = overlays_svc  # type: ignore[attr-defined]

    # profiles.*
    reg.register("profiles.list", profiles_svc.list)
    reg.register("profiles.save", profiles_svc.save)
    reg.register("profiles.load", profiles_svc.load)
    reg.register("profiles.duplicate", profiles_svc.duplicate)
    reg.register("profiles.rename", profiles_svc.rename)
    reg.register("profiles.delete", profiles_svc.delete)
    reg.register("profiles.export", profiles_svc.export)
    reg.register("profiles.import", profiles_svc.import_)
    # v1.0.94+: portadas custom de perfiles (drag-drop + file picker).
    reg.register("profiles.set-cover", profiles_svc.set_cover)
    reg.register("profiles.delete-cover", profiles_svc.delete_cover)
    # v1.0.95+: actualizar perfil existente sin crear duplicado.
    reg.register("profiles.update", profiles_svc.update)

    # settings.* + backups.*
    reg.register("settings.get", settings_svc.get)
    reg.register("settings.set", settings_svc.set)
    reg.register("backups.list", settings_svc.backups_list)
    reg.register("backups.create", settings_svc.backups_create)
    reg.register("backups.restore", settings_svc.backups_restore)
    reg.register("backups.delete", settings_svc.backups_delete)
    reg.register("backups.last", settings_svc.backups_last)

    # logs.*
    reg.register("logs.tail", logs_svc.tail)
    reg.register("logs.list", logs_svc.list)
    reg.register("logs.stats", logs_svc.stats)
    reg.register("logs.clear", logs_svc.clear)
    reg.register("logs.reset-stats", logs_svc.reset_stats)
    reg.register("logs.categories", logs_svc.categories)
    reg.register("logs.hydrate-from-file", logs_svc.hydrate_from_file)

    # migrations.*
    reg.register("migrations.status", migration_svc.status)
    reg.register("migrations.apply", migration_svc.apply)

    # images.* — sistema de imágenes G2.
    # Wrappers que extraen params del dict (los services aceptan kwargs).
    reg.register(
        "images.lookup-entity",
        lambda p: images_svc.lookup_entity(
            p.get("gameId", ""), p.get("category", ""), p.get("entry", "")
        ),
    )
    reg.register(
        "images.lookup-gift",
        lambda p: images_svc.lookup_gift(p.get("giftId", "")),
    )
    reg.register(
        "images.lookup-trigger",
        lambda p: images_svc.lookup_trigger(p.get("triggerType", "")),
    )
    reg.register(
        "images.get-default",
        lambda p: images_svc.get_default(
            p.get("gameId", ""), p.get("category", "")
        ),
    )
    reg.register("images.stats", lambda _p: images_svc.stats())
    reg.register("images.rebuild", lambda _p: images_svc.rebuild())
    reg.register("images.set-entry-image", images_svc.set_entry_image)
    reg.register("images.delete-entry-image", images_svc.delete_entry_image)
    # v1.0.74: portadas custom de juegos (galería visual).
    reg.register("images.set-game-cover", images_svc.set_game_cover)
    reg.register("images.delete-game-cover", images_svc.delete_game_cover)
    # v1.0.82: imagen default por categoría de juego custom.
    reg.register("images.set-category-default", images_svc.set_category_default)
    reg.register("images.delete-category-default", images_svc.delete_category_default)

    # sounds.* (G10)
    reg.register("sounds.list", sounds_svc.list)
    reg.register("sounds.library.add", sounds_svc.library_add)
    reg.register("sounds.library.remove", sounds_svc.library_remove)
    reg.register("sounds.assign-gift", sounds_svc.assign_gift)
    reg.register("sounds.assign-event", sounds_svc.assign_event)
    reg.register("sounds.set-volume", sounds_svc.set_volume)
    reg.register("sounds.resolve-path", sounds_svc.resolve_path)
    reg.register("sounds.play", sounds_svc.play)
    reg.register("sounds.stop-all", sounds_svc.stop_all)
    # Scope manual del perfil de sonidos (independiente del juego activo).
    reg.register("sounds.scope.get", sounds_svc.scope_get)
    reg.register("sounds.scope.set", sounds_svc.scope_set)

    # fortunes.* — sistema de Fortuna/Suerte
    reg.register("fortunes.config.get", fortunes_svc.config_get)
    reg.register("fortunes.config.set", fortunes_svc.config_set)
    reg.register("fortunes.list-categories", fortunes_svc.list_categories)
    reg.register("fortunes.read", fortunes_svc.read)
    reg.register("fortunes.test", fortunes_svc.test)

    # boosts.* — multiplicadores externos acumulables (v1.0.54).
    reg.register("boosts.list", rule_boosts_svc.list)
    reg.register("boosts.upsert", rule_boosts_svc.upsert)
    reg.register("boosts.delete", rule_boosts_svc.delete)
    reg.register("boosts.replace-all", rule_boosts_svc.replace_all)

    # top-lives.* — histórico top 3 likes por sesión (v1.0.56).
    reg.register("top-lives.list", top_lives_svc.list)
    reg.register("top-lives.user-counts", top_lives_svc.user_counts)
    reg.register("top-lives.force-snapshot", top_lives_svc.force_snapshot)
    reg.register("top-lives.delete", top_lives_svc.delete)
    reg.register("top-lives.set-max", top_lives_svc.set_max_lives)
    reg.register("top-lives.clear", top_lives_svc.clear)

    # emotes.* — galería de emotes/stickers por streamer (multi-account).
    reg.register("emotes.list-streamers", emotes_svc.list_streamers)
    reg.register("emotes.list", emotes_svc.list)
    reg.register("emotes.assign-sound", emotes_svc.assign_sound)
    reg.register("emotes.preview-sound", emotes_svc.preview_sound)
    reg.register("emotes.delete", emotes_svc.delete)
    reg.register("emotes.delete-streamer", emotes_svc.delete_streamer)
    reg.register("emotes.set-streamer-avatar", emotes_svc.set_streamer_avatar)
    reg.register("emotes.refresh-avatar", emotes_svc.refresh_avatar)

    return reg
