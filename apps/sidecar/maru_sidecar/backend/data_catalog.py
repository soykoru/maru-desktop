"""Adapter `data.*` — catálogo entidades / items / eventos / valuables (G5).

Persistencia: `data/data_<gameId>.json` con shape canónico:
  {
    "entities":  [{"name", "command", "imagePath?", "meta?"}, ...],
    "items":     [...],
    "events":    [...],
    "valuables": [...],         # solo REPO (custom games puede agregarlos)
    "<custom>":  [...],         # categorías declaradas por CustomGameDialog
    "updatedAt": <ms>
  }

Mejoras sobre el F0-F8:
  - `gameId` ya no está hardcoded a 4 valores → soporta los N customs de G4.
  - `kind` ya no está hardcoded a 3 → permite valuables y categorías custom.
  - Migración automática del formato MARU original (lista de strings
    `"NombreVisible:Comando"`) al objeto canónico.
  - `imagePath` opcional por entry — relativo `game/<gid>/<cat>/<file>.png`,
    consumido por `<MaruImage scope="game">`.
  - Lookup integrado de tutorial desde `games.json[gid].categories`.

Réplica de:
  - `data_dialog.py` (DataDialog list/upsert/delete + scan PNG dir).
  - `entity_selector.py` (lectura `all_categories` con tabs).
  - `core/rule_engine.py:parse_entry` (formato `"Display:Cmd"`).
"""

from __future__ import annotations

import json
import re
import threading
import time
from pathlib import Path
from typing import Any

from ..logger import get_logger
from ..runtime import BUNDLE_GAME_IMAGES_DIR, DATA_DIR
from .backups import BackupService

log = get_logger(__name__)

STANDARD_KINDS: tuple[str, ...] = ("entities", "items", "events", "valuables")
_GID_RE = re.compile(r"^(?!\d+$)[a-zA-Z0-9_]{2,32}$")
_KIND_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_-]{0,31}$")


def _validate_game(g: Any) -> str:
    if not isinstance(g, str):
        raise TypeError("gameId requerido")
    g = g.strip()
    if not _GID_RE.match(g):
        raise ValueError(f"gameId inválido: {g!r}")
    return g


def _validate_kind(k: Any) -> str:
    if not isinstance(k, str):
        raise TypeError("kind requerido")
    k = k.strip()
    if not _KIND_RE.match(k):
        raise ValueError(f"kind inválido: {k!r}")
    return k


def parse_legacy_entry(s: str) -> dict[str, str] | None:
    """Convierte `"Display:Cmd"` → `{name, command}`.

    Espejo de `core/rule_engine.py:parse_entry`. Devuelve None si el
    string es vacío. Si no hay `:`, asume `name == command`.
    """
    if not isinstance(s, str):
        return None
    s = s.strip()
    if not s:
        return None
    if ":" in s:
        name, cmd = s.split(":", 1)
        name = name.strip()
        cmd = cmd.strip()
    else:
        name = s
        cmd = s
    if not name or not cmd:
        return None
    return {"name": name, "command": cmd}


def _normalize_entry(e: Any) -> dict[str, Any]:
    """Coerce una entry a shape canónico {name, command, imagePath?, meta?}.

    Acepta tanto el formato canónico como el legacy (string `"X:Y"`),
    para que `data.import` pueda consumir directo el JSON del MARU
    original.
    """
    if isinstance(e, str):
        parsed = parse_legacy_entry(e)
        if parsed is None:
            raise ValueError("entry string vacía o malformada")
        return parsed
    if not isinstance(e, dict):
        raise TypeError("entry debe ser objeto o string 'Display:Cmd'")

    name = e.get("name")
    command = e.get("command")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("entry.name requerido")
    if not isinstance(command, str) or not command.strip():
        raise ValueError("entry.command requerido")

    out: dict[str, Any] = {"name": name.strip(), "command": command.strip()}
    image_path = e.get("imagePath") or e.get("image_path")
    if isinstance(image_path, str) and image_path.strip():
        out["imagePath"] = image_path.strip()
    meta = e.get("meta")
    if isinstance(meta, dict):
        out["meta"] = {str(k): str(v) for k, v in meta.items()}
    return out


def _detect_legacy_list(raw: Any) -> bool:
    """¿Es una lista de strings `"Display:Cmd"` (formato MARU original)?"""
    if not isinstance(raw, list) or not raw:
        return False
    return all(isinstance(x, str) for x in raw)


def _bundle_image_for(gid: str, kind: str, command: str) -> str | None:
    """Buscar PNG `game_images/<gid>/<kind>/<cmd>.png` en bundle.

    Devuelve path relativo `game/<gid>/<kind>/<file>` o None si no existe.
    Solo busca con extensión `.png` — el bundle no usa otras.
    """
    if not (gid and kind and command):
        return None
    candidate = BUNDLE_GAME_IMAGES_DIR / gid / kind / f"{command}.png"
    if candidate.is_file():
        return f"game/{gid}/{kind}/{candidate.name}"
    return None


# Tutoriales hardcoded para los juegos standards (paridad MARU original
# `gui/dialogs/data_dialog.py:_get_instructions`). Los customs traen su
# `tutorial` en `games.json[gid].categories[*].tutorial`.
_STANDARD_TUTORIAL: dict[tuple[str, str], str] = {
    ("valheim", "entities"): (
        "📝 VALHEIM ENTIDADES\n\n"
        "Formato: NombreVisible:Prefab\n\n"
        "Ejemplos:\n"
        "• Troll Furioso:Troll\n"
        "• Lobo:Wolf\n"
        "• Esqueleto:Skeleton\n"
        "• Jabalí:Boar\n\n"
        "Endpoint del mod: POST /spawn"
    ),
    ("valheim", "items"): (
        "📝 VALHEIM ITEMS\n\n"
        "Formato: NombreVisible:Prefab\n\n"
        "Ejemplos:\n"
        "• Espada Hierro:SwordIron\n"
        "• Monedas:Coins\n"
        "• Hidromiel Curativo:MeadHealthMedium\n\n"
        "Endpoint: POST /spawn (mismo que entidades)"
    ),
    ("valheim", "events"): (
        "📝 VALHEIM EVENTOS\n\n"
        "Formato: NombreVisible:Comando\n\n"
        "Ejemplos:\n"
        "• Matar:kill_player\n"
        "• Curar:heal_player\n"
        "• Día:set_day\n"
        "• Noche:set_night\n"
        "• Raid Trolls:foresttrolls\n"
        "• Vaciar inventario:clear_inventory\n\n"
        "Endpoint: POST /event"
    ),
    ("terraria", "entities"): (
        "📝 TERRARIA ENTIDADES\n\n"
        "Formato: NombreVisible:NPC_ID\n\n"
        "Ejemplos:\n"
        "• Ojo Cthulhu:EyeofCthulhu\n"
        "• Rey Slime:KingSlime\n"
        "• Esqueletrón:SkeletronHead\n"
        "• Slime Azul:BlueSlime\n\n"
        "Endpoint: POST /spawn/"
    ),
    ("terraria", "items"): (
        "📝 TERRARIA ITEMS\n\n"
        "Formato: NombreVisible:ItemID\n\n"
        "Ejemplos:\n"
        "• Zenith:Zenith\n"
        "• Meowmere:Meowmere\n"
        "• Terra Blade:TerraBlade\n\n"
        "Endpoint: POST /spawn/ (mismo que entidades)"
    ),
    ("terraria", "events"): (
        "📝 TERRARIA COMANDOS\n\n"
        "Formato: NombreVisible:comando\n\n"
        "Comandos disponibles:\n"
        "• kill - Matar al jugador\n"
        "• heal - Curación completa\n"
        "• clear - Borrar inventario\n"
        "• godmode - Alternar invencibilidad\n"
        "• clearitems - Borrar items del suelo\n"
        "• clearnpcs - Borrar NPCs hostiles\n"
        "• time day / time night - Cambiar tiempo\n"
        "• tp - Teleportar al spawn\n\n"
        "Endpoint: POST /command/"
    ),
    ("minecraft", "entities"): (
        "📝 MINECRAFT - Comandos RCON\n\n"
        "Para entidades usá comandos summon directamente.\n\n"
        "Variables: {user} o {username} = nombre del viewer\n\n"
        "Ejemplo:\n"
        "  Nombre: Zombie Agradecimiento\n"
        "  Comando: execute at @p run summon zombie ~ ~1 ~"
    ),
    ("minecraft", "items"): (
        "📝 MINECRAFT - Items via RCON\n\n"
        "Comandos give con templating:\n\n"
        "Ejemplos:\n"
        "  Nombre: Diamante\n"
        "  Comando: give @a minecraft:diamond 1\n\n"
        "Variables: {user} = viewer · {amount} = cantidad"
    ),
    ("minecraft", "events"): (
        "📝 MINECRAFT - Eventos via RCON\n\n"
        "Cualquier comando RCON funciona.\n\n"
        "Variables: {user} o {username} = nombre del viewer\n"
        "Soporta múltiples comandos (uno por línea):\n\n"
        "Ejemplo:\n"
        "  execute at @p run summon zombie ~ ~1 ~\n"
        '  execute run title @a title \"GRACIAS {user}\"'
    ),
}


class DataService:
    def __init__(self, data_dir: Path = DATA_DIR, backups: BackupService | None = None) -> None:
        self._data_dir = data_dir
        self._lock = threading.Lock()
        self._backups = backups or BackupService(data_dir=data_dir)
        data_dir.mkdir(parents=True, exist_ok=True)

    def _data_path(self, game_id: str) -> Path:
        return self._data_dir / f"data_{game_id}.json"

    # ── API pública ──────────────────────────────────────────────────────

    def list(self, params: dict[str, Any]) -> dict[str, Any]:
        gid = _validate_game(params.get("gameId"))
        kind = _validate_kind(params.get("kind"))
        query = params.get("query")
        all_entries = self._read(gid).get(kind, [])

        # Resolver imagePath ausente vía bundle (read-only — no muta disco).
        for e in all_entries:
            if not e.get("imagePath"):
                hit = _bundle_image_for(gid, kind, e.get("command", ""))
                if hit:
                    e["imagePath"] = hit

        if isinstance(query, str) and query.strip():
            q = query.strip().lower()
            entries = [
                e for e in all_entries
                if q in e.get("name", "").lower()
                or q in e.get("command", "").lower()
            ]
        else:
            entries = all_entries

        # Dedupe defensivo por nombre (último gana — paridad MARU permisivo).
        seen: dict[str, dict[str, Any]] = {}
        for e in entries:
            seen[e.get("name", "")] = e
        return {"entries": list(seen.values()), "total": len(all_entries)}

    def upsert(self, params: dict[str, Any]) -> dict[str, Any]:
        gid = _validate_game(params.get("gameId"))
        kind = _validate_kind(params.get("kind"))
        entry = _normalize_entry(params.get("entry"))
        previous = params.get("previousName")
        with self._lock:
            self._maybe_backup(gid)
            doc = self._read(gid)
            entries = doc.setdefault(kind, [])
            target_name = previous if isinstance(previous, str) else entry["name"]
            idx = next(
                (i for i, e in enumerate(entries) if e.get("name") == target_name),
                -1,
            )
            if idx >= 0:
                entries[idx] = entry
            else:
                entries.append(entry)
            self._write_atomic(gid, doc)
        return {"entry": entry}

    def delete(self, params: dict[str, Any]) -> dict[str, Any]:
        gid = _validate_game(params.get("gameId"))
        kind = _validate_kind(params.get("kind"))
        name = params.get("name")
        if not isinstance(name, str):
            raise TypeError("name requerido")
        with self._lock:
            self._maybe_backup(gid)
            doc = self._read(gid)
            entries = doc.get(kind, [])
            doc[kind] = [e for e in entries if e.get("name") != name]
            self._write_atomic(gid, doc)
        return {"ok": True}

    def import_(self, params: dict[str, Any]) -> dict[str, Any]:
        gid = _validate_game(params.get("gameId"))
        kind = _validate_kind(params.get("kind"))
        entries = params.get("entries")
        replace = bool(params.get("replace"))
        if not isinstance(entries, list):
            raise TypeError("entries debe ser lista")
        normalized = [_normalize_entry(e) for e in entries]
        with self._lock:
            self._maybe_backup(gid)
            doc = self._read(gid)
            existing = [] if replace else doc.get(kind, [])
            by_name = {e.get("name"): e for e in existing}
            added = 0
            for e in normalized:
                if e["name"] not in by_name:
                    added += 1
                by_name[e["name"]] = e
            doc[kind] = list(by_name.values())
            self._write_atomic(gid, doc)
        return {"added": added, "total": len(doc[kind])}

    def export(self, params: dict[str, Any]) -> dict[str, Any]:
        gid = _validate_game(params.get("gameId"))
        kind = _validate_kind(params.get("kind"))
        entries = self._read(gid).get(kind, [])
        return {"entries": entries}

    def tutorial(self, params: dict[str, Any]) -> dict[str, Any]:
        """Lee `games.json[gid].categories[?id==kind].tutorial`.

        Para customs: lee del JSON. Para standards (valheim/terraria/
        minecraft) que no tienen `categories`, usa los tutoriales
        hardcoded del MARU original (`gui/dialogs/data_dialog.py:570-609`).
        """
        gid = _validate_game(params.get("gameId"))
        kind_raw = params.get("kind")
        kind = _validate_kind(kind_raw) if kind_raw else None
        games_path = self._data_dir / "games.json"
        if not games_path.exists():
            return {"text": _STANDARD_TUTORIAL.get((gid, kind or ""), "")}
        try:
            doc = json.loads(games_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {"text": _STANDARD_TUTORIAL.get((gid, kind or ""), "")}
        profile = (doc.get("games") or {}).get(gid)
        if not isinstance(profile, dict):
            return {"text": _STANDARD_TUTORIAL.get((gid, kind or ""), "")}
        cats = profile.get("categories") or []
        if isinstance(cats, list) and kind:
            for c in cats:
                if isinstance(c, dict) and (c.get("id") == kind or c.get("dataKey") == kind):
                    text = c.get("tutorial")
                    if isinstance(text, str) and text.strip():
                        return {"text": text}
        # Fallback a tutoriales hardcoded para standards (paridad MARU).
        return {"text": _STANDARD_TUTORIAL.get((gid, kind or ""), "")}

    def all_categories(self, params: dict[str, Any]) -> dict[str, Any]:
        """Devuelve TODAS las categorías de un juego con sus entries y label.

        Usado por `EntitySelectorDialog` para los tabs por categoría.
        Para juegos predefinidos arma las 3 estándar (entities/items/events)
        + valuables si tiene; para custom usa `categories` del GameProfile.
        """
        gid = _validate_game(params.get("gameId"))
        doc = self._read(gid)

        # Determinar las categorías "vivas" del juego.
        games_path = self._data_dir / "games.json"
        profile: dict[str, Any] | None = None
        if games_path.exists():
            try:
                gdoc = json.loads(games_path.read_text(encoding="utf-8"))
                profile = (gdoc.get("games") or {}).get(gid)
            except json.JSONDecodeError:
                profile = None

        result: dict[str, dict[str, Any]] = {}

        def _add(cat_id: str, label: str) -> None:
            entries = doc.get(cat_id, [])
            if not isinstance(entries, list):
                entries = []
            for e in entries:
                if isinstance(e, dict) and not e.get("imagePath"):
                    hit = _bundle_image_for(gid, cat_id, e.get("command", ""))
                    if hit:
                        e["imagePath"] = hit
            result[cat_id] = {"label": label, "entries": entries}

        if profile and not profile.get("isStandard") and profile.get("categories"):
            for c in profile["categories"]:
                if isinstance(c, dict) and c.get("id"):
                    _add(c["id"], c.get("name") or c["id"].title())
        else:
            tab_names = (profile or {}).get("tabNames") or {}
            if not profile or profile.get("hasEntities", True):
                _add("entities", tab_names.get("entities") or "🐉 Entidades")
            if not profile or profile.get("hasItems", True):
                _add("items", tab_names.get("items") or "📦 Items")
            if not profile or profile.get("hasEvents", False):
                _add("events", tab_names.get("events") or "⚡ Eventos")
            # valuables: solo si hay entries en disco (REPO).
            if doc.get("valuables"):
                _add("valuables", "💎 Valuables")

        return {"categories": result}

    # ── Internals ────────────────────────────────────────────────────────

    def _read(self, gid: str) -> dict[str, list[dict[str, Any]]]:
        p = self._data_path(gid)
        if not p.exists():
            return {k: [] for k in STANDARD_KINDS}
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.error("data_%s.json corrupto — devolviendo {}", gid)
            return {k: [] for k in STANDARD_KINDS}
        if not isinstance(doc, dict):
            return {k: [] for k in STANDARD_KINDS}

        # Migración legacy: cualquier kind que tenga lista de strings →
        # convertir a objetos. NO persiste hasta el próximo upsert/import.
        migrated_any = False
        for k, raw in list(doc.items()):
            if k == "updatedAt":
                continue
            if _detect_legacy_list(raw):
                converted = []
                for s in raw:
                    parsed = parse_legacy_entry(s)
                    if parsed:
                        converted.append(parsed)
                doc[k] = converted
                migrated_any = True

        if migrated_any:
            log.info("data_%s.json: convertidas entries legacy 'X:Y' → objetos", gid)
            try:
                self._maybe_backup(gid)
                self._write_atomic(gid, doc)
            except Exception as exc:  # pragma: no cover
                log.warning("no pude persistir migración legacy de %s: %s", gid, exc)

        # Garantizar las kinds estándar aunque no estén.
        for k in STANDARD_KINDS:
            doc.setdefault(k, [])
        return doc

    def _write_atomic(self, gid: str, doc: dict[str, Any]) -> None:
        p = self._data_path(gid)
        doc["updatedAt"] = int(time.time() * 1000)
        tmp = p.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(p)

    def _maybe_backup(self, gid: str) -> None:
        if not self._data_path(gid).exists():
            return
        try:
            self._backups.create("data", label=f"auto: pre-edit {gid}")
        except FileNotFoundError:
            pass
        except Exception as exc:
            log.warning("backup automático de data falló: %s", exc)
