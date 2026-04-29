"""Adapter `games.*` — perfiles de juegos (G4).

Schema MARU real, multi-custom. Cada perfil persiste TODO lo que el
`manage_games_dialog.py` + `custom_game_dialog.py` editan: identidad,
conexión, tipo de conexión, categorías declarativas con
endpoints/payloads/RCON commands, tab_names, share_sounds/voices,
based_on.

Persistencia: `data/games.json` con shape:
    {
      "games": {
        "valheim":   {<GameProfile dict>, "isStandard": true, ...},
        "terraria":  {...},
        "minecraft": {...},
        "ark":       {<custom>, "isStandard": false, "categories": [...]},
        ...
      },
      "schemaVersion": 2
    }

Migración auto desde el schema F0-F8:
    {"valheim": {"host", "port", "password"}, ...}  (sin "games" wrapper)

Réplica de:
  - `manage_games_dialog.py` (predefinidos + custom CRUD).
  - `custom_game_dialog.py` (categorías, presets, tab_names).
  - `profile_dialog.py` (NewProfileDialog → games.duplicate).
  - `core/games.py:CustomGame` (instanciación con categories).

Mejoras sobre el original:
  - Schema versionado (`schemaVersion: 2`) para futuras migraciones.
  - Backup automático antes de migración destructiva.
  - Borrado de perfil custom limpia data_<gid>.json + rules_<gid>.json.
  - `duplicate()` es atómico: si falla a la mitad, rollback parcial.
"""

from __future__ import annotations

import asyncio
import copy
import json
import re
import shutil
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any

from ..logger import get_logger
from ..runtime import BACKUPS_DIR, DATA_DIR

log = get_logger(__name__)

STANDARD_GAME_IDS: tuple[str, ...] = ("valheim", "terraria", "minecraft")
SCHEMA_VERSION = 2

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="games-io")
_ID_RE = re.compile(r"^(?!\d+$)[a-zA-Z0-9_]{2,32}$")


def _config_path() -> Path:
    return DATA_DIR / "games.json"


def _data_path(gid: str) -> Path:
    return DATA_DIR / f"data_{gid}.json"


def _rules_path(gid: str) -> Path:
    return DATA_DIR / f"rules_{gid}.json"


def _validate_game_id(gid: Any, *, allow_existing_standard: bool = True) -> str:
    if not isinstance(gid, str):
        raise TypeError("gameId requerido")
    g = gid.strip()
    if not g:
        raise ValueError("gameId vacío")
    if not allow_existing_standard and g.lower() in STANDARD_GAME_IDS:
        raise ValueError(f"id reservado para predefinido: {g!r}")
    if not _ID_RE.match(g):
        raise ValueError(
            "id inválido — solo [a-zA-Z0-9_], 2-32 chars, no puede ser puramente numérico"
        )
    return g


# ── Defaults de perfiles predefinidos ────────────────────────────────────


def _default_predefined() -> dict[str, dict[str, Any]]:
    """Configuración base de los 3 perfiles predefinidos del MARU.

    Espejo de `core/games.py:ValheimGame/TerrariaGame/MinecraftGame.__init__`.
    """
    # Espejo de `gui/constants.py:GAME_FEATURES`:
    #   valheim:   {entities, items, events}
    #   terraria:  {entities, items, events}
    #   minecraft: {entities, items, events}
    # Los standards NO tienen valuables — esa categoría solo aparece en
    # customs cuando el usuario la agrega. En los standards solo se pueden
    # renombrar las 3 pestañas via `tabNames`.
    std_tab_names = {
        "entities": "🐉 Entidades",
        "items": "📦 Items",
        "events": "⚡ Eventos",
    }
    return {
        "valheim": {
            "id": "valheim",
            "name": "Valheim",
            "icon": "🐉",
            "isStandard": True,
            "connection": {"host": "localhost", "port": 5000, "password": ""},
            "connectionType": "http",
            "tabNames": dict(std_tab_names),
            "hasEntities": True,
            "hasItems": True,
            "hasEvents": True,
            "hasValuables": False,
            "categories": [],
            "shareSounds": True,
            "shareVoices": True,
        },
        "terraria": {
            "id": "terraria",
            "name": "Terraria",
            "icon": "🌳",
            "isStandard": True,
            "connection": {"host": "localhost", "port": 5000, "password": ""},
            "connectionType": "http",
            "tabNames": dict(std_tab_names),
            "hasEntities": True,
            "hasItems": True,
            "hasEvents": True,
            "hasValuables": False,
            "categories": [],
            "shareSounds": True,
            "shareVoices": True,
        },
        "minecraft": {
            "id": "minecraft",
            "name": "Minecraft",
            "icon": "⛏️",
            "isStandard": True,
            "connection": {"host": "localhost", "port": 25575, "password": ""},
            "connectionType": "rcon",
            "tabNames": dict(std_tab_names),
            "hasEntities": True,
            "hasItems": True,
            "hasEvents": True,
            "hasValuables": False,
            "categories": [],
            "shareSounds": True,
            "shareVoices": True,
        },
    }


def _flatten_profile_for_custom_game(
    profile: dict[str, Any],
    host: str,
    port: int,
    password: str,
) -> dict[str, Any]:
    """Aplana un GameProfile (camelCase, categories[]) al shape SNAKE_CASE
    plano que `core/games.py:CustomGame.__init__` espera.

    Sin esto, las reglas en juegos custom no envían NADA al mod porque
    CustomGame recibe defaults vacíos.

    Mapeo de categorías → endpoints planos:
      - cat.type=='entity'  → spawn_endpoint, spawn_payload, rcon_spawn_cmd
      - cat.type=='item'    → item_endpoint, item_payload, rcon_item_cmd
      - cat.type=='event'   → event_endpoint, event_payload, rcon_event_cmd
      - cat.type=='valuable'→ se trata como spawn (paridad RuleEngine)
    """
    cats = profile.get("categories") or []
    if not isinstance(cats, list):
        cats = []

    def _find_cat(ctype: str) -> dict[str, Any] | None:
        for c in cats:
            if isinstance(c, dict) and c.get("type") == ctype:
                return c
        return None

    cat_entity = _find_cat("entity") or _find_cat("valuable")
    cat_item = _find_cat("item")
    cat_event = _find_cat("event")

    config: dict[str, Any] = {
        "name": profile.get("name") or "",
        "host": host,
        "port": port,
        "connection_type": (
            "rcon"
            if str(profile.get("connectionType") or "http").lower() == "rcon"
            else "http"
        ),
        "rcon_password": password,
        "has_entities": bool(profile.get("hasEntities") or cat_entity),
        "has_items": bool(profile.get("hasItems") or cat_item),
        "has_events": bool(profile.get("hasEvents") or cat_event),
    }

    if cat_entity:
        ep = cat_entity.get("endpoint") or ""
        if ep:
            config["spawn_endpoint"] = ep
        pl = cat_entity.get("payload") or ""
        if pl:
            config["spawn_payload"] = pl
        rc = cat_entity.get("rconCmd") or cat_entity.get("rcon_cmd") or ""
        if rc:
            config["rcon_spawn_cmd"] = rc

    if cat_item:
        ep = cat_item.get("endpoint") or ""
        if ep:
            config["item_endpoint"] = ep
        pl = cat_item.get("payload") or ""
        if pl:
            config["item_payload"] = pl
        rc = cat_item.get("rconCmd") or cat_item.get("rcon_cmd") or ""
        if rc:
            config["rcon_item_cmd"] = rc

    if cat_event:
        ep = cat_event.get("endpoint") or ""
        if ep:
            config["event_endpoint"] = ep
        pl = cat_event.get("payload") or ""
        if pl:
            config["event_payload"] = pl
        rc = cat_event.get("rconCmd") or cat_event.get("rcon_cmd") or ""
        if rc:
            config["rcon_event_cmd"] = rc

    return config


def _coerce_categories(raw: Any) -> list[dict[str, Any]]:
    """Coerce lista de categorías al shape canónico."""
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for c in raw:
        if not isinstance(c, dict):
            continue
        cid = str(c.get("id") or "").strip()
        if not cid:
            continue
        out.append(
            {
                "id": cid,
                "name": str(c.get("name") or cid),
                "type": str(c.get("type") or "entity"),
                "icon": str(c.get("icon") or "📦"),
                "dataKey": str(c.get("dataKey") or c.get("data_key") or cid),
                "endpoint": str(c.get("endpoint") or ""),
                "payload": str(c.get("payload") or ""),
                "rconCmd": str(c.get("rconCmd") or c.get("rcon_cmd") or ""),
                "tutorial": str(c.get("tutorial") or ""),
            }
        )
    return out


def _coerce_profile(raw: Any, fallback_id: str = "") -> dict[str, Any]:
    """Coerce un perfil leído de disk al shape canónico."""
    if not isinstance(raw, dict):
        raw = {}
    gid = str(raw.get("id") or fallback_id or "").strip()
    is_std = gid.lower() in STANDARD_GAME_IDS or bool(raw.get("isStandard"))
    conn_raw = raw.get("connection") or {}
    if not isinstance(conn_raw, dict):
        conn_raw = {}
    cats = _coerce_categories(raw.get("categories"))

    # Para CUSTOMS: si el flag no vino persistido, derivarlo de las
    # categorías. Para STANDARDS: el flag siempre es lo que dice el JSON
    # (los predefinidos no tienen valuables nunca).
    has_entities_raw = raw.get("hasEntities", raw.get("has_entities"))
    has_items_raw = raw.get("hasItems", raw.get("has_items"))
    has_events_raw = raw.get("hasEvents", raw.get("has_events"))
    has_valuables_raw = raw.get("hasValuables", raw.get("has_valuables"))

    if not is_std and cats:
        # Auto-derivar para custom si las categories declaran ese type.
        if any(c["type"] == "valuable" for c in cats):
            has_valuables_raw = True
        if any(c["type"] == "entity" for c in cats):
            has_entities_raw = True if has_entities_raw is None else has_entities_raw
        if any(c["type"] == "item" for c in cats):
            has_items_raw = True if has_items_raw is None else has_items_raw
        if any(c["type"] == "event" for c in cats):
            has_events_raw = True if has_events_raw is None else has_events_raw

    return {
        "id": gid,
        "name": str(raw.get("name") or gid.title() or "Custom"),
        "icon": str(raw.get("icon") or "🎮"),
        "isStandard": is_std,
        "connection": {
            "host": str(conn_raw.get("host") or "127.0.0.1"),
            "port": int(conn_raw.get("port") or 0),
            "password": str(conn_raw.get("password") or ""),
        },
        "connectionType": (
            "rcon"
            if str(raw.get("connectionType") or raw.get("connection_type") or "http").lower()
            == "rcon"
            else "http"
        ),
        "tabNames": raw.get("tabNames") or raw.get("tab_names") or {},
        "hasEntities": bool(has_entities_raw),
        "hasItems": bool(has_items_raw),
        "hasEvents": bool(has_events_raw),
        "hasValuables": bool(has_valuables_raw),
        "categories": cats,
        "shareSounds": bool(raw.get("shareSounds", raw.get("share_sounds", True))),
        "shareVoices": bool(raw.get("shareVoices", raw.get("share_voices", True))),
        "basedOn": raw.get("basedOn") or raw.get("based_on"),
    }


def _looks_like_old_f08_schema(doc: Any) -> bool:
    """F0-F8: dict top-level con keys = gid, sin 'games' wrapper.

    Ejemplo: `{"valheim": {"host": "...", "port": 5566, "password": ""}, ...}`
    """
    if not isinstance(doc, dict) or not doc:
        return False
    if "games" in doc:
        return False
    # Si todas las values son dicts con 'host' o 'port' → F0-F8.
    for v in doc.values():
        if not isinstance(v, dict):
            return False
        if not ("host" in v or "port" in v):
            return False
    return True


def _migrate_f08_to_v2(old: dict[str, Any]) -> dict[str, Any]:
    """Convertir F0-F8 → schema v2 con perfiles canónicos."""
    games = _default_predefined()
    for gid, conn in old.items():
        if not isinstance(conn, dict):
            continue
        gid_l = gid.lower()
        if gid_l in games:
            # Merge sobre el predefinido: solo connection.
            games[gid_l]["connection"]["host"] = str(conn.get("host") or games[gid_l]["connection"]["host"])
            games[gid_l]["connection"]["port"] = int(conn.get("port") or games[gid_l]["connection"]["port"])
            if conn.get("password"):
                games[gid_l]["connection"]["password"] = str(conn["password"])
        # Para gids no estándar en F0-F8 (no había forma real, pero tolerar):
        # se ignoran porque no tienen suficiente info para construir un perfil custom.
    return {"schemaVersion": SCHEMA_VERSION, "games": games}


def _looks_like_maru_format(doc: Any) -> bool:
    """Formato MARU original: `{custom_games, game_configs, entity_images}`."""
    if not isinstance(doc, dict):
        return False
    return (
        "custom_games" in doc
        or "game_configs" in doc
    ) and "games" not in doc


def _migrate_maru_to_v2(old: dict[str, Any]) -> dict[str, Any]:
    """Migrar el `games.json` del MARU original al schema v2 del sidecar.

    El MARU original tiene shape:
        {
          "custom_games": { "<gid>": {<full custom>}, ... },
          "game_configs": {
            "valheim": {id, name, icon, host, port, tab_names},
            "<gid>": {<categories, endpoints, payloads>},
          },
          "entity_images": {...}  # ignorado, lo manejamos por bundle
        }

    El schema v2 del sidecar es `{schemaVersion, games: {<gid>: GameProfile}}`.
    """
    games = _default_predefined()

    # Aplicar overrides desde game_configs a los predefinidos.
    cfgs = old.get("game_configs") or {}
    if isinstance(cfgs, dict):
        for gid, raw in cfgs.items():
            if not isinstance(raw, dict):
                continue
            gid_l = gid.lower()
            if gid_l in games:
                # Standard: aplicar host/port/password/tab_names si vino.
                std = games[gid_l]
                std["connection"]["host"] = str(raw.get("host") or std["connection"]["host"])
                try:
                    std["connection"]["port"] = int(raw.get("port") or std["connection"]["port"])
                except (TypeError, ValueError):
                    pass
                if raw.get("rcon_password"):
                    std["connection"]["password"] = str(raw["rcon_password"])
                tab_names = raw.get("tab_names")
                if isinstance(tab_names, dict):
                    std["tabNames"] = {
                        "entities": tab_names.get("entities") or std.get("tabNames", {}).get("entities"),
                        "items": tab_names.get("items") or std.get("tabNames", {}).get("items"),
                        "events": tab_names.get("events") or std.get("tabNames", {}).get("events"),
                    }
            elif gid_l not in games:
                # Custom presente en game_configs (no en custom_games) — convertir.
                games[gid_l] = _maru_custom_to_profile(gid_l, raw)

    # custom_games: agregar/sobrescribir con los customs reales.
    customs = old.get("custom_games") or {}
    if isinstance(customs, dict):
        for gid, raw in customs.items():
            if not isinstance(raw, dict):
                continue
            gid_l = gid.lower()
            if gid_l in ("valheim", "terraria", "minecraft"):
                continue  # nunca sobrescribir predefinidos como custom
            games[gid_l] = _maru_custom_to_profile(gid_l, raw)

    return {"schemaVersion": SCHEMA_VERSION, "games": games}


def _maru_custom_to_profile(gid: str, raw: dict[str, Any]) -> dict[str, Any]:
    """Convierte un custom game del shape MARU al `GameProfile` v2."""
    cats_raw = raw.get("categories") or []
    cats: list[dict[str, Any]] = []
    if isinstance(cats_raw, list):
        for c in cats_raw:
            if not isinstance(c, dict):
                continue
            cid = str(c.get("id") or "").strip()
            if not cid:
                continue
            cats.append(
                {
                    "id": cid,
                    "name": str(c.get("name") or cid),
                    "type": str(c.get("type") or "entity"),
                    "icon": str(c.get("icon") or "📦"),
                    "dataKey": str(c.get("data_key") or c.get("dataKey") or cid),
                    "endpoint": str(c.get("endpoint") or ""),
                    "payload": str(c.get("payload") or ""),
                    "rconCmd": str(c.get("rcon_cmd") or c.get("rconCmd") or ""),
                    "tutorial": str(c.get("tutorial") or ""),
                }
            )
    return {
        "id": gid,
        "name": str(raw.get("name") or gid.title()),
        "icon": str(raw.get("icon") or "🎮"),
        "isStandard": False,
        "connection": {
            "host": str(raw.get("host") or "127.0.0.1"),
            "port": int(raw.get("port") or 5000),
            "password": str(raw.get("rcon_password") or ""),
        },
        "connectionType": "rcon"
        if str(raw.get("connection_type") or "http").lower() == "rcon"
        else "http",
        "categories": cats,
        "hasEntities": bool(raw.get("has_entities", any(c["type"] == "entity" for c in cats))),
        "hasItems": bool(raw.get("has_items", any(c["type"] == "item" for c in cats))),
        "hasEvents": bool(raw.get("has_events", any(c["type"] == "event" for c in cats))),
        "hasValuables": bool(raw.get("has_valuables", any(c["type"] == "valuable" for c in cats))),
        "shareSounds": True,
        "shareVoices": True,
        "basedOn": None,
        "tabNames": {},
    }


def _backup_games_json(path: Path) -> Path | None:
    if not path.exists():
        return None
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    dst = BACKUPS_DIR / f"games_pre_migration_{ts}.json"
    shutil.copy2(path, dst)
    log.info("games.json backup before migration: %s", dst)
    return dst


# ── Service ──────────────────────────────────────────────────────────────


class GamesService:
    """Servicio de perfiles de juego con schema MARU multi-custom."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._instances: dict[str, Any] = {}
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._migrate_if_needed()

    # ── RPC handlers ─────────────────────────────────────────────────────

    def list(self, _params: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            doc = self._read()
            games = [
                _coerce_profile(p, fallback_id=gid)
                for gid, p in doc.get("games", {}).items()
            ]
        # Predefinidos primero (orden canónico), luego custom alfa.
        std_order = {gid: i for i, gid in enumerate(STANDARD_GAME_IDS)}
        games.sort(
            key=lambda g: (
                0 if g["id"].lower() in std_order else 1,
                std_order.get(g["id"].lower(), 99),
                g["name"].lower(),
            )
        )
        return {"games": games}

    def configure(self, params: dict[str, Any]) -> dict[str, Any]:
        gid = _validate_game_id(params.get("gameId"))
        conn = params.get("connection") or {}
        if not isinstance(conn, dict):
            raise TypeError("connection requerido")
        with self._lock:
            doc = self._read()
            games = doc.setdefault("games", {})
            if gid not in games:
                raise ValueError(f"perfil no existe: {gid!r}")
            games[gid]["connection"] = {
                "host": str(conn.get("host") or "127.0.0.1"),
                "port": int(conn.get("port") or 0),
                "password": str(conn.get("password") or ""),
            }
            self._write(doc)
            self._instances.pop(gid, None)
            profile = _coerce_profile(games[gid], fallback_id=gid)
        return {"profile": profile}

    def update(self, params: dict[str, Any]) -> dict[str, Any]:
        gid = _validate_game_id(params.get("gameId"))
        patch = params.get("patch") or {}
        if not isinstance(patch, dict):
            raise TypeError("patch requerido")
        with self._lock:
            doc = self._read()
            games = doc.setdefault("games", {})
            if gid not in games:
                raise ValueError(f"perfil no existe: {gid!r}")
            target = games[gid]
            is_std = bool(target.get("isStandard"))

            # Campos siempre editables.
            for key in ("connection", "tabNames"):
                if key in patch and patch[key] is not None:
                    target[key] = patch[key]

            # Campos solo editables en custom.
            if not is_std:
                for key in (
                    "name",
                    "icon",
                    "connectionType",
                    "categories",
                    "shareSounds",
                    "shareVoices",
                ):
                    if key in patch and patch[key] is not None:
                        target[key] = patch[key]
                if "categories" in patch:
                    cats = _coerce_categories(patch["categories"])
                    target["categories"] = cats
                    target["hasEntities"] = any(c["type"] == "entity" for c in cats)
                    target["hasItems"] = any(c["type"] == "item" for c in cats)
                    target["hasEvents"] = any(c["type"] == "event" for c in cats)
                    target["hasValuables"] = any(
                        c["type"] == "valuable" for c in cats
                    )

            self._write(doc)
            self._instances.pop(gid, None)
            profile = _coerce_profile(games[gid], fallback_id=gid)
        return {"profile": profile}

    def create_custom(self, params: dict[str, Any]) -> dict[str, Any]:
        body = params.get("profile") or {}
        if not isinstance(body, dict):
            raise TypeError("profile requerido")
        gid = _validate_game_id(body.get("id"), allow_existing_standard=False)

        with self._lock:
            doc = self._read()
            games = doc.setdefault("games", {})
            if gid in games:
                raise ValueError(f"id ya existe: {gid!r}")

            cats = _coerce_categories(body.get("categories"))
            new_profile = {
                "id": gid,
                "name": str(body.get("name") or gid).strip() or gid,
                "icon": str(body.get("icon") or "🎮"),
                "isStandard": False,
                "connection": body.get("connection")
                or {"host": "localhost", "port": 5000, "password": ""},
                "connectionType": (
                    "rcon"
                    if str(body.get("connectionType") or "http").lower() == "rcon"
                    else "http"
                ),
                "categories": cats,
                "hasEntities": any(c["type"] == "entity" for c in cats),
                "hasItems": any(c["type"] == "item" for c in cats),
                "hasEvents": any(c["type"] == "event" for c in cats),
                "hasValuables": any(c["type"] == "valuable" for c in cats),
                "shareSounds": bool(body.get("shareSounds", True)),
                "shareVoices": bool(body.get("shareVoices", True)),
                "basedOn": body.get("basedOn"),
                "tabNames": {},
            }
            games[gid] = new_profile
            self._write(doc)
            # Crear archivos vacíos data_<gid>.json + rules_<gid>.json.
            self._ensure_empty_data(gid)
            self._ensure_empty_rules(gid)
            profile = _coerce_profile(new_profile, fallback_id=gid)
        return {"profile": profile}

    def duplicate(self, params: dict[str, Any]) -> dict[str, Any]:
        source = params.get("sourceId")
        new_id = _validate_game_id(params.get("newId"), allow_existing_standard=False)
        new_name = str(params.get("newName") or new_id).strip() or new_id.title()
        share_sounds = bool(params.get("shareSounds", True))
        share_voices = bool(params.get("shareVoices", True))

        with self._lock:
            doc = self._read()
            games = doc.setdefault("games", {})
            if new_id in games:
                raise ValueError(f"id ya existe: {new_id!r}")

            if source == "empty" or not source:
                base = None
            else:
                src_id = _validate_game_id(source)
                base = games.get(src_id)
                if base is None:
                    raise ValueError(f"perfil base no existe: {src_id!r}")

            if base is not None:
                new_profile = copy.deepcopy(base)
                new_profile["id"] = new_id
                new_profile["name"] = new_name
                new_profile["isStandard"] = False
                new_profile["basedOn"] = base.get("id")
                new_profile["shareSounds"] = share_sounds
                new_profile["shareVoices"] = share_voices
                # Para duplicado de standard: convertir tabNames en categories.
                if base.get("isStandard"):
                    new_profile["categories"] = self._categories_from_standard(base)
                src_data = _data_path(base["id"])
                if src_data.exists():
                    shutil.copy2(src_data, _data_path(new_id))
                else:
                    self._ensure_empty_data(new_id)
            else:
                new_profile = {
                    "id": new_id,
                    "name": new_name,
                    "icon": "🎮",
                    "isStandard": False,
                    "connection": {"host": "localhost", "port": 5000, "password": ""},
                    "connectionType": "http",
                    "categories": [],
                    "hasEntities": False,
                    "hasItems": False,
                    "hasEvents": False,
                    "shareSounds": share_sounds,
                    "shareVoices": share_voices,
                    "basedOn": None,
                    "tabNames": {},
                }
                self._ensure_empty_data(new_id)

            self._ensure_empty_rules(new_id)
            games[new_id] = new_profile
            self._write(doc)
            profile = _coerce_profile(new_profile, fallback_id=new_id)
        return {"profile": profile}

    def delete_custom(self, params: dict[str, Any]) -> dict[str, Any]:
        gid = _validate_game_id(params.get("gameId"), allow_existing_standard=False)
        deleted: list[str] = []
        with self._lock:
            doc = self._read()
            games = doc.setdefault("games", {})
            if gid not in games:
                raise ValueError(f"perfil no existe: {gid!r}")
            del games[gid]
            self._write(doc)
            self._instances.pop(gid, None)
            for p in (_data_path(gid), _rules_path(gid)):
                if p.exists():
                    try:
                        p.unlink()
                        deleted.append(p.name)
                    except OSError as ex:
                        log.warning("no pude borrar %s: %s", p, ex)
        return {"ok": True, "deletedFiles": deleted}

    async def test(self, params: dict[str, Any]) -> dict[str, Any]:
        gid = _validate_game_id(params.get("gameId"))
        ad_hoc = params.get("connection")
        # Si vino connection, usar adhoc sin persistir (modo test rápido).
        with self._lock:
            doc = self._read()
            games = doc.get("games", {})
            target = games.get(gid)
            if target is None:
                return {"ok": False, "message": f"perfil no existe: {gid}"}
            if isinstance(ad_hoc, dict):
                # Snapshot temporal — instanciar sin tocar persistencia.
                temp_profile = copy.deepcopy(target)
                temp_profile["connection"] = {
                    "host": str(ad_hoc.get("host") or "127.0.0.1"),
                    "port": int(ad_hoc.get("port") or 0),
                    "password": str(ad_hoc.get("password") or ""),
                }
                inst = self._build_instance(gid, temp_profile)
            else:
                inst = self._ensure_instance_locked(gid)
        if inst is None:
            return {"ok": False, "message": "core.games no disponible"}
        return await self._run_io(lambda: inst.test_connection())

    async def spawn(self, params: dict[str, Any]) -> dict[str, Any]:
        gid = _validate_game_id(params.get("gameId"))
        entity = params.get("entity")
        amount = int(params.get("amount") or 1)
        user = params.get("user") or "system"
        if not isinstance(entity, str) or not entity.strip():
            raise ValueError("entity requerido")
        inst = self._ensure_instance(gid)
        if inst is None:
            return {"ok": False, "message": "core.games no disponible"}
        return await self._run_io(lambda: inst.spawn(entity, amount, user))

    async def give_item(self, params: dict[str, Any]) -> dict[str, Any]:
        gid = _validate_game_id(params.get("gameId"))
        item = params.get("item")
        amount = int(params.get("amount") or 1)
        user = params.get("user") or "system"
        if not isinstance(item, str) or not item.strip():
            raise ValueError("item requerido")
        inst = self._ensure_instance(gid)
        if inst is None:
            return {"ok": False, "message": "core.games no disponible"}
        return await self._run_io(lambda: inst.give_item(item, amount, user))

    async def trigger_event(self, params: dict[str, Any]) -> dict[str, Any]:
        gid = _validate_game_id(params.get("gameId"))
        event = params.get("event")
        user = params.get("user") or "system"
        if not isinstance(event, str) or not event.strip():
            raise ValueError("event requerido")
        inst = self._ensure_instance(gid)
        if inst is None:
            return {"ok": False, "message": "core.games no disponible"}
        return await self._run_io(lambda: inst.trigger_event(event, user))

    # ── Internals ────────────────────────────────────────────────────────

    @staticmethod
    async def _run_io(fn) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        try:
            res = await loop.run_in_executor(_executor, fn)
        except Exception as exc:
            log.exception("games io error")
            return {"ok": False, "message": str(exc)}
        if isinstance(res, tuple) and len(res) == 2:
            ok, msg = res
            return {"ok": bool(ok), "message": str(msg)}
        return {"ok": True, "message": str(res)}

    def _categories_from_standard(self, base: dict[str, Any]) -> list[dict[str, Any]]:
        """Convertir un perfil standard a categories editables.

        Cuando se duplica `valheim` para crear `valheim_modded`, hay que
        materializar las categorías que el standard tiene implícitas (no
        guardadas en `categories`) para que el nuevo perfil custom sea
        completamente editable.
        """
        cats: list[dict[str, Any]] = []
        if base.get("hasEntities"):
            cats.append(self._default_category("entities", "🐉 Entidades", "entity"))
        if base.get("hasItems"):
            cats.append(self._default_category("items", "📦 Items", "item"))
        if base.get("hasEvents"):
            cats.append(self._default_category("events", "⚡ Eventos", "event"))
        if base.get("hasValuables"):
            cats.append(self._default_category("valuables", "💎 Valuables", "valuable"))
        return cats

    @staticmethod
    def _default_category(cid: str, name: str, ctype: str) -> dict[str, Any]:
        return {
            "id": cid,
            "name": name,
            "type": ctype,
            "icon": {
                "entity": "🐉",
                "item": "📦",
                "event": "⚡",
                "valuable": "💎",
            }.get(ctype, "📦"),
            "dataKey": cid,
            "endpoint": f"/{cid}",
            "payload": '{"name": "{entity}", "amount": {amount}}'
            if ctype != "event"
            else '{"event": "{entity}", "user": "{user}"}',
            "rconCmd": "summon {entity}" if ctype == "entity" else "",
            "tutorial": "",
        }

    def _ensure_empty_data(self, gid: str) -> None:
        p = _data_path(gid)
        if p.exists():
            return
        body = {"entities": [], "items": [], "events": [], "valuables": []}
        p.write_text(json.dumps(body, indent=2, ensure_ascii=False), encoding="utf-8")

    def _ensure_empty_rules(self, gid: str) -> None:
        p = _rules_path(gid)
        if p.exists():
            return
        p.write_text(json.dumps({"rules": []}, indent=2, ensure_ascii=False), encoding="utf-8")

    def get_instance(self, gid: str) -> Any:
        """API pública para que otros servicios (RuleDispatcher) reutilicen
        la misma instancia cacheada que usa games.spawn/test."""
        return self._ensure_instance(gid)

    def _ensure_instance(self, gid: str) -> Any:
        with self._lock:
            return self._ensure_instance_locked(gid)

    def _ensure_instance_locked(self, gid: str) -> Any:
        if gid in self._instances:
            return self._instances[gid]
        doc = self._read()
        target = doc.get("games", {}).get(gid)
        if not target:
            return None
        inst = self._build_instance(gid, target)
        if inst is not None:
            self._instances[gid] = inst
        return inst

    def _build_instance(self, gid: str, profile: dict[str, Any]) -> Any:
        try:
            from .. import core_bridge
            core_bridge.install()
            from core import games as cg  # type: ignore
        except Exception as exc:
            log.warning("core.games no disponible: %s", exc)
            return None

        klass_map = {
            "valheim": getattr(cg, "ValheimGame", None),
            "terraria": getattr(cg, "TerrariaGame", None),
            "minecraft": getattr(cg, "MinecraftGame", None),
        }
        gid_l = gid.lower()
        klass = klass_map.get(gid_l) if profile.get("isStandard") else getattr(cg, "CustomGame", None)
        if klass is None:
            log.warning("clase de juego ausente para %s", gid)
            return None

        conn = profile.get("connection") or {}
        host = str(conn.get("host") or "127.0.0.1")
        port = int(conn.get("port") or 0)
        password = str(conn.get("password") or "")

        try:
            if profile.get("isStandard"):
                # Firmas reales del core/games.py:
                #   ValheimGame(host, port)            — REST API, sin password
                #   TerrariaGame(host, port)           — REST API, sin password
                #   MinecraftGame(host, port, password) — RCON, requiere password
                if gid_l == "minecraft":
                    return klass(host, port or 25575, password)
                # Valheim / Terraria solo aceptan host + port.
                return klass(host, port or 5000)

            # CustomGame(game_id, config_dict) — el original (`core/games.py:474-501`)
            # lee keys SNAKE_CASE planas: connection_type, spawn_endpoint,
            # item_endpoint, event_endpoint, spawn_payload, item_payload,
            # event_payload, rcon_password, rcon_spawn_cmd, rcon_item_cmd,
            # rcon_event_cmd, has_entities, has_items, has_events.
            #
            # Nuestro GameProfile guarda `categories[]` con cada categoría
            # teniendo type/endpoint/payload/rconCmd. Hay que APLANAR
            # categories → keys snake_case planas que CustomGame entiende.
            custom_config = _flatten_profile_for_custom_game(
                profile, host, port, password
            )
            return klass(gid, custom_config)
        except TypeError as exc:
            # Firma incompatible: el core puede tener una versión distinta.
            # Intentar fallbacks típicos antes de rendirnos.
            log.warning("firma incompatible para %s (%s); probando fallback", gid, exc)
            try:
                if profile.get("isStandard"):
                    if gid_l == "minecraft":
                        return klass(host=host, port=port or 25575, password=password)
                    return klass(host=host, port=port or 5000)
                return klass(game_id=gid, config=custom_config)  # type: ignore[name-defined]
            except Exception as exc2:
                log.exception("fallback también falló para %s: %s", gid, exc2)
                return None
        except Exception as exc:
            log.exception("no pude instanciar %s: %s", gid, exc)
            return None

    # ── Persistencia ─────────────────────────────────────────────────────

    def _migrate_if_needed(self) -> None:
        path = _config_path()
        if not path.exists():
            # Boot fresh: sembrar predefinidos.
            doc = {"schemaVersion": SCHEMA_VERSION, "games": _default_predefined()}
            self._write(doc)
            return
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.error("games.json corrupto — reseteando con predefinidos")
            _backup_games_json(path)
            self._write({"schemaVersion": SCHEMA_VERSION, "games": _default_predefined()})
            return
        if not isinstance(raw, dict):
            return

        # MARU original: {custom_games, game_configs, entity_images}.
        if _looks_like_maru_format(raw):
            _backup_games_json(path)
            log.info("Migrando games.json: formato MARU original → schema v2")
            new_doc = _migrate_maru_to_v2(raw)
            self._write(new_doc)
            return

        # F0-F8 schema (sin "games" wrapper, solo {<gid>: {host,port,password}}).
        if _looks_like_old_f08_schema(raw):
            _backup_games_json(path)
            log.info("Migrando games.json: F0-F8 → schema v2")
            new_doc = _migrate_f08_to_v2(raw)
            self._write(new_doc)
            return

        # Schema v2 ya — asegurar que los predefinidos estén presentes Y
        # que tengan los flags actuales (hasEntities/Items/Events).
        # Los standards SOLO tienen 3 categorías (entities/items/events),
        # NUNCA valuables (paridad MARU `gui/constants.py:GAME_FEATURES`).
        # Versiones viejas del sidecar pueden haber guardado flags
        # incorrectos; forzamos sync sin pisar connection/name/icon.
        games = raw.get("games") or {}
        if not isinstance(games, dict):
            games = {}
            raw["games"] = games
        defaults = _default_predefined()
        changed = False
        STD_FLAG_KEYS = (
            "hasEntities",
            "hasItems",
            "hasEvents",
            "hasValuables",
        )
        for gid, default_profile in defaults.items():
            if gid not in games:
                games[gid] = default_profile
                changed = True
                continue
            existing = games[gid]
            if not isinstance(existing, dict):
                games[gid] = default_profile
                changed = True
                continue
            # Sincronizar flags de categorías SOLO en standards
            # (los custom respetan lo que el usuario configuró).
            if not existing.get("isStandard"):
                # Marcar como standard si está en defaults pero perdió el flag.
                if existing.get("isStandard") is None:
                    existing["isStandard"] = True
                    changed = True
                else:
                    continue
            for k in STD_FLAG_KEYS:
                if existing.get(k) != default_profile.get(k):
                    existing[k] = default_profile[k]
                    changed = True
            # tabNames de standards: mantener lo que el usuario renombró
            # PERO purgar keys que no son las 3 oficiales (entities/items/events).
            tabs = existing.get("tabNames") or {}
            if isinstance(tabs, dict):
                allowed = {"entities", "items", "events"}
                clean_tabs = {
                    k: v for k, v in tabs.items() if k in allowed and isinstance(v, str)
                }
                # Rellenar faltantes con default.
                for k, v in default_profile["tabNames"].items():
                    if k not in clean_tabs:
                        clean_tabs[k] = v
                if clean_tabs != tabs:
                    existing["tabNames"] = clean_tabs
                    changed = True
        if "schemaVersion" not in raw:
            raw["schemaVersion"] = SCHEMA_VERSION
            changed = True
        if changed:
            self._write(raw)

    def _read(self) -> dict[str, Any]:
        path = _config_path()
        if not path.exists():
            return {"schemaVersion": SCHEMA_VERSION, "games": {}}
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.error("games.json corrupto al leer — devolviendo predefinidos")
            return {"schemaVersion": SCHEMA_VERSION, "games": _default_predefined()}
        if not isinstance(raw, dict) or "games" not in raw:
            return {"schemaVersion": SCHEMA_VERSION, "games": _default_predefined()}
        return raw

    def _write(self, doc: dict[str, Any]) -> None:
        path = _config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
