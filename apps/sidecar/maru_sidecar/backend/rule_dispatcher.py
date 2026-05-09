"""Dispatcher que conecta `tiktok:event` del EventBus con el `RuleEngine`
real del MARU original.

Esto cierra el bug donde los eventos llegaban al frontend pero nadie
disparaba acciones contra los juegos (HTTP/RCON). Reutiliza
`core/rule_engine.py:RuleEngine` para tener paridad exacta con el original
(matching, cooldown, allowed_users, multi-acción, modo aleatorio,
contadores de likes y milestones).

Flujo:
  bus.publish("tiktok:event", payload)
    → RuleDispatcher._on_event(payload)
    → engine.process_event(active_game, type, data)
    → game.spawn / give_item / trigger_event  (HTTP/RCON real)
    → bus.publish("rules:executed", {...})    (UI muestra resultado)

El `active_game` se lee de `data/config.json:activeGame` (lo escribe el
frontend cuando el usuario cambia de juego en el sidebar).
"""

from __future__ import annotations

import asyncio
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from ..event_bus import get_event_bus
from ..logger import get_logger
from ..runtime import DATA_DIR
from .games import GamesService
from .keyboard import KeyboardService

log = get_logger(__name__)

# 16 workers — suficiente para bursts típicos de TikTok live (varios likes/
# gifts/comments por segundo) sin que se acumulen en cola y se vea delay.
_executor = ThreadPoolExecutor(max_workers=16, thread_name_prefix="rules-dispatch")


class _GamesAdapter:
    """Adaptador `Dict[str, BaseGame]`-like para el RuleEngine original.

    El `RuleEngine` original itera `self.games.get(game_id)` para obtener
    una instancia con métodos `spawn / give_item / trigger_event`. Acá
    redirigimos al `GamesService.get_instance(gid)` para reutilizar las
    mismas instancias (mismo pool HTTP, misma config viva).
    """

    def __init__(self, games_svc: GamesService) -> None:
        self._svc = games_svc

    def get(self, gid: str) -> Any:
        return self._svc.get_instance(gid)

    def __getitem__(self, gid: str) -> Any:
        inst = self._svc.get_instance(gid)
        if inst is None:
            raise KeyError(gid)
        return inst

    def __contains__(self, gid: str) -> bool:
        return self._svc.get_instance(gid) is not None


class RuleDispatcher:
    """Cablea `tiktok:event` → RuleEngine.process_event → game ejecuta."""

    def __init__(self, games_svc: GamesService) -> None:
        self._games_svc = games_svc
        self._engine: Any | None = None
        self._engine_lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._installed = False
        # Cache del activeGame con TTL corto — leer disco en cada evento
        # introducía 1-3ms de latencia en bursts. El frontend escribe una
        # vez al cambiar de juego, así que un cache de 1.5s es seguro.
        self._active_game_cache: tuple[float, str | None] = (0.0, None)
        self._active_game_ttl = 1.5
        # v1.0.98: Lock para el cache. Sin esto, múltiples eventos TikTok
        # concurrentes (likes/comments en burst) podían leer la tupla
        # `(ts, value)` a mitad de un reemplazo desde otro thread →
        # TypeError silencioso o valor stale impredecible.
        self._active_game_lock = threading.Lock()
        # LogsService — opcional. Si está, las publicaciones pasan por
        # dedupe + buffer en vez de ir directo al bus.
        self._logs: Any | None = None
        # RuleBoostsService — multiplicadores externos acumulables.
        self._boosts: Any | None = None
        # KeyboardService — acciones de teclado (action_type='keyboard').
        # Se inyecta al RuleEngine en `_get_engine`. Lazy-init: pynput
        # se importa al primer press, no en construcción.
        self._keyboard = KeyboardService()

    def attach_logs(self, logs: Any) -> None:
        self._logs = logs
        self._keyboard._logs = logs  # propagar al KeyboardService para logs uniformes

    def attach_boosts(self, boosts: Any) -> None:
        """Wirea el servicio de boosts. El engine, una vez inicializado,
        recibe un wrapper de `_role_multiplier` que multiplica por el
        factor combinado de boosts aplicables al rule_id + user."""
        self._boosts = boosts
        # Si el engine ya está construido, parchear ahora.
        if self._engine is not None:
            self._patch_engine_boosts()

    # ── Setup ────────────────────────────────────────────────────────────

    def install(self, loop: asyncio.AbstractEventLoop) -> None:
        """Suscribe al bus. Llamar una vez al arrancar el server."""
        if self._installed:
            return
        self._loop = loop
        bus = get_event_bus()
        bus.subscribe("tiktok:event", self._on_event)
        self._installed = True
        log.info("RuleDispatcher: suscrito a tiktok:event")

    def refresh_profile(self, game_id: str) -> None:
        """Recarga las reglas de `game_id` desde disco al engine en memoria.

        Sin esto, una regla recién creada via RulesService.upsert no aparece
        en el engine hasta reiniciar el sidecar — y al hacer "Probar"
        devuelve "regla no existe" aunque esté persistida.
        """
        engine = self._get_engine()
        if engine is None:
            return
        try:
            # Forzar recarga: el GameProfile del engine relee `rules_<gid>.json`
            # cuando se llama load(). Crear el profile fresco evita estado stale.
            from core.rule_engine import GameProfile  # type: ignore
            engine.profiles[game_id] = GameProfile(game_id, DATA_DIR)
        except Exception:
            log.exception("refresh_profile %s falló", game_id)

    def refresh_all_profiles(self) -> None:
        """v1.1.2: recarga TODOS los profiles cacheados en el engine.

        Usado tras `profiles.load` en modo legacy (snapshot completo),
        donde puede haber cambiado `rules_<gid>.json` para múltiples
        juegos. Sin esto, el engine ve las reglas del profile anterior
        para todos los juegos hasta reiniciar el sidecar.
        """
        engine = self._get_engine()
        if engine is None:
            return
        try:
            from core.rule_engine import GameProfile  # type: ignore
            # Iteramos sobre los game_ids ya cargados — son los únicos
            # que pueden estar stale. Profiles nuevos no necesitan
            # refresh, se crean al primer process_event.
            for gid in list(engine.profiles.keys()):
                try:
                    engine.profiles[gid] = GameProfile(gid, DATA_DIR)
                except Exception:
                    log.exception("refresh_all_profiles: %s falló", gid)
            log.info("refresh_all_profiles: recargados %d juegos", len(engine.profiles))
        except Exception:
            log.exception("refresh_all_profiles falló")

    # ── Engine lazy-init (necesita core_bridge) ──────────────────────────

    def _get_engine(self) -> Any | None:
        with self._engine_lock:
            if self._engine is not None:
                return self._engine
            try:
                from .. import core_bridge
                core_bridge.install()
                from core.rule_engine import RuleEngine  # type: ignore
            except Exception as exc:
                log.warning("core.rule_engine no disponible: %s", exc)
                return None
            try:
                games_adapter = _GamesAdapter(self._games_svc)
                self._engine = RuleEngine(
                    DATA_DIR,
                    games_adapter,
                    tts=None,
                    keyboard=self._keyboard,
                )
            except Exception as exc:
                log.exception("no pude construir RuleEngine: %s", exc)
                return None
            log.info("RuleDispatcher: RuleEngine inicializado")
            # Si los boosts ya estaban attachados antes del lazy-init,
            # parchear el engine ahora para que aplique multiplicadores.
            self._patch_engine_boosts()
            return self._engine

    def _patch_engine_boosts(self) -> None:
        """Envuelve `engine._role_multiplier` para que también multiplique
        por el factor de boosts externos. Idempotente — no envuelve dos
        veces. Si el user borra todos los boosts en runtime, el wrapper
        sigue activo pero `compute_factor` devuelve 1, transparente."""
        if self._engine is None or self._boosts is None:
            return
        if getattr(self._engine, "_maru_boosts_patched", False):
            return
        original = self._engine._role_multiplier
        boosts = self._boosts
        # Capturamos el logs service en la closure: cada vez que un boost
        # externo aplica multiplicador > 1 emitimos una línea visible en
        # el panel. Esto da feedback claro tanto en LIVE REAL como en el
        # SIMULADOR (sin esto, el user no tenía forma de saber si el
        # boost matcheó o no — sólo veía el conteo final de ejecuciones
        # y tenía que adivinar el factor).
        logs_svc = self._logs

        def patched_role_multiplier(rule: Any, data: dict[str, Any]) -> int:
            base = 1
            try:
                base = int(original(rule, data) or 1)
            except Exception:
                base = 1
            if base < 1:
                base = 1
            try:
                rid = str(getattr(rule, "id", "") or "")
                ext = int(boosts.compute_factor(rid, data) or 1)
            except Exception:
                ext = 1
            if ext < 1:
                ext = 1
            total = base * ext
            # Hard ceiling (paridad con `MAX_FACTOR` interno de boosts).
            if total > 100:
                total = 100
            # Log de feedback cuando boost externo matcheó (ext > 1).
            # `skip_dedupe=False` adrede: si 30 likes seguidos del mismo
            # super fan disparan la misma regla, queremos colapsar el
            # spam — el LogsService dedupe baja a 1 línea cada 2s con
            # contador "(x30)" automático. Eso es exactamente lo que el
            # user quiere ver: "🚀 Boost x3 — Spawn troll (x30)".
            if ext > 1 and logs_svc is not None:
                try:
                    rname = str(getattr(rule, "name", "") or rid or "?")
                    user = str(data.get("user") or "?")
                    msg = (
                        f"🚀 Boost x{ext} aplicado a «{rname}» · "
                        f"@{user} (factor total x{total})"
                    )
                    logs_svc.publish(
                        msg,
                        level="INFO",
                        source="boosts",
                        category="rule",
                        meta={
                            "rule": rname,
                            "rule_id": rid,
                            "boost_factor": ext,
                            "total_factor": total,
                            "user": user,
                        },
                    )
                except Exception:
                    pass
            return total

        self._engine._role_multiplier = patched_role_multiplier  # type: ignore[method-assign]
        self._engine._maru_boosts_patched = True
        log.info("RuleEngine._role_multiplier extendido con boosts externos")

    # ── Bus callback ─────────────────────────────────────────────────────

    def _build_event_info(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Aplana payload + ranks de `tiktok:event` para que las reglas
        puedan filtrar por rol via `required_ranks`/`excluded_ranks`.

        El payload trae `data.<rank_flag>` (porque core_bridge mete los
        ranks en `data`). Y también `user` en top-level."""
        data = dict(payload.get("data") or {})
        info = dict(data)  # copia
        info["user"] = payload.get("user") or data.get("user") or ""
        return info

    def _on_event(self, payload: dict[str, Any]) -> None:
        """Llamado en el loop del sidecar.

        Para latencia mínima (paridad MARU PyQt monolítico), ejecutamos
        `engine.process_event` INLINE en el listener — sin hop al
        ThreadPoolExecutor. El engine es O(N reglas) en memoria y el
        `game.spawn` interno hace `EX.submit` (fire-and-forget que retorna
        inmediato). El gasto total es <1ms para 50 reglas.

        Si en el futuro process_event hace IO bloqueante grande, mover
        SOLO ese paso al executor; el matching/find_command es rápido
        y debe quedar inline.
        """
        if self._loop is None:
            return
        evt_type = payload.get("type") or ""
        if not evt_type:
            return
        user = payload.get("user") or ""
        evt_data = dict(payload.get("data") or {})
        evt_data.setdefault("user", user)

        target = payload.get("targetGameId")
        if isinstance(target, str) and target.strip():
            active_game = target.strip()
        else:
            active_game = self._read_active_game()

        if not active_game:
            log.debug("dispatch skipped: no hay activeGame configurado — "
                      "usuario debe seleccionar juego en sidebar primero")
            return

        # Setear el contexto de rangos para que `Rule.can_trigger` (parchado)
        # pueda filtrar por `required_ranks`/`excluded_ranks`.
        from .. import core_bridge
        info = self._build_event_info(payload)
        token = core_bridge.set_current_event_info(info)
        try:
            self._dispatch_sync(active_game, evt_type, evt_data)
        finally:
            core_bridge.reset_current_event_info(token)

    # ── Lógica sincrónica (corre en thread pool) ─────────────────────────

    def _dispatch_sync(self, game_id: str, evt_type: str, evt_data: dict[str, Any]) -> None:
        engine = self._get_engine()
        if engine is None:
            return

        # Master switch — si gamesEnabled es false en config.json, NO
        # ejecutamos las acciones contra los juegos. Solo loguear que se
        # bloqueó la ejecución SI HAY al menos una regla habilitada que
        # hubiera matcheado ese trigger. Sin esto, cada evento (join,
        # like, comment) generaba un "🔴 Juegos OFF" inútil aunque no
        # hubiera ninguna regla configurada para ese trigger en el juego
        # activo (caso reportado por el user con join en Valheim sin
        # regla join configurada).
        if not self._read_games_enabled():
            if not self._has_rules_for_trigger(game_id, evt_type):
                # No hay reglas para ese trigger → silencio (no era info útil).
                return
            try:
                user = str(evt_data.get("user") or "?")
                msg = f"🔴 Juegos OFF · {evt_type} de @{user} (no se envió al juego)"
                if self._logs is not None:
                    # Pasa por dedupe → si llegan 30 likes seguidos del
                    # mismo user con master switch off, solo se loguea 1
                    # cada 2s (la dedupe de LogsService).
                    self._logs.publish(
                        msg,
                        level="INFO",
                        source="rules",
                        category="rule",
                        meta={"masterSwitch": False, "trigger": evt_type, "user": user},
                    )
                else:
                    bus = get_event_bus()
                    import time as _t
                    bus.publish(
                        "log:entry",
                        {
                            "id": f"ms-{int(_t.time() * 1000)}",
                            "ts": int(_t.time() * 1000),
                            "level": "INFO",
                            "source": "rules",
                            "category": "rule",
                            "message": msg,
                            "meta": {"masterSwitch": False, "trigger": evt_type, "user": user},
                        },
                    )
            except Exception:
                pass
            return

        try:
            engine.ensure_profile(game_id)
        except Exception:
            log.exception("ensure_profile falló para %s", game_id)
        try:
            results = engine.process_event(game_id, evt_type, evt_data)
        except Exception:
            log.exception("process_event falló (%s/%s)", game_id, evt_type)
            return
        if not results:
            return
        bus = get_event_bus()
        # Describir los rangos del user que disparó (para que el log panel
        # muestre "@user (🌸 miembro L2) → regla X" — feedback claro).
        try:
            from .. import core_bridge
            user_ranks = core_bridge.describe_user_ranks(evt_data)
        except Exception:
            user_ranks = ""
        for res in results:
            try:
                bus.publish(
                    "rules:executed",
                    {
                        "gameId": game_id,
                        "ruleName": res.get("rule") or "",
                        "action": res.get("action") or "",
                        "message": res.get("message") or "",
                        "success": bool(res.get("success")),
                        "trigger": evt_type,
                        "user": evt_data.get("user") or "",
                        "userRanks": user_ranks,
                    },
                )
            except Exception:
                log.exception("no pude publicar rules:executed")
            # Log entry para el panel UI — vía LogsService.publish para
            # que pase por el dedupe (mismo mensaje en <2s se colapsa).
            # Antes iba directo a bus.publish y cuando 15 reglas matchean
            # un mismo `like` event con misma acción, salían 15 lineas
            # idénticas en el panel sin filtro posible.
            try:
                ok = bool(res.get("success"))
                rule_name = str(res.get("rule") or "?")
                action_ = str(res.get("action") or "")
                message = str(res.get("message") or "")
                user = str(evt_data.get("user") or "")
                user_tag = f" · @{user}" if user else ""
                ranks_tag = f" ({user_ranks})" if user_ranks else ""
                full_msg = f"{'✅' if ok else '❌'} {rule_name} ({action_}) → {message}{user_tag}{ranks_tag}"
                meta_obj = {
                    "rule": rule_name,
                    "gameId": game_id,
                    "trigger": evt_type,
                    "user": user,
                    "success": ok,
                }
                if self._logs is not None:
                    # skip_dedupe=True: cada ejecución de regla debe
                    # aparecer como entry separado en el log (caso real:
                    # streak de 10 rosas → 10 spawns de slime → user
                    # quiere ver 10 lineas, no 1 colapsado por dedupe).
                    self._logs.publish(
                        full_msg,
                        level="INFO" if ok else "ERROR",
                        source="rules",
                        category="rule",
                        meta=meta_obj,
                        skip_dedupe=True,
                    )
                else:
                    bus.publish(
                        "log:entry",
                        {
                            "id": f"rx-{int(__import__('time').time() * 1000)}-{rule_name[:6]}",
                            "ts": int(__import__('time').time() * 1000),
                            "level": "INFO" if ok else "ERROR",
                            "source": "rules",
                            "category": "rule",
                            "message": full_msg,
                            "meta": meta_obj,
                        },
                    )
            except Exception:
                log.exception("no pude publicar log:entry de rules")

    # ── Test directo de una regla (botón Probar) ─────────────────────────

    def execute_rule_now(
        self,
        game_id: str,
        rule_id: str,
        user: str = "tester",
    ) -> dict[str, Any]:
        """Ejecuta TODAS las acciones de una regla específica contra el juego
        real, ignorando trigger / cooldown / allowed_users.

        Usado por `rules.test` para que el botón "Probar" haga lo mismo que
        un trigger real (en vez del dry-run textual anterior).

        v1.0.96+: TODOS los caminos de error se loguean al panel via
        `_logs.publish` para que el user pueda ver qué falló sin necesidad
        de toast en la UI. El user pidió:
        "no me gusta que salga esa ventana para eso tengo el log".
        """
        def _log_test_error(reason: str) -> None:
            """Helper: publica un log entry para errores tempranos del Probar
            (perfil/regla/juego no existe, engine caído). Sin esto el user
            presionaba Probar y no pasaba nada visible — silencio total."""
            if self._logs is None:
                return
            try:
                self._logs.publish(
                    f"❌ Probar regla {rule_id!r} en {game_id!r} → {reason} [PROBAR]",
                    level="ERROR",
                    source="rules",
                    category="rule",
                    meta={
                        "rule": rule_id,
                        "gameId": game_id,
                        "trigger": "manual_test",
                        "user": user,
                        "success": False,
                    },
                    skip_dedupe=True,
                )
            except Exception:
                log.exception("no pude publicar log:entry (test error)")

        engine = self._get_engine()
        if engine is None:
            _log_test_error("core.rule_engine no disponible")
            return {
                "ok": False,
                "messages": ["core.rule_engine no disponible"],
            }
        try:
            engine.ensure_profile(game_id)
        except Exception as exc:
            _log_test_error(f"ensure_profile: {exc}")
            return {"ok": False, "messages": [f"ensure_profile: {exc}"]}

        profile = engine.get_profile(game_id)
        if profile is None:
            _log_test_error(f"perfil {game_id!r} no existe")
            return {"ok": False, "messages": [f"perfil {game_id!r} no existe"]}

        rule = next((r for r in profile.rules if r.id == rule_id), None)
        if rule is None:
            _log_test_error(f"regla {rule_id!r} no existe")
            return {"ok": False, "messages": [f"regla {rule_id!r} no existe"]}

        game = self._games_svc.get_instance(game_id)
        if game is None:
            _log_test_error(
                f"juego {game_id!r} no instanciable — verifica conexión"
            )
            return {
                "ok": False,
                "messages": [
                    f"juego {game_id!r} no instanciable — verifica conexión",
                ],
            }

        # Ejecutar saltándose cooldown/allowed_users (botón Probar es manual).
        original_last_used = rule.last_used
        original_allowed = list(rule.allowed_users)
        rule.last_used = 0
        rule.allowed_users = []
        try:
            res = engine._execute(game, profile, rule, {"user": user, "count": 1})
        except Exception as exc:
            log.exception("execute_rule_now falló: %s", exc)
            _log_test_error(f"excepción en _execute: {exc}")
            return {"ok": False, "messages": [f"error: {exc}"]}
        finally:
            rule.last_used = original_last_used
            rule.allowed_users = original_allowed

        if not res:
            _log_test_error("sin resultado del rule engine")
            return {"ok": False, "messages": ["sin resultado"]}

        ok = bool(res.get("success"))
        msg = str(res.get("message") or "")
        # Partir mensaje multi-acción (" | " separator del rule_engine).
        messages = [m.strip() for m in msg.split(" | ") if m.strip()] or [msg]

        # Publicar al bus para que la UI vea el resultado en tiempo real.
        try:
            bus = get_event_bus()
            bus.publish(
                "rules:executed",
                {
                    "gameId": game_id,
                    "ruleName": res.get("rule") or rule.name,
                    "action": res.get("action") or "",
                    "message": msg,
                    "success": ok,
                    "trigger": "manual_test",
                    "user": user,
                },
            )
        except Exception:
            log.exception("no pude publicar rules:executed (test)")

        # v1.0.94+: bug raíz del user — al probar una regla no aparecía
        # entry en el log panel SOLO cuando el RCON tenía éxito (cuando
        # fallaba sí aparecía porque el `log.error` de games.py llegaba
        # via el logger normal). El método de eventos reales (`_on_event`)
        # YA hacía `self._logs.publish(...)` después de cada ejecución;
        # `execute_rule_now` no lo hacía. Acá replicamos el mismo formato.
        try:
            rule_name = res.get("rule") or rule.name
            action_ = res.get("action") or ""
            user_tag = f" · @{user}" if user else ""
            full_msg = (
                f"{'✅' if ok else '❌'} {rule_name} ({action_}) → {msg}{user_tag}"
                f" [PROBAR]"
            )
            meta_obj = {
                "rule": rule_name,
                "gameId": game_id,
                "trigger": "manual_test",
                "user": user,
                "success": ok,
            }
            if self._logs is not None:
                self._logs.publish(
                    full_msg,
                    level="INFO" if ok else "ERROR",
                    source="rules",
                    category="rule",
                    meta=meta_obj,
                    skip_dedupe=True,
                )
        except Exception:
            log.exception("no pude publicar log:entry (test)")

        return {"ok": ok, "messages": messages}

    # ── Helpers ──────────────────────────────────────────────────────────

    def _has_rules_for_trigger(self, game_id: str, evt_type: str) -> bool:
        """¿Hay al menos una regla habilitada con `trigger_type=evt_type`
        en el perfil del juego? Usado por el master-switch-off log para
        no spamear "🔴 Juegos OFF" en eventos sin reglas asociadas."""
        engine = self._engine
        if engine is None:
            return False
        try:
            profile = engine.profiles.get(game_id)
            if profile is None:
                return False
            for r in getattr(profile, "rules", []) or []:
                if not getattr(r, "enabled", True):
                    continue
                if str(getattr(r, "trigger_type", "")) == evt_type:
                    return True
        except Exception:
            return False
        return False

    def _read_games_enabled(self) -> bool:
        """Lee `gamesEnabled` del config.json. Default: true.

        v1.0.98: el SettingsService usa write atómico (temp+rename) así
        que un read concurrente NO ve JSON corrupto — ve el estado
        antes o después del rename, nunca un mix. Sin embargo, si por
        cualquier razón el archivo sí estuviera corrupto, antes
        retornábamos True silenciosamente (= juegos ON) — peligroso
        porque el user podría haber configurado OFF y el sidecar
        ignorarlo. Ahora logueamos el problema."""
        path = DATA_DIR / "config.json"
        if not path.exists():
            return True
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                v = data.get("gamesEnabled")
                # Default true si no existe la key — comportamiento previo.
                if v is None:
                    return True
                # Aceptar bool real o strings "true"/"false" del frontend.
                if isinstance(v, bool):
                    return v
                if isinstance(v, str):
                    s = v.strip().lower()
                    if s in ("false", "0", "off", "no"):
                        return False
                    if s in ("true", "1", "on", "yes"):
                        return True
                return bool(v)
        except (json.JSONDecodeError, OSError) as exc:
            log.warning(
                "config.json no parseable en _read_games_enabled (%s) — "
                "asumiendo gamesEnabled=true (default seguro)",
                exc,
            )
        return True

    def _read_active_game(self) -> str | None:
        """Lee `activeGame` o `current_game` desde `data/config.json` con
        cache TTL para no pegarle al disco en cada evento.

        v1.0.98: protegido con `_active_game_lock` — el cache es leído/
        escrito desde el listener de eventos, que puede correr concurrente
        si llegan likes/comments en burst.
        """
        import time as _time
        now = _time.time()
        # Fast path: lectura del cache bajo lock.
        with self._active_game_lock:
            ts, cached = self._active_game_cache
            if cached is not None and (now - ts) < self._active_game_ttl:
                return cached
        # Cache miss: leer disco fuera del lock (I/O lento) y luego
        # actualizar bajo lock. Doble-lectura no es problema — la
        # ventana de discrepancia es <1ms y el config.json no cambia
        # 100 veces por segundo.
        path = DATA_DIR / "config.json"
        result: str | None = None
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    for key in ("activeGame", "current_game"):
                        gid = data.get(key)
                        if isinstance(gid, str) and gid.strip():
                            result = gid.strip()
                            break
            except (json.JSONDecodeError, OSError):
                # Posible carrera con el frontend escribiendo el JSON.
                # No hace falta lock acá — al miss del cache simplemente
                # devolvemos el valor anterior cacheado o None. El próximo
                # tick (1.5s) reintentará.
                pass
        with self._active_game_lock:
            self._active_game_cache = (now, result)
        return result
