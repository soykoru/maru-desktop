"""Adapter `simulator.*` — inyecta eventos como si vinieran de TikTok real.

Cada simulador hace 2 cosas:
  1. Publica `tiktok:event` al bus → llega al RuleDispatcher + ChatDispatcher
     (matchea reglas, ejecuta comandos sociales/IA/spotify/fortuna).
  2. Publica `log:entry` via LogsService → el LogPanel muestra el evento
     con el MISMO formato emoji que el worker real (paridad
     `core/tiktok_client.py:_emit_log_for_event`).

Sin (2), los eventos simulados no eran visibles en el log porque el
worker real no está corriendo cuando simulás (y los eventos del worker
real son los únicos que el frontend agrega al log automáticamente).
"""

from __future__ import annotations

import time
from typing import Any

from ..event_bus import get_event_bus
from ..logger import get_logger

log = get_logger(__name__)


def _emit(
    event_type: str,
    user: str,
    data: dict[str, Any],
    *,
    target_game: str | None = None,
    user_ranks: dict[str, Any] | None = None,
) -> None:
    bus = get_event_bus()
    payload: dict[str, Any] = {
        "type": event_type,
        "user": user,
        "nickname": user,
        "avatar": None,
        "timestamp": int(time.time() * 1000),
        "data": data,
    }
    if target_game:
        payload["targetGameId"] = target_game
    if user_ranks:
        # Propagar rangos al payload Y emitir comment-enriched para que
        # ChatDispatcher pueda dar prioridad/privilegios.
        payload["user_ranks"] = user_ranks
        bus.publish("tiktok:comment-enriched", {"user": user, **user_ranks})
    bus.publish("tiktok:event", payload)


def _ranks(params: dict[str, Any]) -> dict[str, Any]:
    """Extrae flags de rango de usuario del simulador."""
    ranks: dict[str, Any] = {}
    if params.get("isSuperFan") or params.get("is_super_fan"):
        ranks["is_super_fan"] = True
    if params.get("isModerator") or params.get("is_moderator"):
        ranks["is_moderator"] = True
    if params.get("isTopGifter") or params.get("is_top_gifter"):
        ranks["is_top_gifter"] = True
    ml = params.get("memberLevel") or params.get("member_level")
    if isinstance(ml, (int, str)) and str(ml).strip():
        try:
            ranks["member_level"] = int(ml)
        except (TypeError, ValueError):
            pass
    gl = params.get("gifterLevel") or params.get("gifter_level")
    if isinstance(gl, (int, str)) and str(gl).strip():
        try:
            ranks["gifter_level"] = int(gl)
        except (TypeError, ValueError):
            pass
    if params.get("isFollower") or params.get("is_follower"):
        ranks["is_follower"] = True
    return ranks


def _target(params: dict[str, Any]) -> str | None:
    g = params.get("gameId") or params.get("targetGameId")
    if isinstance(g, str) and g.strip():
        return g.strip()
    return None


_LOG_CAT_BY_TYPE = {
    "gift": "gift",
    "follow": "follow",
    "share": "share",
    "like": "like",
    "comment": "comment",
    "command": "command",
    "subscribe": "subscribe",
    "emote": "emote",
}


class SimulatorService:
    """Servicio del simulador. Si recibe `LogsService` via attach_logs,
    cada evento simulado genera un log entry visible en el panel."""

    def __init__(self) -> None:
        self._logs: Any = None

    def attach_logs(self, logs: Any) -> None:
        self._logs = logs

    def _log_event(
        self, message: str, evt_type: str, extra: dict[str, Any] | None = None
    ) -> None:
        if self._logs is None:
            return
        try:
            self._logs.publish(
                message,
                level="INFO",
                source="simulator",
                category=_LOG_CAT_BY_TYPE.get(evt_type, "tiktok"),
                meta=extra,
            )
        except Exception:
            pass
    def gift(self, params: dict[str, Any]) -> dict[str, Any]:
        user = str(params.get("user") or "tester")
        gift_name = str(params.get("giftName") or "rosa")
        diamonds = int(params.get("diamonds") or 1)
        count = int(params.get("count") or 1)
        _emit(
            "gift",
            user,
            {
                "giftName": gift_name,
                "gift_name": gift_name,
                "diamondCount": diamonds,
                "count": count,
                "totalDiamonds": diamonds * count,
            },
            target_game=_target(params),
        )
        cnt = f" ×{count}" if count > 1 else ""
        dia = f" 💎{diamonds * count}" if diamonds > 0 else ""
        self._log_event(
            f"🎁 @{user} envió: {gift_name}{cnt}{dia}",
            "gift",
            {"gift": gift_name, "count": count, "diamonds": diamonds * count},
        )
        return {"ok": True}

    def like(self, params: dict[str, Any]) -> dict[str, Any]:
        user = str(params.get("user") or "tester")
        count = int(params.get("count") or 1)
        _emit("like", user, {"count": count}, target_game=_target(params))
        self._log_event(
            f"❤️ @{user} dio {count} {'likes' if count > 1 else 'like'}",
            "like",
            {"count": count},
        )
        return {"ok": True}

    def follow(self, params: dict[str, Any]) -> dict[str, Any]:
        user = str(params.get("user") or "tester")
        _emit("follow", user, {}, target_game=_target(params))
        self._log_event(f"➕ @{user} siguió el live", "follow")
        return {"ok": True}

    def share(self, params: dict[str, Any]) -> dict[str, Any]:
        user = str(params.get("user") or "tester")
        _emit("share", user, {}, target_game=_target(params))
        self._log_event(f"📤 @{user} compartió el live", "share")
        return {"ok": True}

    def subscribe(self, params: dict[str, Any]) -> dict[str, Any]:
        user = str(params.get("user") or "tester")
        _emit("subscribe", user, {}, target_game=_target(params))
        self._log_event(f"⭐ @{user} se suscribió (Super Fan)", "subscribe")
        return {"ok": True}

    def comment(self, params: dict[str, Any]) -> dict[str, Any]:
        user = str(params.get("user") or "tester")
        text = str(params.get("text") or "hola")
        ranks = _ranks(params)
        _emit(
            "comment",
            user,
            {"text": text, "comment": text, **ranks},
            target_game=_target(params),
            user_ranks=ranks if ranks else None,
        )
        rank_label = self._rank_label(ranks)
        self._log_event(
            f"💬 {rank_label}@{user}: {text}", "comment", {"text": text, **ranks}
        )
        return {"ok": True}

    def command(self, params: dict[str, Any]) -> dict[str, Any]:
        user = str(params.get("user") or "tester")
        cmd = str(params.get("command") or "ia")
        args = str(params.get("args") or "")
        full_text = f"!{cmd} {args}".strip()
        ranks = _ranks(params)
        _emit(
            "command",
            user,
            {"command": cmd, "args": args, "text": full_text, **ranks},
            target_game=_target(params),
            user_ranks=ranks if ranks else None,
        )
        rank_label = self._rank_label(ranks)
        self._log_event(
            f"⌨️ {rank_label}@{user} usó comando: {full_text}",
            "command",
            {"command": cmd, "args": args, **ranks},
        )
        return {"ok": True}

    @staticmethod
    def _rank_label(ranks: dict[str, Any]) -> str:
        """Prefijo visual para identificar rango en el log."""
        badges = []
        if ranks.get("is_super_fan"):
            badges.append("⭐SF")
        if ranks.get("is_moderator"):
            badges.append("🛡️MOD")
        if ranks.get("is_top_gifter"):
            badges.append("🏆TOP")
        if ranks.get("is_follower"):
            badges.append("➕FOL")
        ml = ranks.get("member_level")
        if ml:
            badges.append(f"L{ml}")
        return f"[{' '.join(badges)}] " if badges else ""
