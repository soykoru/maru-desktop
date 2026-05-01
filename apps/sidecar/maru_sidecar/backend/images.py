"""Servicio de imágenes (G2.3).

Réplica precisa de:
  - `gui/views/images.py:_build_image_index`        (pre-index al boot)
  - `gui/views/images.py:_get_entity_icon`          (lookup con variantes)
  - `gui/views/images.py:_resolve_gift_images`      (resolver paths gifts)
  - `gui/widgets/image_cache.py:find_entity_image`  (variantes de nombre)
  - `gui/widgets/default_images.py:get_default_for_category`

Diferencia con el original (mejora):
  - Paths que devuelve son **relativos** al bundle (`donaciones/Rose.png`,
    `game_images/valheim/entities/Boar.png`). El renderer los pasa a
    `<MaruImage scope=... path=...>` que resuelve al custom protocol.
  - LRU cache O(1) en memoria (`_icon_path_cache`).
  - Single source of truth para 415 gifts + 2.141 entity images + 7
    triggers + 276 templates + 33 defaults por categoría.

Expuesto por JSON-RPC:
  - images.lookupEntity(gameId, category, entry) → relativePath
  - images.lookupGift(giftId) → relativePath
  - images.lookupTrigger(triggerType) → relativePath
  - images.getDefault(gameId, category) → relativePath
  - images.stats() → dict con counts y cache size
"""

from __future__ import annotations

import re
from collections import OrderedDict
from pathlib import Path
from typing import Final

from maru_sidecar.runtime import (
    BUNDLE_DONACIONES_DIR,
    BUNDLE_GAME_IMAGES_DIR,
    BUNDLE_TEMPLATES_DIR,
    BUNDLE_TRIGGERS_DIR,
    USERDATA_DONACIONES_DIR,
    USERDATA_GAME_IMAGES_DIR,
)
from maru_sidecar.logger import get_logger

log = get_logger(__name__)

# ──────────────────────────────────────────────────────────────────────────
# Image extensions soportadas (espejo del original).
# ──────────────────────────────────────────────────────────────────────────
_IMG_EXTS: Final[tuple[str, ...]] = (".png", ".jpg", ".jpeg", ".webp")

# Tamaño del LRU cache para lookups frecuentes.
_LOOKUP_CACHE_MAX: Final[int] = 1000

# Sufijos típicos del sistema operativo cuando hay duplicados:
#   "Rose (1).png", "Rose (2).png", "Rose_2.png", "Rose - copia.png"
_DUP_SUFFIX_RE: Final[re.Pattern[str]] = re.compile(
    r"\s*(?:[\(\[]\d+[\)\]]|_\d+|-\s*copia|\s*-\s*copy)\s*$",
    re.IGNORECASE,
)


def _canonical_stem(stem: str) -> str:
    """Devuelve el stem "limpio" sin sufijos de duplicado.

    Ejemplos:
      "TikTok (2)"   → "TikTok"
      "Rose [3]"     → "Rose"
      "Heart_Me_2"   → "Heart_Me"
      "Rose - copia" → "Rose"
      "Rose"         → "Rose"

    Mantiene el casing y los espacios originales — la versión `lower()`
    se indexa por separado.
    """
    return _DUP_SUFFIX_RE.sub("", stem or "").strip()


def parse_entry(entry: str) -> tuple[str, str]:
    """Parsear `'NombreVisible:Comando'` o `'Comando'`.

    Réplica de `core/rule_engine.py:parse_entry`. Mantenemos la copia
    aquí para no depender del bridge a `core/` en el lookup de imágenes.
    """
    if not entry:
        return "", ""
    e = str(entry).strip()
    if ":" in e:
        name, cmd = e.split(":", 1)
        return name.strip(), cmd.strip()
    return e, e


def _strip_emoji(text: str) -> str:
    """Quitar caracteres no-alfanum-no-space para comparar nombres.

    Espejo de `gui/widgets/image_cache.py:strip_emoji`. Importante:
    NO hace lower — preserva casing original.
    """
    return "".join(c for c in (text or "") if c.isalnum() or c.isspace()).strip()


def _build_name_variants(cmd: str, display: str) -> list[str]:
    """Genera las variantes del nombre que se prueban en lookup.

    Espejo del bloque que arma candidates en `_get_entity_icon` +
    `find_entity_image` del original.

    Devuelve lista ordenada (deduplicada) — los primeros se prueban
    antes. Cada variante después se combina con extensiones.
    """
    safe_cmd = (cmd or "").replace(":", "_").replace(" ", "_")
    clean_display = _strip_emoji(display)
    raw = [
        cmd,
        display,
        clean_display,
        (cmd or "").replace(" ", "_"),
        (display or "").replace(" ", "_"),
        clean_display.replace(" ", "_"),
        safe_cmd,
        safe_cmd.lower(),
        (cmd or "").lower(),
        (display or "").lower(),
        clean_display.lower(),
    ]
    seen: set[str] = set()
    out: list[str] = []
    for v in raw:
        v = (v or "").strip()
        if not v or v in seen:
            continue
        seen.add(v)
        out.append(v)
    return out


# ──────────────────────────────────────────────────────────────────────────
# ImageIndex — pre-build al boot
# ──────────────────────────────────────────────────────────────────────────


class ImageIndex:
    """Índice global de imágenes del bundle.

    Se construye una vez al boot del sidecar (`build()`) escaneando todo
    el árbol `BUNDLE_DATA_DIR/`. Después los lookups son O(1) contra los
    dicts internos.

    Estructura interna:
        _entity_index: {
            game_id: {
                category: {
                    "<filename_stem>": "game_images/<gid>/<cat>/<file>",
                    "<filename_stem_lower>": same,
                }
            }
        }
        _gift_index: {
            "<filename_stem>": "donaciones/<file>",
            "<filename_stem_lower>": same,
        }
        _trigger_index: {
            "<filename_stem>": "icons_triggers/<file>",  (e.g. "trigger_gift")
        }
        _template_index: {
            "<filename_stem>": "game_images/_templates/<file>",
            "<filename_stem_lower>": same,
        }
        _category_defaults: {
            (game_id, category): "game_images/<gid>/<cat>/_default_<cat>.png"
        }
    """

    def __init__(self) -> None:
        self._entity_index: dict[str, dict[str, dict[str, str]]] = {}
        self._gift_index: dict[str, str] = {}
        self._trigger_index: dict[str, str] = {}
        self._template_index: dict[str, str] = {}
        self._category_defaults: dict[tuple[str, str], str] = {}
        # LRU cache para lookups parametrizados.
        self._lookup_cache: OrderedDict[tuple[object, ...], str] = OrderedDict()
        self._built = False

    # ── Build ────────────────────────────────────────────────────────

    def build(self) -> None:
        """Escanear el bundle y popular los índices.

        Idempotente — se puede llamar varias veces sin efecto si ya fue
        construido. Para forzar rebuild, usar `rebuild()`.
        """
        if self._built:
            return
        self._scan_donaciones()
        self._scan_triggers()
        self._scan_game_images()
        self._scan_templates()
        self._built = True
        log.info(
            "ImageIndex built: %s gifts, %s triggers, %s game cats, %s templates",
            len(self._gift_index) // 2,  # /2 porque guardamos lower y casing
            len(self._trigger_index),
            sum(len(c) for g in self._entity_index.values() for c in g.values())
            // 2,
            len(self._template_index) // 2,
        )

    def rebuild(self) -> None:
        self._entity_index.clear()
        self._gift_index.clear()
        self._trigger_index.clear()
        self._template_index.clear()
        self._category_defaults.clear()
        self._lookup_cache.clear()
        self._built = False
        self.build()

    def _scan_donaciones(self) -> None:
        """Donaciones bundle + userdata (auto-descargados).

        Indexa cada PNG por:
          - stem original + lower()             (match exacto)
          - stem canonical + lower()            (sin sufijo `(N)`)
          - stem con underscore↔espacio swap    (`Heart_Me` ↔ `Heart Me`)

        El stem CANONICAL (sin sufijo) solo se registra si no había ya
        un archivo "limpio" con ese mismo nombre — preferimos el original
        antes que el duplicado.
        """
        for base in (USERDATA_DONACIONES_DIR, BUNDLE_DONACIONES_DIR):
            if not base.exists():
                continue
            # Pasada 1: stems "limpios" (sin sufijo de duplicado).
            for f in base.iterdir():
                if not (f.is_file() and f.suffix.lower() in _IMG_EXTS):
                    continue
                stem = f.stem
                if _canonical_stem(stem) != stem:
                    continue  # se procesa en pasada 2
                rel = self._rel_donaciones_path(f)
                self._register_gift_keys(stem, rel)
            # Pasada 2: stems con sufijo, solo registran canonical si no había.
            for f in base.iterdir():
                if not (f.is_file() and f.suffix.lower() in _IMG_EXTS):
                    continue
                stem = f.stem
                canonical = _canonical_stem(stem)
                if canonical == stem:
                    continue  # ya se procesó en pasada 1
                rel = self._rel_donaciones_path(f)
                # Su propio stem siempre se registra (el archivo existe con ese nombre).
                self._register_gift_keys(stem, rel)
                # Y el canonical, solo si no había uno limpio antes.
                self._register_gift_keys(canonical, rel, only_if_missing=True)

    def _register_gift_keys(
        self,
        stem: str,
        rel: str,
        *,
        only_if_missing: bool = False,
    ) -> None:
        """Registrar todas las variantes del stem en `_gift_index`.

        Variantes: stem, stem.lower(), stem con underscores↔espacios.
        """
        if not stem:
            return
        variants = {
            stem,
            stem.lower(),
            stem.replace("_", " "),
            stem.replace("_", " ").lower(),
            stem.replace(" ", "_"),
            stem.replace(" ", "_").lower(),
        }
        for v in variants:
            if not v:
                continue
            if only_if_missing and v in self._gift_index:
                continue
            # Si NO es only_if_missing, sobreescribe — la primera carpeta en
            # el orden (USERDATA primero) tiene prioridad por iteración natural.
            if v not in self._gift_index:
                self._gift_index[v] = rel

    def _rel_donaciones_path(self, f: Path) -> str:
        """Convertir el Path absoluto a path relativo formato `donaciones/<file>`."""
        # Si está en bundle:
        if f.is_relative_to(BUNDLE_DONACIONES_DIR):
            return f"donaciones/{f.name}"
        # Si está en userdata: lo devolvemos como `donaciones/<file>` también
        # (el custom protocol lo busca primero en userdata, luego bundle).
        return f"donaciones/{f.name}"

    def _scan_triggers(self) -> None:
        if not BUNDLE_TRIGGERS_DIR.exists():
            return
        for f in BUNDLE_TRIGGERS_DIR.iterdir():
            if not (f.is_file() and f.suffix.lower() in _IMG_EXTS):
                continue
            rel = f"triggers/{f.name}"
            stem = f.stem  # ej: "trigger_gift"
            self._trigger_index[stem] = rel
            self._trigger_index[stem.lower()] = rel
            # También indexar el "tipo" sin prefijo: "gift" → trigger_gift.png
            if stem.startswith("trigger_"):
                short = stem[len("trigger_") :]
                self._trigger_index[short] = rel
                self._trigger_index[short.lower()] = rel

    def _scan_game_images(self) -> None:
        # Escaneamos AMBAS dirs: bundle (read-only del .exe) y userdata
        # (writable, donde el user agrega imágenes custom). Userdata
        # tiene PRIORIDAD: si el user subió una imagen para un entry,
        # debe sobreescribir la del bundle.
        # Orden importa: primero bundle, luego userdata para que las
        # del user pisen las del bundle en el dict.
        for base_dir in (BUNDLE_GAME_IMAGES_DIR, USERDATA_GAME_IMAGES_DIR):
            if not base_dir.exists():
                continue
            for game_dir in base_dir.iterdir():
                if not game_dir.is_dir():
                    continue
                if game_dir.name == "_templates":
                    continue  # se maneja en _scan_templates
                game_id = game_dir.name
                self._entity_index.setdefault(game_id, {})
                for cat_dir in game_dir.iterdir():
                    if not cat_dir.is_dir():
                        continue
                    cat = cat_dir.name
                    cat_map = self._entity_index[game_id].setdefault(cat, {})
                    for f in cat_dir.iterdir():
                        if not (f.is_file() and f.suffix.lower() in _IMG_EXTS):
                            continue
                        rel = f"game/{game_id}/{cat}/{f.name}"
                        if f.stem.startswith("_default_"):
                            # _default_<cat>.png → registrar como default de categoría.
                            self._category_defaults[(game_id, cat)] = rel
                            continue
                        cat_map[f.stem] = rel
                        cat_map[f.stem.lower()] = rel

    def _scan_templates(self) -> None:
        if not BUNDLE_TEMPLATES_DIR.exists():
            return
        for f in BUNDLE_TEMPLATES_DIR.iterdir():
            if not (f.is_file() and f.suffix.lower() in _IMG_EXTS):
                continue
            rel = f"templates/{f.name}"
            self._template_index[f.stem] = rel
            self._template_index[f.stem.lower()] = rel

    # ── LRU cache helpers ────────────────────────────────────────────

    def _cache_get(self, key: tuple[object, ...]) -> str | None:
        v = self._lookup_cache.get(key)
        if v is not None:
            self._lookup_cache.move_to_end(key)
        return v

    def _cache_set(self, key: tuple[object, ...], value: str) -> None:
        if len(self._lookup_cache) >= _LOOKUP_CACHE_MAX:
            self._lookup_cache.popitem(last=False)
        self._lookup_cache[key] = value

    # ── Public lookups ───────────────────────────────────────────────

    def lookup_entity(
        self,
        game_id: str,
        category: str,
        entry: str,
    ) -> str:
        """Lookup de icono para entity/item/event/valuable/equipment.

        Espejo de `gui/views/images.py:_get_entity_icon`. Probar variantes
        en orden:
          1. Cache hit.
          2. Categoría del juego: variantes de cmd y display.
          3. Templates: variantes de cmd y display.
          4. Default de categoría: `_default_<cat>.png`.
          5. Fallback: triggers/trigger_gift.png (último recurso).
        """
        key = ("entity", game_id, category, entry)
        cached = self._cache_get(key)
        if cached is not None:
            return cached

        if not self._built:
            self.build()

        display, cmd = parse_entry(entry)
        variants = _build_name_variants(cmd, display)

        # 1) game_images/<gid>/<cat>/<variant>.png
        cat_map = self._entity_index.get(game_id, {}).get(category, {})
        for v in variants:
            hit = cat_map.get(v) or cat_map.get(v.lower())
            if hit:
                self._cache_set(key, hit)
                return hit

        # 2) templates (assets genéricos reusables).
        for v in variants:
            hit = self._template_index.get(v) or self._template_index.get(v.lower())
            if hit:
                self._cache_set(key, hit)
                return hit

        # 3) Default de la categoría.
        default = self._category_defaults.get((game_id, category))
        if default:
            self._cache_set(key, default)
            return default

        # 4) Fallback de último recurso.
        fallback = self._trigger_index.get("trigger_gift", "triggers/trigger_gift.png")
        self._cache_set(key, fallback)
        return fallback

    def lookup_gift(self, gift_id: str) -> str:
        """Lookup de PNG de un gift por su ID.

        Espejo de `gui/views/images.py:_resolve_gift_images` (la parte de
        lookup, sin la mutación de gifts.json).
        """
        if not gift_id:
            return "donaciones/Rose_black_white.png"
        key = ("gift", gift_id)
        cached = self._cache_get(key)
        if cached is not None:
            return cached

        if not self._built:
            self.build()

        # Probar variantes case-insensitive + espacio/underscore + canonical.
        gid = gift_id.strip()
        canonical = _canonical_stem(gid)
        candidates = [
            gid,
            gid.lower(),
            gid.replace(" ", "_"),
            gid.replace(" ", "_").lower(),
            gid.replace("_", " "),
            gid.replace("_", " ").lower(),
            canonical,
            canonical.lower(),
            canonical.replace(" ", "_"),
            canonical.replace(" ", "_").lower(),
        ]
        seen: set[str] = set()
        for v in candidates:
            if v in seen:
                continue
            seen.add(v)
            hit = self._gift_index.get(v)
            if hit:
                self._cache_set(key, hit)
                return hit

        fallback = "donaciones/Rose_black_white.png"
        self._cache_set(key, fallback)
        return fallback

    def lookup_trigger(self, trigger_type: str) -> str:
        """Lookup de icono de trigger (gift/like/follow/etc)."""
        if not trigger_type:
            return "triggers/trigger_gift.png"
        if not self._built:
            self.build()
        key = trigger_type.lower().strip()
        return self._trigger_index.get(
            key,
            self._trigger_index.get(f"trigger_{key}", "triggers/trigger_gift.png"),
        )

    def get_default(self, game_id: str, category: str) -> str:
        """Default por (juego, categoría)."""
        if not self._built:
            self.build()
        return self._category_defaults.get(
            (game_id, category),
            "triggers/trigger_gift.png",
        )

    def stats(self) -> dict[str, object]:
        """Stats para debug / health endpoint."""
        return {
            "built": self._built,
            "gifts": len({v for v in self._gift_index.values()}),
            "triggers": len({v for v in self._trigger_index.values()}),
            "templates": len({v for v in self._template_index.values()}),
            "games": list(self._entity_index.keys()),
            "category_defaults": len(self._category_defaults),
            "cache_size": len(self._lookup_cache),
            "cache_max": _LOOKUP_CACHE_MAX,
        }


# ──────────────────────────────────────────────────────────────────────────
# ImagesService — fachada JSON-RPC
# ──────────────────────────────────────────────────────────────────────────


class ImagesService:
    """Fachada del servicio de imágenes para el `MethodRegistry`.

    Se construye una vez al boot del sidecar; el `registry` lo registra
    con prefijo `images.*`.
    """

    def __init__(self) -> None:
        self._index = ImageIndex()
        # Build lazy en el primer lookup, para no bloquear el arranque.
        # Si querés precargar, llamar `service.warmup()` en runtime.py.

    def warmup(self) -> None:
        """Forzar build del índice (uso opcional al arrancar)."""
        self._index.build()

    def lookup_entity(
        self, game_id: str, category: str, entry: str
    ) -> str:
        return self._index.lookup_entity(game_id, category, entry)

    def lookup_gift(self, gift_id: str) -> str:
        return self._index.lookup_gift(gift_id)

    def lookup_trigger(self, trigger_type: str) -> str:
        return self._index.lookup_trigger(trigger_type)

    def get_default(self, game_id: str, category: str) -> str:
        return self._index.get_default(game_id, category)

    def stats(self) -> dict[str, object]:
        return self._index.stats()

    def rebuild(self) -> dict[str, object]:
        """Forzar rescan del bundle (útil después de auto-descarga)."""
        self._index.rebuild()
        return self._index.stats()

    # ── RPC: subir imagen custom para entry / categoría ────────────────

    _SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_\- ]+$")

    def set_entry_image(self, params: dict[str, object]) -> dict[str, object]:
        """Copia una imagen del filesystem del usuario al
        `USERDATA_GAME_IMAGES_DIR/<gameId>/<category>/<command>.png`.

        Permite al user asignar un ícono custom a un entry (entity/item/
        event) desde el EntryEditForm. La imagen sobreescribe la del
        bundle si existe, gracias al merge de `_scan_game_images` que
        prioriza userdata.

        Params:
          - gameId: id del juego (alfanumérico).
          - category: carpeta de categoría (entities/items/events/valuables/
            o cat_id custom).
          - command: nombre del archivo destino sin extensión.
          - sourcePath: path absoluto al archivo origen (PNG/JPG/etc.).

        Devuelve `{ok, relPath}` con el path relativo `game/<gid>/<cat>/<file>.png`
        que el renderer puede pasar a `<MaruImage>`.
        """
        import shutil
        gid = str(params.get("gameId") or "").strip()
        cat = str(params.get("category") or "").strip()
        cmd = str(params.get("command") or "").strip()
        src = str(params.get("sourcePath") or "").strip()
        if not gid or not cat or not cmd:
            return {"ok": False, "message": "gameId/category/command requeridos"}
        if not src or not Path(src).is_file():
            return {"ok": False, "message": f"archivo origen no existe: {src}"}
        # Sanitización defensiva — evitar path traversal con ".." en
        # gameId/category/command.
        if (".." in gid or ".." in cat or ".." in cmd
                or "/" in gid or "/" in cat or "\\" in gid or "\\" in cat
                or "/" in cmd or "\\" in cmd):
            return {"ok": False, "message": "id/cat/command con caracteres inválidos"}
        ext = Path(src).suffix.lower()
        if ext not in _IMG_EXTS:
            return {"ok": False, "message": f"extensión {ext} no soportada"}
        # Destino: siempre como .png (los iconos del game scope
        # se buscan por stem, y png es el formato estándar).
        # Pero copiamos con la extensión original para no recodificar.
        target_dir = USERDATA_GAME_IMAGES_DIR / gid / cat
        target_dir.mkdir(parents=True, exist_ok=True)
        # Borrar variantes anteriores con MISMO stem para evitar dos
        # archivos del mismo entry con distintas extensiones (jpg + png).
        for old in target_dir.glob(f"{cmd}.*"):
            try:
                old.unlink()
            except Exception:
                pass
        target = target_dir / f"{cmd}{ext}"
        try:
            shutil.copyfile(src, target)
        except Exception as exc:
            return {"ok": False, "message": str(exc)}
        # Forzar rebuild del index para que el lookup encuentre la imagen.
        self._index.rebuild()
        return {
            "ok": True,
            "relPath": f"game/{gid}/{cat}/{target.name}",
        }

    def delete_entry_image(self, params: dict[str, object]) -> dict[str, object]:
        """Elimina la imagen custom del user (vuelve a usar la del
        bundle o el _default_<cat>.png si existe)."""
        gid = str(params.get("gameId") or "").strip()
        cat = str(params.get("category") or "").strip()
        cmd = str(params.get("command") or "").strip()
        if not gid or not cat or not cmd:
            return {"ok": False, "message": "gameId/category/command requeridos"}
        if (".." in gid or ".." in cat or ".." in cmd):
            return {"ok": False, "message": "id/cat/command con caracteres inválidos"}
        target_dir = USERDATA_GAME_IMAGES_DIR / gid / cat
        removed = 0
        for f in target_dir.glob(f"{cmd}.*"):
            try:
                f.unlink()
                removed += 1
            except Exception:
                pass
        if removed:
            self._index.rebuild()
        return {"ok": True, "removed": removed}


__all__ = [
    "ImageIndex",
    "ImagesService",
    "parse_entry",
]
