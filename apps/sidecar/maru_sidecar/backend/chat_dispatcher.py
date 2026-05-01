"""Dispatcher de eventos del chat → servicios de "valor" (IA, Social,
Spotify, Fortunas, TTS).

Cierra el bug donde `!ia`, `!play`, `!skip`, `!playfan`, `!suerte`,
comentarios libres, gifts disparadores de fortuna, etc. NUNCA se procesaban
en vivo en el sidecar nuevo. Solo se ejecutaban si la UI hacía RPC manual.

Replica el flujo del MARU original (`gui/main_window.py:1885-1908`):

  Evento `comment` con texto:
    ├── `!comando args` →
    │     1. Social.process_command (combat/relations/admin/utilities)
    │     2. Si es comando de música (!play, !skip, !pf, !playfan) →
    │        Spotify.play_request / skip
    │     3. Si es comando de IA (!ia, !pregunta, !chat) →
    │        IA.ask + TTS.speak (canal chat)
    │     4. Si es comando de fortuna (!suerte, !fortuna, !lectura) →
    │        Fortunes.read + TTS.speak (canal fortune)
    └── texto libre →
          TTS.speak (canal chat) si está habilitado

  Evento `gift`:
    └── Si gift_id == fortunes.config.gift_id →
          Fortunes.read + TTS.speak (canal fortune)

Ejecuta cada handler en ThreadPoolExecutor para no bloquear el loop del
sidecar — coincide con lo que hace RuleDispatcher para evitar contención.
"""

from __future__ import annotations

import asyncio
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from ..event_bus import get_event_bus
from ..logger import get_logger

log = get_logger(__name__)

_executor = ThreadPoolExecutor(max_workers=16, thread_name_prefix="chat-dispatch")

# Aliases de comandos por familia. El SocialSystem ya maneja la mayoría
# (combat, relations, admin, utilities), pero música, IA y fortuna no
# pasan por ahí — los routea este dispatcher.
_MUSIC_PLAY = {"play", "p", "pf", "playfan", "request", "música", "musica"}
_MUSIC_SKIP = {"skip", "s", "siguiente", "next"}
_MUSIC_PAUSE = {"pause", "pausar", "stop"}
_MUSIC_RESUME = {"resume", "reanudar", "continuar"}
_IA = {"ia", "ai", "pregunta", "ask", "chat", "preguntar", "bot"}
_FORTUNE = {"suerte", "fortuna", "lectura", "fortune", "tarot"}

_CMD_RE = re.compile(r"^[!/](\S+)\s*(.*)$")


class ChatDispatcher:
    """Cablea `tiktok:event` → IA / Spotify / Social / Fortunas / TTS."""

    def __init__(
        self,
        social: Any,
        ia: Any,
        spotify: Any,
        tts: Any,
        fortunes: Any,
        sounds: Any | None = None,
        donations: Any | None = None,
        logs: Any | None = None,
    ) -> None:
        self._social = social
        self._ia = ia
        self._spotify = spotify
        self._tts = tts
        self._fortunes = fortunes
        self._sounds = sounds
        self._donations = donations
        self._logs = logs
        self._loop: asyncio.AbstractEventLoop | None = None
        self._installed = False
        self._lock = threading.Lock()
        # Dedupe a nivel comando para cortar el doble-disparo del core:
        # `core/tiktok_client.py` emite DOS eventos por cada `!cmd` del live
        #   1) `comment` con el texto completo (`!racha`)
        #   2) `command` con el cmd parseado (`{"command": "racha"}`)
        # Sin dedupe, ChatDispatcher procesa AMBOS y cada comando social
        # (`!racha`, `!suerte`, `!ia`, etc.) ejecuta el handler 2 veces:
        # narración TTS + lógica del SocialSystem se duplican.
        # `!play` parecía ser inmune porque el cooldown interno de
        # `_cmd_music` silenciaba la 2ª ejecución; los demás comandos no
        # tienen cooldown propio. Comments LIBRES (sin `!`) tampoco
        # duplican porque solo se emite `comment`.
        # Ventana 2.5s: cubre el lapso entre el primer y segundo emit
        # (típicamente <50ms) con margen amplio para no descartar dos
        # comandos legítimos del mismo user (rate-limit típico TikTok
        # es 2-3s entre comments del mismo user).
        self._recent_cmds: dict[str, float] = {}
        self._recent_cmds_lock = threading.Lock()
        # Dedupe específica para fortuna disparada por GIFT. Cuando un
        # gift hace streak (`repeat_count=N`), el core emite N events
        # `gift` consecutivos → sin esto, leeríamos N fortunas. La
        # semántica esperada es 1 fortuna por user por evento de regalo
        # (la siguiente requiere otro regalo no inmediato).
        # Ventana 30s: cubre streaks típicos de un solo regalo ofrecido
        # múltiples veces con un toque + permite que el mismo user pida
        # otra fortuna con un nuevo gift después.
        self._recent_fortunes: dict[str, float] = {}
        self._recent_fortunes_lock = threading.Lock()

    def attach_logs(self, logs: Any) -> None:
        self._logs = logs

    def install(self, loop: asyncio.AbstractEventLoop) -> None:
        if self._installed:
            return
        self._loop = loop
        bus = get_event_bus()
        bus.subscribe("tiktok:event", self._on_event)
        self._installed = True
        log.info("ChatDispatcher: suscrito a tiktok:event")

    # ── Bus callback (loop) ──────────────────────────────────────────────

    def _on_event(self, payload: dict[str, Any]) -> None:
        """Latencia mínima — inline en el listener (sin hop al executor)."""
        if self._loop is None:
            return
        evt_type = (payload.get("type") or "").lower()
        if evt_type not in ("comment", "gift", "command", "follow", "share", "like"):
            return
        self._dispatch_sync(payload)

    def _dispatch_sync(self, payload: dict[str, Any]) -> None:
        try:
            evt_type = (payload.get("type") or "").lower()
            user = str(payload.get("user") or "?")
            data = payload.get("data") or {}
            if evt_type == "comment":
                self._handle_comment(user, data)
            elif evt_type == "command":
                # El simulador emite `command` directo (sin texto libre).
                cmd = str(data.get("command") or "").lower().strip()
                args = str(data.get("args") or "").strip()
                if cmd:
                    self._handle_command(user, cmd, args, data)
            elif evt_type == "gift":
                self._handle_gift(user, data)
            elif evt_type in ("follow", "share"):
                self._handle_simple_event(evt_type, user, data)
            elif evt_type == "like":
                self._handle_like(user, data)
        except Exception:
            log.exception("ChatDispatcher: dispatch failed")

    def _handle_like(self, user: str, data: dict[str, Any]) -> None:
        """Cuando llega un like, alimenta el contador de taps del SocialSystem
        (paridad MARU `main_window.py:1872-1876`). Sin esto !toptaps muestra
        siempre 0."""
        if self._social is None:
            return
        try:
            count = int(data.get("count") or 1)
        except (TypeError, ValueError):
            count = 1
        try:
            sys_inst = self._social._ensure() if hasattr(self._social, "_ensure") else None
            if sys_inst is not None and hasattr(sys_inst, "record_tap"):
                sys_inst.record_tap(user, count)
        except Exception:
            log.exception("social.record_tap fallo (user=%s)", user)

    def _handle_simple_event(
        self, evt_type: str, user: str, _data: dict[str, Any]
    ) -> None:
        """follow/share — reproduce sonido asignado server-side (paridad
        MARU original que tocaba un .wav configurado vía pygame)."""
        if self._sounds is None:
            return
        try:
            self._sounds.play_for_event(evt_type)
        except Exception:
            log.exception("sounds.play_for_event fallo (%s)", evt_type)

    # ── Handlers ─────────────────────────────────────────────────────────

    def _handle_comment(self, user: str, data: dict[str, Any]) -> None:
        text = str(data.get("text") or data.get("comment") or "").strip()
        # Si el comment trae el flag is_super_fan=True, dispara el sonido
        # de "superfan" configurado (paridad MARU original donde un super
        # fan que comenta sonaba una notificación distinta). Idempotente
        # por el mixer pygame; si no hay sonido asignado, no hace nada.
        if data.get("is_super_fan") and self._sounds is not None:
            try:
                self._sounds.play_for_event("superfan")
            except Exception:
                log.exception("sounds.play_for_event(superfan) fallo")
        if not text:
            return

        m = _CMD_RE.match(text)
        if m:
            cmd = m.group(1).lower().strip()
            args = m.group(2).strip()
            self._handle_command(user, cmd, args, data, raw_text=text)
            return

        # Texto libre → TTS chat (si habilitado en config del engine).
        self._speak_chat(text, user)

    def _is_duplicate_cmd(self, user: str, cmd: str, args: str) -> bool:
        """Atomic check + set para dedupear `(user, cmd, args)` en 2.5s.

        Devuelve True si es duplicado (= el caller debe SALTAR el handler).
        Hace garbage collection del dict si crece (>200 entries) para
        evitar leak en streams largos.
        """
        key = f"{user.lower()}::{cmd.lower()}::{args.lower()[:60]}"
        now = time.time()
        with self._recent_cmds_lock:
            last = self._recent_cmds.get(key)
            if last is not None and (now - last) < 2.5:
                return True
            self._recent_cmds[key] = now
            if len(self._recent_cmds) > 200:
                cutoff = now - 10.0
                self._recent_cmds = {
                    k: v for k, v in self._recent_cmds.items() if v >= cutoff
                }
        return False

    def _handle_command(
        self,
        user: str,
        cmd: str,
        args: str,
        data: dict[str, Any],
        raw_text: str | None = None,
    ) -> None:
        # Cortar doble-disparo del core (comment + command emit para el
        # mismo `!cmd`). Si ya procesamos este (user, cmd, args) en los
        # últimos 2.5s, salimos.
        if self._is_duplicate_cmd(user, cmd, args):
            return
        full_text = raw_text or (f"!{cmd} {args}".strip())

        # IA y fortuna NO viven en SocialSystem — los routea el dispatcher.
        # Música SÍ vive en SocialSystem._cmd_music (paridad `gui.py:9400`):
        # ahí están throttle/cooldown/registro/TTS-anuncio. Por eso `!play`,
        # `!skip`, etc. se delegan vía `social.command` con todo el flujo
        # original — incluido `_music_speak()` que anuncia el resultado.
        if cmd in _IA:
            _executor.submit(self._ia_ask, user, args)
            return
        if cmd in _FORTUNE:
            self._read_fortune(user)
            return

        # 2) Social — duelos, relaciones, admin, utilidades, MÚSICA, etc.
        # Música corre en executor para no bloquear (HTTP a Spotify ~1-3s).
        if cmd in _MUSIC_PLAY or cmd in _MUSIC_SKIP or cmd in _MUSIC_PAUSE or cmd in _MUSIC_RESUME:
            _executor.submit(self._social_command_async, user, cmd, full_text)
            return
        try:
            if self._social is not None:
                res = self._social.command({"user": user, "text": full_text})
                handled = bool(res.get("handled")) if isinstance(res, dict) else False
                # Log feedback visible en el panel — paridad MARU
                # `main_window.py:1905` que loguea cada cmd resuelto.
                self._log_command_result(user, cmd, full_text, handled)
        except Exception:
            log.exception("social.command falló (cmd=%s)", cmd)

    def _social_command_async(self, user: str, cmd: str, full_text: str) -> None:
        """Igual que el branch sync pero en executor — para !play/!skip etc."""
        try:
            if self._social is None:
                return
            res = self._social.command({"user": user, "text": full_text})
            handled = bool(res.get("handled")) if isinstance(res, dict) else False
            self._log_command_result(user, cmd, full_text, handled)
        except Exception:
            log.exception("social.command async falló (cmd=%s)", cmd)

    def _log_command_result(
        self, user: str, cmd: str, full_text: str, handled: bool
    ) -> None:
        """Loguea el resultado de un comando social al LogPanel para que
        el usuario vea qué pasó al simular o cuando llegan en vivo."""
        if self._logs is None:
            return
        try:
            self._logs.publish(
                (
                    f"✅ comando !{cmd} procesado por @{user}"
                    if handled
                    else f"⚠️ comando !{cmd} (@{user}) sin handler social"
                ),
                level="INFO" if handled else "WARNING",
                source="social",
                category="command",
                meta={"raw": full_text, "user": user},
            )
        except Exception:
            pass

    def _handle_gift(self, user: str, data: dict[str, Any]) -> None:
        gift_name = str(
            data.get("gift_name") or data.get("giftName") or data.get("gift_id") or ""
        ).strip()
        # 1) Sonido asignado al gift (paridad MARU pygame).
        if self._sounds is not None and gift_name:
            try:
                # Probar match exacto y lowercase (ids varían).
                if not self._sounds.play_for_gift(gift_name):
                    self._sounds.play_for_gift(gift_name.lower())
            except Exception:
                log.exception("sounds.play_for_gift fallo")
        # 2) Contador de gifts recibidos en sesión.
        if self._donations is not None and gift_name:
            try:
                count = int(data.get("count") or data.get("repeat_count") or 1)
                self._donations.increment_received(gift_name, count)
            except Exception:
                log.exception("donations.increment_received fallo")
        # 3) Trigger fortuna por gift configurado.
        try:
            if self._fortunes is None:
                return
            cfg = self._fortunes.config_get({}).get("config", {})
            if not cfg.get("enabled"):
                return
            target = str(cfg.get("gift_id") or "").strip().lower()
            if not target:
                return
            if gift_name and gift_name.lower() == target:
                self._read_fortune(user)
        except Exception:
            log.exception("gift→fortune trigger fallo")

    # ── Acciones ─────────────────────────────────────────────────────────

    def _ia_ask(self, user: str, question: str) -> None:
        if self._ia is None:
            return
        q = question.strip()
        if not q:
            q = f"Salúdame, soy {user}."
        try:
            res = self._ia.ask({"user": user, "question": q})
            if not res.get("ok"):
                log.info("IA falló: %s", res.get("answer"))
                return
            answer = str(res.get("answer") or "").strip()
            if answer:
                self._speak_chat(answer, user)
        except Exception:
            log.exception("ia.ask fallo")

    def _read_fortune(self, user: str) -> None:
        if self._fortunes is None:
            return
        # Dedupe per-user (30s) — atrapa el caso real reportado: una
        # donación que matchea con `fortunes.config.gift_id` dispara la
        # fortuna 2 veces (porque el core puede emitir múltiples events
        # `gift` por un solo streak / repeat_count, o por
        # races en el WS handler). Sin importar cuántos events lleguen
        # del MISMO user en 30s, la fortuna se lee una sola vez.
        # Si el username viene vacío o es "?" usamos un slot global
        # para no perder la dedupe (caso del simulator sin user real).
        key = (user or "").strip().lower() or "__anon__"
        now = time.time()
        with self._recent_fortunes_lock:
            last = self._recent_fortunes.get(key)
            if last is not None and (now - last) < 30.0:
                return
            self._recent_fortunes[key] = now
            if len(self._recent_fortunes) > 200:
                cutoff = now - 120.0
                self._recent_fortunes = {
                    k: v for k, v in self._recent_fortunes.items() if v >= cutoff
                }
        try:
            res = self._fortunes.read({"name": user})
            text = str(res.get("text") or "").strip()
            if not text:
                return
            cfg = self._fortunes.config_get({}).get("config", {})
            voice = cfg.get("voice")
            if self._tts is None:
                return
            self._tts.speak({
                "text": text,
                "channel": "fortune",
                "voice": voice,
                "user": user,
            })
        except Exception:
            log.exception("fortunes.read fallo")

    def _speak_chat(self, text: str, user: str) -> None:
        if self._tts is None:
            return
        try:
            self._tts.speak({"text": text, "channel": "chat", "user": user})
        except Exception:
            log.exception("tts chat fallo")
