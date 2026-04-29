"""Adapter `donations.*` — catálogo visual de gifts (G3).

Replica fiel del schema MARU original. Mejoras sobre el original:
  - Migración automática F0-F8 → MARU real al boot (idempotente).
  - Migración paths absolutos → relativos (portabilidad multi-máquina).
  - `icon_path` siempre relativo: `donaciones/<filename>.png`.
  - Backup automático antes de cualquier migración destructiva.
  - `scan_folder` lee metadata `tEXt` del PNG (Gift-Name, Gift-Coins).
  - `import_from_folder` crea nuevas entries desde PNGs huérfanos.
  - Hook `on_gift_image_detected` para auto-descarga via TikTok worker.

Persistencia: `data/gifts.json`, shape:
    {
      "custom_gifts": {
        "<gift_id>": {
          "name": "Nombre traducido",
          "icon": "🌹",
          "coins": 1,
          "icon_path": "donaciones/<file>.png",
          "disabled": false
        }
      }
    }

`<gift_id>` preserva casing y espacios del nombre TikTok original
(`"Heart Me"`, `"Rose"`, `"You're awesome"`...). Esto es CRÍTICO porque
es la clave de matching contra los eventos de TikTokLive.

`receivedCount` (camelCase) es una mejora del repo nuevo (no estaba en
MARU): contador en RAM, se resetea con `donations.reset-counters`.
"""

from __future__ import annotations

import json
import shutil
import threading
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

from ..logger import get_logger
from ..runtime import (
    BACKUPS_DIR,
    BUNDLE_DONACIONES_DIR,
    DATA_DIR,
    USERDATA_DONACIONES_DIR,
)
from .gift_downloader import (
    GiftDownloader,
    backup_gifts_json_before_migration,
    migrate_absolute_paths_to_relative,
    normalize_gift_name,
    read_png_metadata,
    resolve_gift_images,
)

log = get_logger(__name__)

DEFAULT_PLACEHOLDER_REL = "donaciones/Rose_black_white.png"


def _looks_like_old_f08_schema(doc: dict[str, Any]) -> bool:
    """Detectar el schema inventado en F0-F8.

    F0-F8: `{ "<name>": {diamonds, command, imageUrl, ttsMessage, receivedCount} }`
    MARU:  `{ "custom_gifts": {"<id>": {name, icon, coins, icon_path, disabled}} }`
    """
    if not isinstance(doc, dict) or not doc:
        return False
    # Si tiene la key oficial, NO es F0-F8.
    if "custom_gifts" in doc:
        return False
    # Heurística: cualquier value que tenga `diamonds` o `imageUrl` es F0-F8.
    for v in doc.values():
        if isinstance(v, dict) and (
            "diamonds" in v or "imageUrl" in v or "ttsMessage" in v
        ):
            return True
    return False


def _migrate_f08_to_maru(old: dict[str, Any]) -> dict[str, Any]:
    """Convertir el schema F0-F8 al schema MARU real."""
    custom_gifts: dict[str, Any] = {}
    for name, body in old.items():
        if not isinstance(body, dict):
            continue
        custom_gifts[name] = {
            "name": name,
            "icon": "",
            "coins": int(body.get("diamonds") or 0),
            "icon_path": "",
            "disabled": False,
        }
    return {"custom_gifts": custom_gifts}


def _coerce_gift_entry(raw: Any, key: str) -> dict[str, Any] | None:
    """Coerce una entrada del JSON a shape canónico MARU."""
    if not isinstance(raw, dict):
        return None
    return {
        "name": str(raw.get("name") or key),
        "icon": str(raw.get("icon") or ""),
        "coins": int(raw.get("coins") or 0),
        "icon_path": str(raw.get("icon_path") or ""),
        "disabled": bool(raw.get("disabled", False)),
    }


def _entry_to_dto(gid: str, entry: dict[str, Any], counter: int) -> dict[str, Any]:
    """Convertir entry MARU a DTO TS (camelCase + receivedCount)."""
    return {
        "id": gid,
        "name": entry.get("name") or gid,
        "icon": entry.get("icon") or "",
        "coins": int(entry.get("coins") or 0),
        "iconPath": entry.get("icon_path") or "",
        "disabled": bool(entry.get("disabled", False)),
        "receivedCount": counter,
    }


def _dto_to_entry(gift: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Convertir DTO TS a (gid, entry MARU). Lanza ValueError si inválido."""
    gid = str(gift.get("id") or gift.get("name") or "").strip()
    if not gid:
        raise ValueError("gift.id requerido")
    entry = {
        "name": str(gift.get("name") or gid),
        "icon": str(gift.get("icon") or ""),
        "coins": int(gift.get("coins") or 0),
        "icon_path": str(gift.get("iconPath") or ""),
        "disabled": bool(gift.get("disabled", False)),
    }
    return gid, entry


class DonationsService:
    """Servicio de catálogo de donaciones, schema MARU real."""

    def __init__(self) -> None:
        self._path = DATA_DIR / "gifts.json"
        self._lock = threading.Lock()
        # Contador de gifts recibidos en sesión actual (ram-only, no persiste).
        self._received: Counter[str] = Counter()
        # Auto-descargador (G2.5).
        self._downloader = GiftDownloader()
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        USERDATA_DONACIONES_DIR.mkdir(parents=True, exist_ok=True)
        # Migraciones idempotentes al boot.
        self._migrate_if_needed()

    # ── RPC handlers ─────────────────────────────────────────────────────

    def list(self, params: dict[str, Any]) -> dict[str, Any]:
        include_disabled = bool(params.get("includeDisabled", True))
        with self._lock:
            doc = self._read()
            custom_gifts = doc.get("custom_gifts", {})
            gifts: list[dict[str, Any]] = []
            for gid, raw in custom_gifts.items():
                entry = _coerce_gift_entry(raw, gid)
                if not entry:
                    continue
                if not include_disabled and entry["disabled"]:
                    continue
                gifts.append(_entry_to_dto(gid, entry, self._received.get(gid, 0)))
        # Orden: visibles primero, luego por coins desc, luego por nombre.
        gifts.sort(
            key=lambda g: (
                bool(g["disabled"]),
                -int(g["coins"]),
                str(g["name"]).lower(),
            )
        )
        return {"gifts": gifts}

    def upsert(self, params: dict[str, Any]) -> dict[str, Any]:
        gift = params.get("gift")
        if not isinstance(gift, dict):
            raise TypeError("gift requerido")
        gid, entry = _dto_to_entry(gift)
        with self._lock:
            doc = self._read()
            custom_gifts = doc.setdefault("custom_gifts", {})
            custom_gifts[gid] = entry
            self._write(doc)
        return {
            "gift": _entry_to_dto(gid, entry, self._received.get(gid, 0))
        }

    def delete(self, params: dict[str, Any]) -> dict[str, Any]:
        gid = params.get("id") or params.get("name")
        if not isinstance(gid, str) or not gid:
            raise TypeError("id requerido")
        with self._lock:
            doc = self._read()
            custom_gifts = doc.get("custom_gifts", {})
            custom_gifts.pop(gid, None)
            self._received.pop(gid, None)
            self._write(doc)
        return {"ok": True}

    def reset_counters(self, _params: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self._received.clear()
        return {"ok": True}

    def scan_folder(self, _params: dict[str, Any]) -> dict[str, Any]:
        """Escanear `donaciones/` (bundle + userdata) y leer metadata `tEXt`.

        Réplica de `gifts_dialog.py:scan_donaciones_folder`. Devuelve un
        catálogo con `name` / `coins` extraídos del PNG cuando existen.
        """
        catalog: list[dict[str, Any]] = []
        seen: set[str] = set()
        # Userdata primero (más reciente), luego bundle.
        for d in (USERDATA_DONACIONES_DIR, BUNDLE_DONACIONES_DIR):
            if not d.exists():
                continue
            for f in sorted(d.iterdir()):
                if f.suffix.lower() != ".png" or f.name.startswith("_"):
                    continue
                if f.name in seen:
                    continue
                seen.add(f.name)
                meta = read_png_metadata(f)
                gift_name = meta.get("Gift-Name") or f.stem
                try:
                    coins = int(meta.get("Gift-Coins", "0") or 0)
                except ValueError:
                    coins = 0
                catalog.append(
                    {
                        "id": gift_name,
                        "name": gift_name,
                        "icon": "",
                        "coins": coins,
                        "iconPath": f"donaciones/{f.name}",
                        "disabled": False,
                        "receivedCount": 0,
                    }
                )
        catalog.sort(
            key=lambda g: (-int(g["coins"]), str(g["name"]).lower())
        )
        return {"catalog": catalog}

    def import_from_folder(self, params: dict[str, Any]) -> dict[str, Any]:
        """Importar gifts del catálogo de carpeta al `gifts.json`.

        - `overwriteExisting=False` (default): skip si ya existe el id.
        - `overwriteExisting=True`: sobreescribe `coins` y `icon_path`,
          conserva `name` traducido si ya existía.
        """
        overwrite = bool(params.get("overwriteExisting", False))
        catalog = self.scan_folder({})["catalog"]
        imported = 0
        updated = 0
        skipped = 0
        with self._lock:
            doc = self._read()
            custom_gifts = doc.setdefault("custom_gifts", {})
            for cat in catalog:
                gid = cat["id"]
                existing = custom_gifts.get(gid)
                if isinstance(existing, dict):
                    if not overwrite:
                        skipped += 1
                        continue
                    existing["coins"] = int(cat["coins"]) or int(
                        existing.get("coins") or 0
                    )
                    existing["icon_path"] = cat["iconPath"]
                    updated += 1
                else:
                    custom_gifts[gid] = {
                        "name": cat["name"],
                        "icon": "",
                        "coins": int(cat["coins"]),
                        "icon_path": cat["iconPath"],
                        "disabled": False,
                    }
                    imported += 1
            self._write(doc)
        return {"imported": imported, "updated": updated, "skipped": skipped}

    # ── Hooks no-RPC (consumidos por TikTok worker) ──────────────────────

    def on_gift_image_detected(
        self,
        gift_id: str,
        gift_name: str,
        image_url: str,
        coins: int,
    ) -> dict[str, Any]:
        """Pipeline auto-descarga + persistencia (G2.5 ↔ G3).

        El TikTok worker llama este método cuando recibe el evento
        `gift_image_detected`. Mutamos `custom_gifts` con el lock,
        delegamos descarga al GiftDownloader, y persistimos.

        Publica `gifts:updated` para que el frontend refresque la galería
        SIN polling (paridad con el reload manual del MARU original).
        """
        with self._lock:
            doc = self._read()
            custom_gifts = doc.setdefault("custom_gifts", {})
            result = self._downloader.detected(
                custom_gifts, gift_id, gift_name, image_url, coins
            )
            if result.get("action") in {"downloaded", "reactivated"}:
                self._write(doc)
                # Snapshot del gift recién agregado/reactivado para el push.
                action_kind = result.get("action")
                stored = custom_gifts.get(gift_id) or custom_gifts.get(
                    gift_name
                )
                event_payload = {
                    "action": action_kind,
                    "giftId": gift_id,
                    "giftName": gift_name,
                    "coins": int(coins or 0),
                    "gift": stored,
                }
                try:
                    from ..event_bus import get_event_bus
                    bus = get_event_bus()
                    bus.publish("gifts:updated", event_payload)
                    # log entry SINGLE-SOURCE (sidecar es el único que
                    # publica log:entry para gifts ahora — el frontend
                    # ya no genera duplicados sintéticos).
                    import time as _t
                    msg = (
                        f"🎁✅ Donación reactivada: {gift_name}"
                        if action_kind == "reactivated"
                        else f"🎁✨ Nueva donación detectada: {gift_name}"
                    )
                    bus.publish(
                        "log:entry",
                        {
                            "id": f"gu-{int(_t.time() * 1000)}-{gift_id[:8]}",
                            "ts": int(_t.time() * 1000),
                            "level": "INFO",
                            "source": "donations",
                            "category": "gift",
                            "message": msg,
                        },
                    )
                except Exception:
                    log.exception("no pude publicar gifts:updated")
        return result

    def increment_received(self, gift_id: str, count: int = 1) -> int:
        """Incrementar el contador de gifts recibidos en sesión."""
        gid = normalize_gift_name(gift_id)
        if not gid:
            return 0
        with self._lock:
            self._received[gid] += int(count or 1)
            return self._received[gid]

    # ── Internals ────────────────────────────────────────────────────────

    def _migrate_if_needed(self) -> None:
        """Aplicar migraciones idempotentes al boot.

        1) F0-F8 schema inventado → MARU real (`custom_gifts: {...}`).
        2) Paths absolutos viejos → paths relativos `donaciones/<file>`.
        3) Resolver `icon_path` vacíos contra carpetas userdata + bundle.
        """
        if not self._path.exists():
            return
        try:
            raw_doc = json.loads(self._path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.error("gifts.json corrupto al migrar — skip migración")
            return

        if not isinstance(raw_doc, dict):
            return

        changed = False
        backup_made = False

        # 1) F0-F8 → MARU
        if _looks_like_old_f08_schema(raw_doc):
            backup_gifts_json_before_migration(self._path)
            backup_made = True
            log.info("Migrando gifts.json: F0-F8 schema → MARU real")
            raw_doc = _migrate_f08_to_maru(raw_doc)
            changed = True

        # Asegurar key root.
        if "custom_gifts" not in raw_doc:
            raw_doc["custom_gifts"] = {}
            changed = True

        custom_gifts = raw_doc["custom_gifts"]
        if not isinstance(custom_gifts, dict):
            raw_doc["custom_gifts"] = {}
            custom_gifts = raw_doc["custom_gifts"]
            changed = True

        # 2) Paths absolutos → relativos.
        migrated_paths = migrate_absolute_paths_to_relative(custom_gifts)
        if migrated_paths > 0:
            if not backup_made:
                backup_gifts_json_before_migration(self._path)
                backup_made = True
            log.info(
                "Migrando gifts.json: %d paths absolutos → relativos",
                migrated_paths,
            )
            changed = True

        # 3) Resolver icon_path vacíos vs carpetas reales.
        if resolve_gift_images(custom_gifts):
            changed = True

        if changed:
            self._atomic_write(raw_doc)

    def _read(self) -> dict[str, Any]:
        if not self._path.exists():
            return {"custom_gifts": {}}
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.error("gifts.json corrupto — devolviendo vacío")
            return {"custom_gifts": {}}
        if not isinstance(data, dict):
            return {"custom_gifts": {}}
        if "custom_gifts" not in data or not isinstance(
            data["custom_gifts"], dict
        ):
            data["custom_gifts"] = {}
        return data

    def _write(self, doc: dict[str, Any]) -> None:
        self._atomic_write(doc)

    def _atomic_write(self, doc: dict[str, Any]) -> None:
        """Escritura atómica con tmp + rename (evita corrupción)."""
        tmp = self._path.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(doc, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        tmp.replace(self._path)
