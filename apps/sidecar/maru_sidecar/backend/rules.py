"""Adapter `rules.*` — CRUD de reglas por juego (G6).

Schema MARU real:
  Persistencia en `data/rules_<gameId>.json`:
    {
      "rules": [<Rule>, ...],
      "schemaVersion": 2,
      "updatedAt": <ms>
    }

Cada `Rule` (paridad MARU original `rule_dialog.py:get_rule`):
    {
      "id": str,
      "name": str,
      "enabled": bool,
      "trigger_type": str,        # gift|command|follow|share|subscribe|like|like_milestone
      "trigger_value": str,       # para gift: "rose"; like: "10"; milestone: "1000"
      "actions": [
        {
          "action_type": str,           # cat_id de GameProfile.categories[*].id
          "action_type_name": str,      # label visible
          "action_value": str,          # display_name de la entry
          "amount": int,                # 1..999_999
          "commands": str,              # multi-line para Minecraft / RCON
        },
        ...
      ],
      "random_action": bool,
      "cooldown": int,                  # segundos
      "tts_enabled": bool,
      "tts_message": str,
      "tts_voice": str,
      "allowed_users": [str, ...],      # lowercase
      # Compat (espejo de la PRIMERA acción — el RuleEngine viejo
      #         lee estos campos):
      "action_type": str,               # legacy: spawn|give_item|trigger_event|spawn_valuable
      "action_value": str,
      "amount": int,
      "commands": str,
    }

Migración auto desde el F0-F8 simplificado del repo nuevo:
    {trigger: {kind, ...}, actions: [{kind, ...}], randomPick: bool}

Mejoras sobre el original:
  - `gameId` arbitrario (multi-custom de G4).
  - 7 trigger types completos (paridad MARU).
  - Auto-migración del shape simplificado F0-F8 al verbose MARU.
  - Compat fields siempre sincronizados con `actions[0]` (los lee el
    RuleEngine real sin tener que re-mapear).
"""

from __future__ import annotations

import json
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from ..logger import get_logger
from ..runtime import DATA_DIR
from .backups import BackupService

log = get_logger(__name__)

SCHEMA_VERSION = 2

VALID_TRIGGERS: tuple[str, ...] = (
    "gift",
    "command",
    "follow",
    "share",
    "subscribe",
    "like",
    "like_milestone",
    # v1.0.48: nuevos triggers
    "emote",  # cuando llega un emote/sticker; trigger_value = emote_id
    "join",   # cuando un user entra al live; trigger_value = "" (cualquiera) o username
)

# Mapeo cat_id (G4 / MARU) → action_type legacy del RuleEngine.
ACTION_TYPE_LEGACY_MAP: dict[str, str] = {
    "entity": "spawn",
    "entities": "spawn",
    "item": "give_item",
    "items": "give_item",
    "event": "trigger_event",
    "events": "trigger_event",
    "valuable": "spawn_valuable",
    "valuables": "spawn_valuable",
}

_GID_RE = re.compile(r"^(?!\d+$)[a-zA-Z0-9_]{2,32}$")


def _validate_game(game_id: Any) -> str:
    if not isinstance(game_id, str):
        raise TypeError("gameId requerido")
    g = game_id.strip()
    if not _GID_RE.match(g):
        raise ValueError(f"gameId inválido: {game_id!r}")
    return g


def _coerce_action(raw: Any) -> dict[str, Any]:
    """Coerce una acción al shape MARU canónico.

    Acepta tanto el formato moderno F0-F8 (`{kind, entity?, item?, event?,
    text?, amount?}`) como el verbose MARU (`{action_type, action_value,
    amount, commands, action_type_name?}`).
    """
    if not isinstance(raw, dict):
        raise TypeError("action debe ser objeto")

    # Detectar formato F0-F8 (kind-based).
    if "kind" in raw and "action_type" not in raw:
        kind = raw.get("kind")
        if kind == "spawn":
            return {
                "action_type": "entity",
                "action_type_name": "🐉 Entidad",
                "action_value": str(raw.get("entity") or ""),
                "amount": int(raw.get("amount") or 1),
                "commands": "",
            }
        if kind == "give_item":
            return {
                "action_type": "item",
                "action_type_name": "📦 Item",
                "action_value": str(raw.get("item") or ""),
                "amount": int(raw.get("amount") or 1),
                "commands": "",
            }
        if kind == "trigger_event":
            return {
                "action_type": "event",
                "action_type_name": "⚡ Evento",
                "action_value": str(raw.get("event") or ""),
                "amount": 1,
                "commands": "",
            }
        if kind == "tts":
            # TTS no es action de juego — lo elevamos a tts_* del Rule.
            # Acá lo guardamos como acción "tts" para que la UI lo muestre,
            # pero lo ideal es mover a tts_message del Rule.
            return {
                "action_type": "tts",
                "action_type_name": "🔊 TTS",
                "action_value": str(raw.get("text") or ""),
                "amount": 1,
                "commands": "",
            }
        raise ValueError(f"action.kind desconocido: {kind!r}")

    # Shape MARU verbose.
    action_type = str(raw.get("action_type") or "").strip()
    if not action_type:
        raise ValueError("action.action_type requerido")
    return {
        "action_type": action_type,
        "action_type_name": str(raw.get("action_type_name") or action_type.title()),
        "action_value": str(raw.get("action_value") or "").strip(),
        "amount": max(1, min(999_999, int(raw.get("amount") or 1))),
        "commands": str(raw.get("commands") or ""),
    }


def _coerce_trigger(raw: Any) -> tuple[str, str]:
    """Devuelve (trigger_type, trigger_value) desde shape MARU o F0-F8."""
    if not isinstance(raw, dict):
        raise TypeError("trigger debe ser objeto")
    # Formato MARU: {trigger_type, trigger_value} ya está en raíz del rule
    # (este path no se usa para tomar el trigger del root, sino cuando
    # viene anidado como `trigger: {kind, ...}` del shape F0-F8).
    kind = raw.get("kind")
    if kind == "gift":
        return "gift", str(raw.get("giftName") or "").strip()
    if kind == "follow":
        return "follow", ""
    if kind == "share":
        return "share", ""
    if kind == "like":
        n = int(raw.get("minLikes") or 1)
        return "like", str(n)
    if kind == "comment":
        # comment no existe en MARU oficial, lo mapeamos a command.
        return "command", str(raw.get("pattern") or "").strip()
    if kind == "command":
        return "command", str(raw.get("name") or "").strip()
    raise ValueError(f"trigger.kind desconocido: {kind!r}")


def _validate_rule(rule: Any) -> dict[str, Any]:
    """Coerce/valida una regla al shape canónico MARU.

    - Acepta tanto el shape MARU (`trigger_type/trigger_value` planos) como
      el F0-F8 (`trigger: {kind, ...}` anidado).
    - Asigna id si falta.
    - Sincroniza compat fields (action_type/value/amount/commands) con
      actions[0].
    """
    if not isinstance(rule, dict):
        raise TypeError("rule debe ser objeto")

    rid = rule.get("id")
    if not isinstance(rid, str) or not rid.strip():
        rule["id"] = f"rule-{uuid.uuid4().hex[:10]}"

    if not isinstance(rule.get("name"), str) or not rule["name"].strip():
        rule["name"] = "Sin nombre"

    rule["enabled"] = bool(rule.get("enabled", True))

    # Trigger: aceptar plano o anidado.
    if "trigger_type" in rule:
        ttype = str(rule.get("trigger_type") or "").strip()
        tvalue = str(rule.get("trigger_value") or "").strip()
    elif "trigger" in rule and isinstance(rule.get("trigger"), dict):
        ttype, tvalue = _coerce_trigger(rule["trigger"])
    else:
        raise ValueError("rule.trigger_type o rule.trigger requerido")

    if ttype not in VALID_TRIGGERS:
        raise ValueError(f"trigger_type inválido: {ttype!r}")

    rule["trigger_type"] = ttype
    rule["trigger_value"] = tvalue
    rule.pop("trigger", None)  # limpiar el campo F0-F8 si vino

    # Actions: array obligatorio, no vacío.
    actions_raw = rule.get("actions")
    if not isinstance(actions_raw, list) or not actions_raw:
        raise ValueError("rule.actions debe ser lista no vacía")
    actions = [_coerce_action(a) for a in actions_raw]
    rule["actions"] = actions

    rule["random_action"] = bool(
        rule.get("random_action", rule.get("randomPick", False))
    )
    rule.pop("randomPick", None)

    rule["cooldown"] = max(0, min(3600, int(rule.get("cooldown") or 0)))

    rule["tts_enabled"] = bool(rule.get("tts_enabled", False))
    rule["tts_message"] = str(rule.get("tts_message") or "")
    rule["tts_voice"] = str(rule.get("tts_voice") or "es_mx_002")

    users = rule.get("allowed_users") or []
    if not isinstance(users, list):
        users = []
    rule["allowed_users"] = [
        str(u).strip().lower() for u in users if isinstance(u, str) and u.strip()
    ]

    # Filtrado por rol (paridad con el patch de Rule en core_bridge):
    # listas de flags como `is_super_fan`, `is_moderator`, etc. Vacío = sin filtro.
    _RANK_KEYS_ALLOWED = {
        "is_anchor", "is_moderator", "is_super_fan", "is_member",
        "is_top_gifter", "is_follower", "is_friend", "is_mutual_follow",
        "is_verified", "is_new_subscriber", "is_friends_badge",
        "is_first_recharge", "is_live_pro", "is_activity", "is_gift_giver",
    }
    for key in ("required_ranks", "excluded_ranks"):
        ranks = rule.get(key) or []
        if not isinstance(ranks, list):
            ranks = []
        rule[key] = [
            r for r in ranks
            if isinstance(r, str) and r in _RANK_KEYS_ALLOWED
        ]

    # Compat fields espejo de actions[0] — el RuleEngine viejo los lee.
    first = actions[0]
    legacy = ACTION_TYPE_LEGACY_MAP.get(first["action_type"], first["action_type"])
    rule["action_type"] = legacy
    rule["action_value"] = first["action_value"]
    rule["amount"] = first["amount"]
    rule["commands"] = first["commands"]

    return rule


# ── Service ──────────────────────────────────────────────────────────────


class RulesService:
    def __init__(
        self,
        data_dir: Path = DATA_DIR,
        backups: BackupService | None = None,
    ) -> None:
        self._data_dir = data_dir
        self._lock = threading.Lock()
        self._backups = backups or BackupService(data_dir=data_dir)
        self._dispatcher: Any | None = None
        data_dir.mkdir(parents=True, exist_ok=True)

    def attach_dispatcher(self, dispatcher: Any) -> None:
        """Conecta el RuleDispatcher para que `rules.test` ejecute de verdad
        contra el juego (en vez del dry-run textual anterior)."""
        self._dispatcher = dispatcher

    def _notify_engine(self, game_id: str) -> None:
        """Recarga el cache del RuleEngine después de mutar reglas en disco.

        Sin esto, una regla recién creada/editada/eliminada via RPC no se
        ve en el engine hasta reiniciar el sidecar — y al hacer "Probar"
        devuelve 'regla no existe'."""
        if self._dispatcher is None:
            return
        try:
            self._dispatcher.refresh_profile(game_id)
        except Exception as exc:
            log.warning("refresh_profile fallo: %s", exc)

    def _rules_path(self, game_id: str) -> Path:
        return self._data_dir / f"rules_{game_id}.json"

    # ── RPC handlers ─────────────────────────────────────────────────────

    def list(self, params: dict[str, Any]) -> dict[str, Any]:
        game_id = _validate_game(params.get("gameId"))
        return {"rules": self._read(game_id)}

    def upsert(self, params: dict[str, Any]) -> dict[str, Any]:
        game_id = _validate_game(params.get("gameId"))
        rule = _validate_rule(params.get("rule"))
        with self._lock:
            self._maybe_backup(game_id)
            rules = self._read(game_id)
            idx = next(
                (i for i, r in enumerate(rules) if r.get("id") == rule["id"]), -1
            )
            if idx >= 0:
                rules[idx] = rule
            else:
                rules.append(rule)
            self._write_atomic(game_id, rules)
        self._notify_engine(game_id)
        return {"rule": rule}

    def delete(self, params: dict[str, Any]) -> dict[str, Any]:
        game_id = _validate_game(params.get("gameId"))
        rule_id = params.get("ruleId")
        if not isinstance(rule_id, str):
            raise TypeError("ruleId requerido")
        with self._lock:
            self._maybe_backup(game_id)
            rules = [r for r in self._read(game_id) if r.get("id") != rule_id]
            self._write_atomic(game_id, rules)
        self._notify_engine(game_id)
        return {"ok": True}

    def toggle(self, params: dict[str, Any]) -> dict[str, Any]:
        game_id = _validate_game(params.get("gameId"))
        rule_id = params.get("ruleId")
        enabled = params.get("enabled")
        if not isinstance(rule_id, str):
            raise TypeError("ruleId requerido")
        if not isinstance(enabled, bool):
            raise TypeError("enabled debe ser bool")
        with self._lock:
            rules = self._read(game_id)
            changed = False
            for r in rules:
                if r.get("id") == rule_id:
                    r["enabled"] = enabled
                    changed = True
            if changed:
                self._write_atomic(game_id, rules)
        if changed:
            self._notify_engine(game_id)
        return {"ok": True}

    def reorder(self, params: dict[str, Any]) -> dict[str, Any]:
        game_id = _validate_game(params.get("gameId"))
        ids = params.get("orderedIds")
        if not isinstance(ids, list) or not all(isinstance(x, str) for x in ids):
            raise TypeError("orderedIds debe ser lista de strings")
        with self._lock:
            rules = self._read(game_id)
            by_id = {r.get("id"): r for r in rules}
            reordered = [by_id[i] for i in ids if i in by_id]
            for r in rules:
                if r.get("id") not in ids:
                    reordered.append(r)
            self._write_atomic(game_id, reordered)
        self._notify_engine(game_id)
        return {"ok": True}

    def duplicate(self, params: dict[str, Any]) -> dict[str, Any]:
        """Duplicar una regla — útil para clonar y modificar."""
        game_id = _validate_game(params.get("gameId"))
        rule_id = params.get("ruleId")
        if not isinstance(rule_id, str):
            raise TypeError("ruleId requerido")
        with self._lock:
            rules = self._read(game_id)
            src = next((r for r in rules if r.get("id") == rule_id), None)
            if src is None:
                raise ValueError(f"regla no existe: {rule_id!r}")
            import copy as _copy
            new = _copy.deepcopy(src)
            new["id"] = f"rule-{uuid.uuid4().hex[:10]}"
            new["name"] = f"{src.get('name', 'Sin nombre')} (copia)"
            self._maybe_backup(game_id)
            rules.append(new)
            self._write_atomic(game_id, rules)
        self._notify_engine(game_id)
        return {"rule": new}

    def test(self, params: dict[str, Any]) -> dict[str, Any]:
        """Ejecuta la regla DE VERDAD contra el juego activo.

        Si el RuleDispatcher está conectado (modo normal), llama
        `execute_rule_now` que dispara las acciones HTTP/RCON reales,
        ignorando cooldown / allowed_users (es un test manual). Si no
        hay dispatcher, fallback a un dry-run textual (debugging).
        """
        game_id = _validate_game(params.get("gameId"))
        rule_id = params.get("ruleId")
        if not isinstance(rule_id, str):
            raise TypeError("ruleId requerido")

        if self._dispatcher is not None:
            user = params.get("user")
            user_str = user if isinstance(user, str) and user.strip() else "tester"
            return self._dispatcher.execute_rule_now(game_id, rule_id, user_str)

        # Fallback dry-run (no debería pasar en prod).
        rules = self._read(game_id)
        rule = next((r for r in rules if r.get("id") == rule_id), None)
        if rule is None:
            return {"ok": False, "messages": [f"regla {rule_id!r} no encontrada"]}

        msgs: list[str] = []
        msgs.append("⚠️ dry-run (RuleDispatcher no disponible)")
        msgs.append(
            f"trigger: {rule.get('trigger_type')} = {rule.get('trigger_value') or '(sin valor)'}"
        )
        actions = rule.get("actions", [])
        msgs.append(f"acciones: {len(actions)}")
        for i, a in enumerate(actions, 1):
            cmd_preview = a.get("commands") or a.get("action_value") or ""
            cmd_preview = cmd_preview.replace("\n", " ⏎ ")[:60]
            msgs.append(
                f"  {i}. [{a.get('action_type')}] {a.get('action_value')} ×{a.get('amount')} → {cmd_preview}"
            )
        return {"ok": True, "messages": msgs}

    def validate_all(self, params: dict[str, Any]) -> dict[str, Any]:
        """Valida TODAS las reglas del juego — implementación nativa del
        sidecar (NO depende de `gui.widgets.rule_validator` del MARU
        original que NO está empaquetado en el sidecar PyInstaller).

        Reglas que se chequean por cada Rule:
          - **estructura**: tiene `name`, `trigger_type`, `actions[]` o
            campos legacy.
          - **trigger**: el trigger_type es válido y trigger_value tiene
            el formato esperado para su tipo (gift necesita nombre,
            like/like_milestone necesita número, command necesita cmd
            sin `!`).
          - **trigger_value de gifts**: existe en el catálogo de gifts
            (custom_gifts del `gifts.json` o gift estándar conocido).
          - **acciones**: cada action tiene action_type/action_value
            y `amount` >= 1.
          - **action_value**: existe en el catálogo de datos del juego
            (`data_<gameId>.json` por categoría).

        Conflictos detectados entre reglas:
          - Dos reglas con el mismo `(trigger_type, trigger_value)` y
            sin `cooldown` distinto → posible match doble.
        """
        game_id = _validate_game(params.get("gameId"))
        rules = self._read(game_id)

        # Catálogo de gifts conocidos (custom + estándar mínimos).
        custom_gifts: dict[str, Any] = {}
        try:
            gifts_path = self._data_dir / "gifts.json"
            if gifts_path.exists():
                gifts_doc = json.loads(gifts_path.read_text(encoding="utf-8"))
                if isinstance(gifts_doc, dict):
                    cg = gifts_doc.get("custom_gifts") or {}
                    if isinstance(cg, dict):
                        custom_gifts = cg
        except Exception:
            log.exception("no pude leer custom_gifts")
        # Set de gift names lower para match laxo.
        known_gift_names = {
            str(name).strip().lower()
            for name in custom_gifts.keys()
        }
        # Gifts estándar mínimos que TikTok siempre tiene.
        known_gift_names.update({
            "rose", "tiktok", "panda", "ice cream cone", "love bang",
            "perfume", "doughnut", "sunglasses", "rainbow puke",
            "team bracelet", "finger heart", "love you", "thumbs up",
            "gg", "hello", "you're amazing",
        })

        # Catálogo de data_<gameId>.json por categoría.
        # Soporta tanto `{categories: {<cat_id>: [...]}}` como
        # `{<cat_id>: [...]}` (formato legacy).
        data_path = self._data_dir / f"data_{game_id}.json"
        catalog_by_cat: dict[str, set[str]] = {}
        try:
            if data_path.exists():
                doc = json.loads(data_path.read_text(encoding="utf-8"))
                if isinstance(doc, dict):
                    cats = doc.get("categories") if isinstance(doc.get("categories"), dict) else doc
                    for cat_id, entries in cats.items():
                        if not isinstance(entries, list):
                            continue
                        names: set[str] = set()
                        for e in entries:
                            if isinstance(e, dict):
                                n = e.get("name") or e.get("display_name") or e.get("id")
                            else:
                                n = e
                            if n:
                                names.add(str(n).strip().lower())
                        catalog_by_cat[str(cat_id)] = names
        except Exception:
            log.exception("no pude leer data_%s.json", game_id)

        # Counters + buckets.
        problems: list[dict[str, Any]] = []
        conflicts: list[dict[str, Any]] = []
        error_count = 0
        warning_count = 0
        info_count = 0

        def _add(rule_name: str, message: str, ptype: str, suggestion: str | None = None) -> None:
            nonlocal error_count, warning_count, info_count
            problems.append({
                "rule_name": rule_name,
                "message": message,
                "suggestion": suggestion,
                "type": ptype,
            })
            if ptype == "error":
                error_count += 1
            elif ptype == "warning":
                warning_count += 1
            else:
                info_count += 1

        # Para detectar conflictos.
        seen_triggers: dict[tuple[str, str], list[str]] = {}

        for rule in rules:
            name = str(rule.get("name") or rule.get("id") or "?")
            trigger_type = str(rule.get("trigger_type") or "").strip().lower()
            trigger_value = str(rule.get("trigger_value") or "").strip()

            # 1) Estructura básica.
            if not name or name == "?":
                _add(name, "La regla no tiene nombre", "warning",
                     "Asignale un nombre descriptivo")
            if not trigger_type:
                _add(name, "Sin trigger_type", "error",
                     "Definí gift / command / follow / share / subscribe / like / like_milestone")
                continue
            if trigger_type not in {
                "gift", "command", "follow", "share", "subscribe",
                "like", "like_milestone",
            }:
                _add(name, f"trigger_type desconocido: {trigger_type}", "error")
                continue

            # 2) Validación por tipo de trigger.
            if trigger_type == "gift":
                if not trigger_value:
                    _add(name, "trigger_value vacío para tipo gift", "error",
                         "Especificá el nombre del regalo (ej. rose)")
                else:
                    if trigger_value.lower() not in known_gift_names:
                        _add(
                            name,
                            f"Gift '{trigger_value}' no encontrado en el catálogo",
                            "warning",
                            "Verificá la galería de regalos o agregalo como custom_gift",
                        )
            elif trigger_type == "command":
                if not trigger_value:
                    _add(name, "trigger_value vacío para tipo command", "error",
                         "Especificá el comando sin '!' (ej. play)")
                elif trigger_value.startswith("!") or trigger_value.startswith("/"):
                    _add(name, f"trigger_value '{trigger_value}' no debe llevar prefijo", "warning",
                         "Quitá el ! o / inicial")
            elif trigger_type in ("like", "like_milestone"):
                try:
                    n = int(trigger_value or "0")
                    if n <= 0:
                        _add(name, f"{trigger_type} requiere un número > 0", "error")
                except ValueError:
                    _add(name, f"trigger_value '{trigger_value}' no es un número válido para {trigger_type}", "error")
            elif trigger_type == "emote":
                if not trigger_value:
                    _add(name, "trigger_value vacío para tipo emote", "error",
                         "Elegí un emote del streamer en la galería")
            elif trigger_type == "join":
                # trigger_value vacío = cualquier user. Si trae username
                # se matchea exacto (case-insensitive). Sin validación
                # extra — el username puede tener cualquier formato.
                pass
            # follow / share / subscribe no necesitan trigger_value.

            # 3) Tracking de conflictos por (type, value).
            if trigger_value:
                key = (trigger_type, trigger_value.strip().lower())
                seen_triggers.setdefault(key, []).append(name)

            # 4) Acciones.
            actions = rule.get("actions") if isinstance(rule.get("actions"), list) else []
            if not actions and rule.get("action_type"):
                # Usar shape legacy.
                actions = [{
                    "action_type": rule.get("action_type"),
                    "action_value": rule.get("action_value"),
                    "amount": rule.get("amount", 1),
                }]
            if not actions:
                _add(name, "La regla no tiene acciones", "error",
                     "Agregá al menos una acción (spawn / give_item / trigger_event)")
                continue

            for i, a in enumerate(actions, start=1):
                if not isinstance(a, dict):
                    _add(name, f"Acción #{i}: estructura inválida", "error")
                    continue
                a_type = str(a.get("action_type") or "").strip()
                a_value = str(a.get("action_value") or "").strip()
                amount = a.get("amount", 1)
                if not a_type:
                    _add(name, f"Acción #{i}: sin action_type", "error")
                if not a_value:
                    _add(name, f"Acción #{i}: sin action_value", "warning",
                         "Especificá qué entidad/item disparar")
                try:
                    if int(amount) < 1:
                        _add(name, f"Acción #{i}: amount debe ser >= 1", "warning")
                except (TypeError, ValueError):
                    _add(name, f"Acción #{i}: amount inválido", "warning")
                # Verificar que action_value exista en catálogo de su categoría.
                cat_set = catalog_by_cat.get(a_type)
                if cat_set is not None and a_value:
                    if a_value.lower() not in cat_set:
                        _add(
                            name,
                            f"Acción #{i}: '{a_value}' no está en la categoría '{a_type}' del juego",
                            "warning",
                            "Verificá la pestaña Datos del juego",
                        )

        # Conflictos: mismo trigger en >1 regla sin cooldown distinto.
        for (t_type, t_val), rule_names in seen_triggers.items():
            if len(rule_names) > 1:
                conflicts.append({
                    "message": f"{len(rule_names)} reglas usan el mismo trigger {t_type}={t_val}: " + ", ".join(rule_names),
                })
                warning_count += 1

        return {
            "ok": True,
            "problems": problems,
            "conflicts": conflicts,
            "error_count": error_count,
            "warning_count": warning_count,
            "info_count": info_count,
            "totalRules": len(rules),
        }

    # ── Internals ────────────────────────────────────────────────────────

    def _read(self, game_id: str) -> list[dict[str, Any]]:
        p = self._rules_path(game_id)
        if not p.exists():
            return []
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.error("rules_%s.json corrupto — devolviendo []", game_id)
            return []
        if isinstance(data, dict) and isinstance(data.get("rules"), list):
            return list(data["rules"])
        if isinstance(data, list):
            return data
        return []

    def _write_atomic(
        self, game_id: str, rules: list[dict[str, Any]]
    ) -> None:
        p = self._rules_path(game_id)
        payload = {
            "rules": rules,
            "schemaVersion": SCHEMA_VERSION,
            "updatedAt": int(time.time() * 1000),
        }
        tmp = p.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        tmp.replace(p)

    def _maybe_backup(self, game_id: str) -> None:
        if not self._rules_path(game_id).exists():
            return
        try:
            self._backups.create("rules", label=f"auto: pre-edit {game_id}")
        except FileNotFoundError:
            pass
        except Exception as exc:
            log.warning("backup automático de rules falló: %s", exc)
