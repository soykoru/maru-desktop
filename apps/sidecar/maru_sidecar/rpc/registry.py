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
    from ..backend.ia import IaService
    from ..backend.images import ImagesService
    from ..backend.logs import LogsService, install_logs_bridge
    from ..backend.metrics import MetricsService
    from ..backend.migrations import MigrationService
    from ..backend.minigames import MinigamesService
    from ..backend.overlays import OverlaysService
    from ..backend.chat_dispatcher import ChatDispatcher
    from ..backend.emotes import EmotesService
    from ..backend.profiles import ProfilesService
    from ..backend.rule_dispatcher import RuleDispatcher
    from ..backend.rules import RulesService
    from ..backend.settings import SettingsService
    from ..backend.simulator import SimulatorService
    from ..backend.social import SocialService
    from ..backend.sounds import SoundsService
    from ..backend.spotify import SpotifyService
    from ..backend.system import SystemService
    from ..backend.tiktok import TikTokService
    from ..backend.tts import TtsService

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
    social_svc = SocialService()
    spotify_svc = SpotifyService()
    ia_svc = IaService()
    tts_svc = TtsService()
    overlays_svc = OverlaysService()
    profiles_svc = ProfilesService()
    settings_svc = SettingsService()
    logs_svc = LogsService()
    install_logs_bridge(logs_svc)
    images_svc = ImagesService()
    sounds_svc = SoundsService()
    minigames_svc = MinigamesService()
    fortunes_svc = FortunesService(settings=settings_svc, tts=tts_svc)
    emotes_svc = EmotesService()
    emotes_svc.attach_sounds(sounds_svc)
    # Inyectar dependencias en TikTokService DESPUÉS de instanciar todos
    # los servicios que necesita (donations, logs, emotes).
    tiktok_svc.attach_donations(donations_svc)
    tiktok_svc.attach_logs(logs_svc)
    tiktok_svc.attach_emotes(emotes_svc)
    simulator_svc.attach_logs(logs_svc)

    # RuleDispatcher: cablea tiktok:event → RuleEngine real → game.{spawn,
    # give_item, trigger_event}. Sin esto, las reglas nunca llegan al juego.
    rule_dispatcher = RuleDispatcher(games_svc)
    # Pasamos LogsService al dispatcher para que las publicaciones de
    # `✅ regla → acción · @user` pasen por dedupe + buffer (antes iban
    # directo a bus.publish, sin dedupe → 30 lineas idénticas cuando
    # múltiples reglas matcheaban el mismo trigger).
    rule_dispatcher.attach_logs(logs_svc)
    rules_svc.attach_dispatcher(rule_dispatcher)
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
    reg.register("simulator.follow", simulator_svc.follow)
    reg.register("simulator.share", simulator_svc.share)
    reg.register("simulator.comment", simulator_svc.comment)
    reg.register("simulator.command", simulator_svc.command)
    reg.register("simulator.subscribe", simulator_svc.subscribe)

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

    # data.*
    reg.register("data.list", data_svc.list)
    reg.register("data.upsert", data_svc.upsert)
    reg.register("data.delete", data_svc.delete)
    reg.register("data.import", data_svc.import_)
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

    # overlays.*
    reg.register("overlays.list", overlays_svc.list)
    reg.register("overlays.update", overlays_svc.update)
    reg.register("overlays.test-event", overlays_svc.test_event)

    # profiles.*
    reg.register("profiles.list", profiles_svc.list)
    reg.register("profiles.save", profiles_svc.save)
    reg.register("profiles.load", profiles_svc.load)
    reg.register("profiles.duplicate", profiles_svc.duplicate)
    reg.register("profiles.rename", profiles_svc.rename)
    reg.register("profiles.delete", profiles_svc.delete)
    reg.register("profiles.export", profiles_svc.export)
    reg.register("profiles.import", profiles_svc.import_)

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

    # sounds.* (G10)
    reg.register("sounds.list", sounds_svc.list)
    reg.register("sounds.library.add", sounds_svc.library_add)
    reg.register("sounds.library.remove", sounds_svc.library_remove)
    reg.register("sounds.assign-gift", sounds_svc.assign_gift)
    reg.register("sounds.assign-event", sounds_svc.assign_event)
    reg.register("sounds.set-volume", sounds_svc.set_volume)
    reg.register("sounds.resolve-path", sounds_svc.resolve_path)
    reg.register("sounds.stop-all", sounds_svc.stop_all)

    # fortunes.* — sistema de Fortuna/Suerte
    reg.register("fortunes.config.get", fortunes_svc.config_get)
    reg.register("fortunes.config.set", fortunes_svc.config_set)
    reg.register("fortunes.list-categories", fortunes_svc.list_categories)
    reg.register("fortunes.read", fortunes_svc.read)
    reg.register("fortunes.test", fortunes_svc.test)

    # emotes.* — galería de emotes/stickers por streamer (multi-account).
    reg.register("emotes.list-streamers", emotes_svc.list_streamers)
    reg.register("emotes.list", emotes_svc.list)
    reg.register("emotes.assign-sound", emotes_svc.assign_sound)
    reg.register("emotes.preview-sound", emotes_svc.preview_sound)
    reg.register("emotes.delete", emotes_svc.delete)
    reg.register("emotes.delete-streamer", emotes_svc.delete_streamer)
    reg.register("emotes.set-streamer-avatar", emotes_svc.set_streamer_avatar)
    reg.register("emotes.refresh-avatar", emotes_svc.refresh_avatar)

    # minigames.* (G10)
    reg.register("minigames.meta", minigames_svc.meta)
    reg.register("minigames.config.get", minigames_svc.config_get)
    reg.register("minigames.config.set", minigames_svc.config_set)
    reg.register("minigames.state", minigames_svc.state)
    reg.register("minigames.start", minigames_svc.start)
    reg.register("minigames.stop", minigames_svc.stop)

    return reg
