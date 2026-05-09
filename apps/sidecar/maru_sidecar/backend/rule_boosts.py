"""Servicio `boosts.*` — Multiplicadores externos y acumulables de reglas.

Sistema NUEVO en v1.0.54: en vez de configurar el multiplicador dentro de
cada Rule (`repeat_for`), el user crea "boosts" en un panel externo que
se aplican a las reglas que él selecciona. Múltiples boosts pueden caer
sobre la misma regla y se ACUMULAN multiplicativamente — un super_fan
nivel 50 puede recibir x2 (super_fan) * x4 (member 40-50) = x8 de la
regla "Spawn troll".

v1.0.69 fix RAÍZ del bug "boosts compartidos entre juegos": ahora el
storage es **un archivo por juego** (`data/rule_boosts_<gameId>.json`),
igual que `data/rules_<gameId>.json`. Así cuando el user cambia de
juego activo, ve SOLO los boosts de ese juego, sin contaminación.

Modelo de datos persistido en `data/rule_boosts_<gameId>.json`:

```json
{
  "boosts": [
    {
      "id": "uuid",
      "name": "Super fans x3",
      "enabled": true,
      "factor": 3,                    // 1..100, multiplicador
      "target": {
        "kind": "super_fan|member|donor|user|mod|follower",
        "level_min": 1,               // solo kind in [member, donor]
        "level_max": 50,              // solo kind in [member, donor]
        "username": "user_lower"      // solo kind == user
      },
      "rule_ids": ["all"] | ["uid1","uid2"]
    }
  ],
  "updatedAt": 1234567890
}
```

`compute_factor(rule_id, evt_data) → int` es el método que el
RuleDispatcher consulta para multiplicar el `trigger_times` antes de
ejecutar acciones del juego. Internamente lee el game_id activo.
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

log = get_logger(__name__)

# Archivo legacy (pre-v1.0.69) — se migra al juego activo en el primer boot.
_LEGACY_PATH = DATA_DIR / "rule_boosts.json"
# Hard ceiling — evita que el user configure x99 * x99 * x99 = ejecuciones
# inviables del juego. 100 es ya extremo para un live.
MAX_FACTOR = 100

VALID_KINDS = {"super_fan", "member", "donor", "user", "mod", "follower"}

# Patrón aceptado para gameId (mismo que data_catalog/rules).
_GID_RE = re.compile(r"^(?!\d+$)[a-zA-Z0-9_]{2,32}$")


def _validate_game(g: Any) -> str:
    if not isinstance(g, str):
        raise TypeError("gameId requerido")
    g = g.strip()
    if not _GID_RE.match(g):
        raise ValueError(f"gameId inválido: {g!r}")
    return g


def _boosts_path(game_id: str) -> Path:
    return DATA_DIR / f"rule_boosts_{game_id}.json"


class RuleBoostsService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        # Cache in-memory por gameId. Lazy load al primer acceso.
        self._docs: dict[str, dict[str, Any]] = {}
        # Migración una vez del archivo legacy si existe.
        self._legacy_migrated = False

    # ── Persistencia ─────────────────────────────────────────────────────

    def _read_doc(self, game_id: str) -> dict[str, Any]:
        path = _boosts_path(game_id)
        if not path.exists():
            return {"boosts": []}
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.error("rule_boosts_%s.json corrupto — reinicializando vacío", game_id)
            return {"boosts": []}
        if not isinstance(raw, dict):
            return {"boosts": []}
        boosts_raw = raw.get("boosts") or []
        if not isinstance(boosts_raw, list):
            boosts_raw = []
        # Validar y normalizar cada entry.
        boosts: list[dict[str, Any]] = []
        for b in boosts_raw:
            norm = self._normalize_boost(b)
            if norm is not None:
                boosts.append(norm)
        return {"boosts": boosts}

    def _write_doc(self, game_id: str) -> None:
        path = _boosts_path(game_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {**self._docs[game_id], "updatedAt": int(time.time() * 1000)}
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        tmp.replace(path)

    def _ensure_loaded(self, game_id: str) -> dict[str, Any]:
        """Lazy load del doc del juego en memoria. Retorna el doc."""
        if game_id not in self._docs:
            self._docs[game_id] = self._read_doc(game_id)
        return self._docs[game_id]

    def _migrate_legacy_if_needed(self, target_game_id: str) -> None:
        """v1.0.69: migra `data/rule_boosts.json` (legacy, sin gameId) al
        archivo del juego activo en el primer arranque. Idempotente."""
        if self._legacy_migrated:
            return
        if not _LEGACY_PATH.exists():
            self._legacy_migrated = True
            return
        try:
            raw = json.loads(_LEGACY_PATH.read_text(encoding="utf-8"))
            legacy_boosts = raw.get("boosts") if isinstance(raw, dict) else []
            if not isinstance(legacy_boosts, list) or not legacy_boosts:
                # Archivo vacío — solo borrarlo.
                _LEGACY_PATH.unlink(missing_ok=True)
                self._legacy_migrated = True
                return
            # Mover los boosts al juego activo.
            target_doc = self._ensure_loaded(target_game_id)
            existing_ids = {b.get("id") for b in target_doc["boosts"]}
            normalized = []
            for b in legacy_boosts:
                norm = self._normalize_boost(b)
                if norm is not None and norm["id"] not in existing_ids:
                    normalized.append(norm)
            target_doc["boosts"].extend(normalized)
            self._write_doc(target_game_id)
            # Backup del archivo legacy antes de borrar (por las dudas).
            backup = _LEGACY_PATH.with_suffix(".json.legacy.bak")
            _LEGACY_PATH.replace(backup)
            log.info(
                "rule_boosts: migración legacy → game=%s · %d boosts movidos · backup=%s",
                target_game_id, len(normalized), backup.name,
            )
        except Exception:
            log.exception("rule_boosts: migración legacy fallo (no crítico)")
        self._legacy_migrated = True

    def _normalize_boost(self, b: Any) -> dict[str, Any] | None:
        if not isinstance(b, dict):
            return None
        bid = str(b.get("id") or "").strip() or uuid.uuid4().hex[:12]
        name = str(b.get("name") or "Boost").strip()[:80]
        enabled = bool(b.get("enabled", True))
        try:
            factor = int(b.get("factor") or 1)
        except (TypeError, ValueError):
            factor = 1
        factor = max(1, min(MAX_FACTOR, factor))
        target_raw = b.get("target") or {}
        if not isinstance(target_raw, dict):
            target_raw = {}
        kind = str(target_raw.get("kind") or "").lower().strip()
        if kind not in VALID_KINDS:
            return None
        target: dict[str, Any] = {"kind": kind}
        if kind in ("member", "donor"):
            try:
                lo = int(target_raw.get("level_min") or 1)
                hi = int(target_raw.get("level_max") or 999)
            except (TypeError, ValueError):
                lo, hi = 1, 999
            target["level_min"] = max(1, min(999, lo))
            target["level_max"] = max(target["level_min"], min(999, hi))
        if kind == "user":
            uname = str(target_raw.get("username") or "").strip().lower()
            uname = uname.lstrip("@")
            if not uname:
                return None
            target["username"] = uname
        rule_ids_raw = b.get("rule_ids") or ["all"]
        if not isinstance(rule_ids_raw, list):
            rule_ids_raw = ["all"]
        rule_ids = [str(x) for x in rule_ids_raw if isinstance(x, str) and x.strip()]
        if not rule_ids:
            rule_ids = ["all"]
        return {
            "id": bid,
            "name": name,
            "enabled": enabled,
            "factor": factor,
            "target": target,
            "rule_ids": rule_ids,
        }

    # ── Helper para resolver el game_id activo ───────────────────────────

    def _read_active_game(self) -> str | None:
        """Lee `activeGame`/`current_game` de `data/config.json`. Mismo
        mecanismo que usa rule_dispatcher.py para no duplicar lógica."""
        path = DATA_DIR / "config.json"
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                for key in ("activeGame", "current_game"):
                    gid = data.get(key)
                    if isinstance(gid, str) and gid.strip():
                        try:
                            return _validate_game(gid)
                        except (TypeError, ValueError):
                            continue
        except (json.JSONDecodeError, OSError):
            pass
        return None

    def _resolve_game_id(self, params: dict[str, Any]) -> str:
        """Resuelve gameId desde params si viene; si no, del config activo.
        Lanza ValueError si no se puede determinar (caller debe pasar uno
        explícito o haber un activo configurado)."""
        explicit = params.get("gameId") or params.get("game_id")
        if isinstance(explicit, str) and explicit.strip():
            return _validate_game(explicit)
        active = self._read_active_game()
        if active:
            return active
        raise ValueError(
            "no se pudo determinar gameId — pasalo explícito o configurá un juego activo"
        )

    # ── RPC ──────────────────────────────────────────────────────────────

    def list(self, params: dict[str, Any]) -> dict[str, Any]:
        """Lista los boosts del juego pasado en `gameId`. Si no se pasa,
        usa el juego activo de `config.json`."""
        with self._lock:
            game_id = self._resolve_game_id(params or {})
            self._migrate_legacy_if_needed(game_id)
            doc = self._ensure_loaded(game_id)
            return {"boosts": list(doc["boosts"]), "gameId": game_id}

    def upsert(self, params: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            game_id = self._resolve_game_id(params or {})
            self._migrate_legacy_if_needed(game_id)
            boost = params.get("boost") or {}
            norm = self._normalize_boost(boost)
            if norm is None:
                raise ValueError("boost inválido (kind requerido)")
            doc = self._ensure_loaded(game_id)
            replaced = False
            for i, b in enumerate(doc["boosts"]):
                if b["id"] == norm["id"]:
                    doc["boosts"][i] = norm
                    replaced = True
                    break
            if not replaced:
                doc["boosts"].append(norm)
            self._write_doc(game_id)
            return {"ok": True, "boost": norm, "created": not replaced, "gameId": game_id}

    def delete(self, params: dict[str, Any]) -> dict[str, Any]:
        bid = str(params.get("id") or "").strip()
        if not bid:
            raise ValueError("id requerido")
        with self._lock:
            game_id = self._resolve_game_id(params or {})
            doc = self._ensure_loaded(game_id)
            before = len(doc["boosts"])
            doc["boosts"] = [b for b in doc["boosts"] if b["id"] != bid]
            removed = before != len(doc["boosts"])
            if removed:
                self._write_doc(game_id)
            return {"ok": removed, "gameId": game_id}

    def replace_all(self, params: dict[str, Any]) -> dict[str, Any]:
        items = params.get("boosts") or []
        if not isinstance(items, list):
            raise TypeError("boosts debe ser lista")
        normalized: list[dict[str, Any]] = []
        for b in items:
            norm = self._normalize_boost(b)
            if norm is not None:
                normalized.append(norm)
        with self._lock:
            game_id = self._resolve_game_id(params or {})
            doc = self._ensure_loaded(game_id)
            doc["boosts"] = normalized
            self._write_doc(game_id)
            return {"ok": True, "boosts": normalized, "gameId": game_id}

    def reload(self) -> None:
        """v1.0.69: invalida la cache in-memory para que la próxima
        consulta re-lea desde disco. Llamado por ProfilesService.load()
        después de restaurar archivos del profile."""
        with self._lock:
            self._docs.clear()
            self._legacy_migrated = False
        log.info("rule_boosts: cache invalidada (reload)")

    # ── Resolver: lo consume RuleDispatcher en cada evento ───────────────

    def compute_factor(self, rule_id: str, evt_data: dict[str, Any]) -> int:
        """Devuelve el factor combinado de TODOS los boosts aplicables a
        `rule_id` para el user del evento. Acumula multiplicativamente.

        v1.0.69: lee el juego activo de config.json y solo considera los
        boosts del archivo `rule_boosts_<active_game>.json`. Sin esto los
        boosts de Valheim se aplicaban también en Terraria.

        Si no hay juego activo o no hay boosts aplicables → 1 (sin cambio).
        """
        active = self._read_active_game()
        if not active:
            return 1
        with self._lock:
            self._migrate_legacy_if_needed(active)
            doc = self._ensure_loaded(active)
            boosts = list(doc["boosts"])
        if not boosts:
            return 1
        user_lower = str(evt_data.get("user") or "").lower().strip().lstrip("@")
        # FIX v1.0.66: leer ambos juegos de keys. `core_bridge.py` (path
        # real del live) y `simulator.py` setean `is_moderator` /
        # `is_follower`. El `_role_multiplier` original del rule_engine
        # (refactored) usa `is_mod` / `is_following` (legacy). Aceptamos
        # los dos para que los boosts disparen igual en LIVE REAL y
        # en SIMULADOR, sin importar de dónde venga el evento.
        is_mod = bool(evt_data.get("is_moderator") or evt_data.get("is_mod"))
        is_super_fan = bool(evt_data.get("is_super_fan"))
        # is_member: si el live trae el flag explícito, úsalo; sino
        # derívalo de `member_level > 0` (el simulator manda `member_level`
        # cuando el user toggle nivel pero antes no marcaba `is_member`,
        # y el boost member nunca matcheaba en simulación).
        try:
            member_level = int(evt_data.get("member_level") or 0)
        except (TypeError, ValueError):
            member_level = 0
        is_member = bool(evt_data.get("is_member")) or member_level > 0
        is_following = bool(
            evt_data.get("is_follower") or evt_data.get("is_following")
        )
        try:
            gifter_level = int(evt_data.get("gifter_level") or 0)
        except (TypeError, ValueError):
            gifter_level = 0

        factor_total = 1
        for b in boosts:
            if not b.get("enabled"):
                continue
            rule_ids = b.get("rule_ids") or []
            if "all" not in rule_ids and rule_id not in rule_ids:
                continue
            tgt = b.get("target") or {}
            kind = tgt.get("kind")
            matches = False
            if kind == "super_fan":
                matches = is_super_fan
            elif kind == "mod":
                matches = is_mod
            elif kind == "follower":
                matches = is_following
            elif kind == "member":
                if is_member:
                    lo = int(tgt.get("level_min") or 1)
                    hi = int(tgt.get("level_max") or 999)
                    matches = lo <= member_level <= hi
            elif kind == "donor":
                # `donor` = gifter — usamos `gifter_level` (1..50). Si el
                # user no tiene gifter_level pero es super_fan/member,
                # asumimos donor=true con level=0 (no entra en rangos
                # mayor a 1).
                lo = int(tgt.get("level_min") or 1)
                hi = int(tgt.get("level_max") or 999)
                matches = lo <= gifter_level <= hi
            elif kind == "user":
                wanted = str(tgt.get("username") or "")
                matches = bool(wanted) and user_lower == wanted
            if matches:
                try:
                    factor_total *= max(1, int(b.get("factor") or 1))
                except (TypeError, ValueError):
                    pass
                if factor_total > MAX_FACTOR:
                    factor_total = MAX_FACTOR
                    break
        return factor_total
