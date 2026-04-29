"""Auto-descarga de PNGs de gifts en vivo (G2.5).

Réplica de:
  - `gui/views/images.py:_on_gift_image_detected` — pipeline completo.
  - `gui/views/images.py:_inject_png_metadata`     — chunks tEXt.
  - `gui/views/images.py:_resolve_gift_images`     — lookup paths al boot.
  - `gui/dialogs/gifts_dialog.py:_read_png_metadata` — lectura metadata.
  - migración paths absolutos → relativos en `gifts.json`.

Mejoras sobre el original:
  - Threading lock para deduplicar descargas concurrentes (mismo gift llega
    varias veces seguidas en streams concurridos).
  - Path relativo en `gifts.json` (vs absoluto del original) — permite
    portabilidad entre máquinas.
  - Backup automático de `gifts.json` antes de la migración.
  - Sanitización del filename (escape de caracteres no-fs-safe).
  - Throttled error log (no spammear si TikTok devuelve URLs rotas).

NO depende del bridge a `core/`. Es self-contained.
"""

from __future__ import annotations

import io
import re
import shutil
import struct
import threading
import zlib
from datetime import datetime
from pathlib import Path
from typing import Final

from maru_sidecar.logger import get_logger
from maru_sidecar.runtime import (
    BACKUPS_DIR,
    BUNDLE_DONACIONES_DIR,
    USERDATA_DONACIONES_DIR,
)

log = get_logger(__name__)

# Filename safe — alphanum + espacios + underscore + algunos signos.
_FILENAME_SAFE: Final[re.Pattern[str]] = re.compile(r"[^A-Za-z0-9_\- ]")

# Cuánto loggear errores antes de silenciar.
_ERROR_LOG_THRESHOLD: Final[int] = 5


# ──────────────────────────────────────────────────────────────────────────
# tEXt metadata helpers — espejo exacto del original
# ──────────────────────────────────────────────────────────────────────────


def read_png_metadata(filepath: Path | str) -> dict[str, str]:
    """Leer chunks `tEXt` del PNG.

    Espejo de `gui/dialogs/gifts_dialog.py:_read_png_metadata`. Returns
    diccionario `{key: value}` con `Gift-Name`, `Gift-Coins`, etc.
    """
    texts: dict[str, str] = {}
    try:
        with open(filepath, "rb") as f:
            f.read(8)  # PNG signature
            while True:
                raw = f.read(8)
                if len(raw) < 8:
                    break
                length = struct.unpack(">I", raw[:4])[0]
                chunk_type = raw[4:8].decode("ascii", errors="replace")
                data = f.read(length)
                f.read(4)  # CRC
                if chunk_type == "tEXt":
                    parts = data.split(b"\x00", 1)
                    if len(parts) == 2:
                        key = parts[0].decode("latin-1")
                        val = parts[1].decode("latin-1")
                        texts[key] = val
                elif chunk_type == "IEND":
                    break
    except OSError:
        pass
    return texts


def inject_png_metadata(png_data: bytes, metadata: dict[str, str]) -> bytes:
    """Inyectar chunks `tEXt` en un PNG.

    Espejo exacto de `gui/views/images.py:_inject_png_metadata`.
    Inserta los chunks ANTES del `IEND`.
    """
    iend_pos = png_data.rfind(b"IEND") - 4
    if iend_pos < 0:
        return png_data
    chunks: list[bytes] = []
    for key, value in metadata.items():
        text_data = (
            key.encode("latin-1") + b"\x00" + value.encode("latin-1")
        )
        chunk_type = b"tEXt"
        crc = zlib.crc32(chunk_type + text_data) & 0xFFFFFFFF
        chunk = (
            struct.pack(">I", len(text_data))
            + chunk_type
            + text_data
            + struct.pack(">I", crc)
        )
        chunks.append(chunk)
    return png_data[:iend_pos] + b"".join(chunks) + png_data[iend_pos:]


# ──────────────────────────────────────────────────────────────────────────
# Filename helpers
# ──────────────────────────────────────────────────────────────────────────


def safe_filename(name: str) -> str:
    """Sanitizar un nombre para usarlo como filename.

    Espejo del comportamiento del original (`replace(' ', '_').replace("'", "")`)
    + extra strict para evitar caracteres no-fs-safe.
    """
    n = (name or "").strip()
    n = n.replace("'", "").replace("'", "")
    n = _FILENAME_SAFE.sub("", n)
    n = n.strip().replace(" ", "_")
    return n[:120] or "gift"


def normalize_gift_name(name: str) -> str:
    """Normalizar el nombre del gift como hace el original.

    Espejo de `gui/views/images.py:_normalize_gift_name` (regla
    `re.sub(r'[\\x00-\\x1f]+', '', name).strip()` para limpiar caracteres
    de control + strip).
    """
    return re.sub(r"[\x00-\x1f]+", "", name or "").strip()


# ──────────────────────────────────────────────────────────────────────────
# Resolver paths al boot — pre-G2 lookup mejorado
# ──────────────────────────────────────────────────────────────────────────


def resolve_gift_images(custom_gifts: dict) -> bool:
    """Resolver `icon_path` de cada gift al path RELATIVO correcto.

    Espejo de `gui/views/images.py:_resolve_gift_images`, MEJORADO:
      - Devuelve paths **relativos** (`donaciones/<file>`) en vez de
        absolutos (que solo funcionan en la máquina del original).
      - Mira primero userdata (auto-descargados runtime), luego bundle.
      - Solo modifica gifts cuyo `icon_path` está vacío o roto.

    Mutación in-place de `custom_gifts`. Retorna True si hubo cambios
    (para que el caller decida si guardar).
    """
    img_map: dict[str, str] = {}

    def _scan_dir(d: Path) -> None:
        if not d.exists():
            return
        for f in d.iterdir():
            if f.suffix.lower() != ".png" or f.name.startswith("_"):
                continue
            stem = f.stem
            rel = f"donaciones/{f.name}"
            for k in (stem.lower(), stem.lower().replace("_", " ")):
                img_map.setdefault(k, rel)

    # Solo userdata — el bundle ya se copió al inicio via bootstrap.
    _scan_dir(USERDATA_DONACIONES_DIR)

    if not img_map:
        return False

    default_rel = "donaciones/Rose_black_white.png"
    changed = False

    for gid, gdata in custom_gifts.items():
        if not isinstance(gdata, dict):
            continue
        ip = gdata.get("icon_path", "") or ""
        # Si ya tiene path RELATIVO válido (donaciones/...) y NO es el placeholder, skip.
        if ip.startswith("donaciones/") and "Rose_black_white" not in ip:
            continue
        # Si tiene path absoluto del original (C:/Users/...) o vacío,
        # intentar matchear por gid o name.
        gl = (gid or "").lower()
        found = (
            img_map.get(gl)
            or img_map.get(gl.replace("_", " "))
            or img_map.get(gl.replace(" ", "_"))
        )
        if not found:
            name_l = (gdata.get("name", "") or "").lower()
            found = (
                img_map.get(name_l)
                or img_map.get(name_l.replace(" ", "_"))
                or img_map.get(name_l.replace("_", " "))
            )
        if found:
            if gdata.get("icon_path") != found:
                gdata["icon_path"] = found
                changed = True
        elif not ip:
            gdata["icon_path"] = default_rel
            changed = True

    return changed


def migrate_absolute_paths_to_relative(custom_gifts: dict) -> int:
    """Migrar paths absolutos viejos del MARU original a paths relativos.

    El MARU original guardaba `icon_path` como absoluto:
        C:/Users/.../data/donaciones/Rose.png

    Esto rompe la portabilidad. La migración lo cambia a:
        donaciones/Rose.png

    Returns: cantidad de gifts migrados.
    """
    count = 0
    for _gid, gdata in custom_gifts.items():
        if not isinstance(gdata, dict):
            continue
        ip = gdata.get("icon_path", "") or ""
        if not ip:
            continue
        # Heurística: contiene drive letter (C:/) o starts con /
        if (
            re.match(r"^[A-Za-z]:[/\\]", ip)
            or ip.startswith("/")
            or "\\" in ip
        ):
            # Extraer solo el filename y volver al formato relativo.
            filename = Path(ip.replace("\\", "/")).name
            if filename:
                gdata["icon_path"] = f"donaciones/{filename}"
                count += 1
    return count


def backup_gifts_json_before_migration(gifts_json_path: Path) -> Path | None:
    """Hacer backup de `gifts.json` antes de migrar paths.

    Pone el backup en `BACKUPS_DIR/gifts_pre_migration_<timestamp>.json`.
    Retorna el path del backup, o None si no había nada que backupear.
    """
    if not gifts_json_path.exists():
        return None
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    dst = BACKUPS_DIR / f"gifts_pre_migration_{ts}.json"
    shutil.copy2(gifts_json_path, dst)
    log.info("gifts.json backup before migration: %s", dst)
    return dst


# ──────────────────────────────────────────────────────────────────────────
# GiftDownloader — auto-descarga en vivo
# ──────────────────────────────────────────────────────────────────────────


class GiftDownloader:
    """Pipeline de descarga de PNG de gifts detectados en vivo.

    Réplica fiel de `gui/views/images.py:_on_gift_image_detected`:
      1. Normalizar nombre.
      2. Verificar si ya existe (skip si tiene PNG válido).
      3. Lock para evitar duplicados concurrentes.
      4. `requests.get(url, timeout=10)`.
      5. `Image.open(...).convert("RGBA")` con PIL.
      6. Inyectar metadata `tEXt` (Gift-Name, Gift-Coins).
      7. Guardar en `USERDATA_DONACIONES_DIR/<safe_name>.png`.
      8. Actualizar el dict `custom_gifts` (in-place) con `icon_path` relativo.

    Devuelve `(downloaded, skipped, errored)` para tracking.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pending: set[str] = set()
        self._error_count = 0
        # Stats acumulados por sesión.
        self.downloaded_count = 0
        self.reactivated_count = 0
        self.skipped_count = 0
        self.errored_count = 0

    # ── API pública ──────────────────────────────────────────────────

    def detected(
        self,
        custom_gifts: dict,
        gift_id: str,
        gift_name: str,
        image_url: str,
        coins: int,
    ) -> dict[str, object]:
        """Procesar un evento `gift_image_detected` del TikTok worker.

        Mutación in-place de `custom_gifts`. NO persiste a disco — el
        caller decide cuándo guardar (ej: vía `donations.upsert` RPC).

        Returns: dict con `{action, gift_id, gift_name, coins, path?}`.
            action ∈ {downloaded, reactivated, skipped, errored}.
        """
        if not gift_name or not image_url:
            return {"action": "skipped", "reason": "no name or url"}

        gift_name = normalize_gift_name(gift_name)
        gift_name_lower = gift_name.lower()

        # Buscar si ya existe (por gid o por name).
        existing_key = self._find_existing(custom_gifts, gift_name_lower)

        if existing_key:
            gdata = custom_gifts[existing_key]
            if isinstance(gdata, dict):
                ip = gdata.get("icon_path", "") or ""
                # ¿Ya tiene PNG real Y el archivo existe en disco?
                # Verificar físicamente — si el usuario borró el archivo,
                # debemos re-descargar aunque el icon_path siga apuntando.
                has_real_png = (
                    ip.startswith("donaciones/")
                    and "Rose_black_white" not in ip
                    and self._file_exists_in_dirs(ip)
                )
                if has_real_png:
                    if gdata.get("disabled"):
                        gdata["disabled"] = False
                        if coins and not gdata.get("coins"):
                            gdata["coins"] = coins
                        self.reactivated_count += 1
                        return {
                            "action": "reactivated",
                            "gift_id": existing_key,
                            "gift_name": gift_name,
                            "coins": coins,
                        }
                    self.skipped_count += 1
                    return {"action": "skipped", "reason": "already has png"}
                # Si el archivo NO existe pero ip apuntaba a donaciones/X.png,
                # caemos al _download_and_save para re-descargar. La key
                # `existing_key` se preserva para mantener la regla del usuario.

        # Lock + dedup pendientes.
        with self._lock:
            if gift_name_lower in self._pending:
                self.skipped_count += 1
                return {"action": "skipped", "reason": "already downloading"}
            self._pending.add(gift_name_lower)

        try:
            return self._download_and_save(
                custom_gifts,
                existing_key,
                gift_id,
                gift_name,
                image_url,
                coins,
            )
        finally:
            with self._lock:
                self._pending.discard(gift_name_lower)

    # ── Internos ─────────────────────────────────────────────────────

    @staticmethod
    def _file_exists_in_dirs(rel_path: str) -> bool:
        """Verifica que `donaciones/X.png` exista en la carpeta del programa.

        SOLO mira `USERDATA_DONACIONES_DIR` (la carpeta del MARU nuevo).
        El bundle del MARU original ya se copió completo via bootstrap,
        así que el userdata es la única fuente de verdad — si el usuario
        borra una PNG, queremos re-descargar y persistir solo en userdata.
        """
        if not rel_path or not rel_path.startswith("donaciones/"):
            return False
        filename = rel_path[len("donaciones/"):]
        try:
            return (USERDATA_DONACIONES_DIR / filename).is_file()
        except OSError:
            return False

    def _find_existing(
        self, custom_gifts: dict, gift_name_lower: str
    ) -> str | None:
        for gid, gdata in custom_gifts.items():
            gid_norm = normalize_gift_name(gid).lower()
            if gid_norm == gift_name_lower:
                return gid
            if isinstance(gdata, dict):
                name_norm = normalize_gift_name(
                    gdata.get("name", "") or ""
                ).lower()
                if name_norm == gift_name_lower:
                    return gid
        return None

    def _download_and_save(
        self,
        custom_gifts: dict,
        existing_key: str | None,
        gift_id: str,
        gift_name: str,
        image_url: str,
        coins: int,
    ) -> dict[str, object]:
        try:
            import requests
        except ImportError:
            self._log_error("requests not installed")
            self.errored_count += 1
            return {"action": "errored", "reason": "requests not installed"}

        try:
            self._log_info(f"Downloading {gift_name} from {image_url}")
            resp = requests.get(image_url, timeout=10)
            if resp.status_code != 200:
                self._log_error(
                    f"HTTP {resp.status_code} for {gift_name}"
                )
                self.errored_count += 1
                return {
                    "action": "errored",
                    "reason": f"http {resp.status_code}",
                }
            raw = resp.content
            if len(raw) < 8:
                self._log_error(f"Empty body for {gift_name}")
                self.errored_count += 1
                return {"action": "errored", "reason": "empty body"}
        except Exception as ex:
            self._log_error(f"Network error for {gift_name}: {ex}")
            self.errored_count += 1
            return {"action": "errored", "reason": str(ex)[:120]}

        # Convertir a PNG RGBA con PIL.
        try:
            from PIL import Image  # type: ignore[import-not-found]
        except ImportError:
            self._log_error("PIL/Pillow not installed")
            self.errored_count += 1
            return {"action": "errored", "reason": "Pillow not installed"}

        try:
            img = Image.open(io.BytesIO(raw)).convert("RGBA")
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            png_data = buf.getvalue()
        except Exception as ex:
            self._log_error(f"PIL error for {gift_name}: {ex}")
            self.errored_count += 1
            return {"action": "errored", "reason": f"pil: {ex}"}

        # Inyectar metadata tEXt.
        safe_name_for_meta = (
            gift_name.encode("latin-1", errors="replace").decode("latin-1")
        )
        final_data = inject_png_metadata(
            png_data,
            {"Gift-Name": safe_name_for_meta, "Gift-Coins": str(coins)},
        )

        # Guardar en USERDATA (writable, no en bundle read-only).
        USERDATA_DONACIONES_DIR.mkdir(parents=True, exist_ok=True)
        file_stem = safe_filename(gift_name)
        save_path = USERDATA_DONACIONES_DIR / f"{file_stem}.png"
        try:
            with open(save_path, "wb") as f:
                f.write(final_data)
        except OSError as ex:
            self._log_error(f"Write error for {gift_name}: {ex}")
            self.errored_count += 1
            return {"action": "errored", "reason": f"write: {ex}"}

        rel_path = f"donaciones/{save_path.name}"

        # Update / create entry en custom_gifts.
        if existing_key and existing_key in custom_gifts:
            entry = custom_gifts[existing_key]
            if isinstance(entry, dict):
                entry["icon_path"] = rel_path
                entry["disabled"] = False
                if coins and not entry.get("coins"):
                    entry["coins"] = coins
        else:
            # Nueva entrada — usamos el gift_name como key (idéntico al original).
            custom_gifts[gift_name] = {
                "name": gift_name,
                "icon": "",
                "coins": coins,
                "icon_path": rel_path,
                "disabled": False,
            }

        self.downloaded_count += 1
        self._log_info(f"Saved {gift_name} → {rel_path}")
        return {
            "action": "downloaded",
            "gift_id": gift_name if not existing_key else existing_key,
            "gift_name": gift_name,
            "coins": coins,
            "path": rel_path,
        }

    # ── Logging throttled ────────────────────────────────────────────

    def _log_error(self, msg: str) -> None:
        self._error_count += 1
        if self._error_count <= _ERROR_LOG_THRESHOLD:
            log.warning("[gift-downloader] %s", msg)
        elif self._error_count == _ERROR_LOG_THRESHOLD + 1:
            log.warning(
                "[gift-downloader] Silenciando errores tras %s fallos",
                _ERROR_LOG_THRESHOLD,
            )

    def _log_info(self, msg: str) -> None:
        log.info("[gift-downloader] %s", msg)


__all__ = [
    "GiftDownloader",
    "read_png_metadata",
    "inject_png_metadata",
    "safe_filename",
    "normalize_gift_name",
    "resolve_gift_images",
    "migrate_absolute_paths_to_relative",
    "backup_gifts_json_before_migration",
]
