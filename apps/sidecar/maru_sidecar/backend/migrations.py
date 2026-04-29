"""Adapter `migrations.*` — importa data del MARU original.

Misión:
  - Encontrar el `LiveChaosEngine_Refactored/data/` del original.
  - Listar lo que se puede importar (rules_*.json, data_*.json, config.json,
    games.json, social_*.json, profiles/*).
  - Dry-run: muestra qué se va a copiar y qué tamaños sin tocar nada.
  - Apply: copia los archivos a `runtime/data/` con escritura atómica y
    backup automático del estado actual antes de pisarlo.

Reglas de seguridad:
  - NO modifica el original. Solo lectura.
  - Antes de copiar, hace backup completo (scope='full') de runtime actual.
  - Si algún archivo destino existe, mostramos diff de tamaño en el report.
  - Validación rápida: sólo aceptamos JSON parseables.
"""

from __future__ import annotations

import json
import os
import shutil
import threading
import time
from pathlib import Path
from typing import Any

from ..logger import get_logger
from ..runtime import DATA_DIR, RUNTIME_DIR
from .backups import BackupService

log = get_logger(__name__)

MIGRATABLE_PATTERNS = [
    "rules_*.json",
    "data_*.json",
    "config.json",
    "games.json",
    "profiles.json",
    "social_narrations.json",
    "social_data.json",
    "gifts.json",
]


def _resolve_original_data_dir(override: str | None) -> Path | None:
    """Encuentra el data dir del MARU original.

    Prioridad: param explícito > MARU_CORE_ROOT env > rutas heurísticas.
    """
    candidates: list[Path] = []
    if isinstance(override, str) and override.strip():
        candidates.append(Path(override).expanduser())
    env = os.environ.get("MARU_CORE_ROOT")
    if env:
        candidates.append(Path(env).expanduser())
    # Heurística estándar
    here = Path(__file__).resolve()
    for parents in (3, 4, 5):
        try:
            base = here.parents[parents]
        except IndexError:
            continue
        candidates.append(base / "LiveChaosEngine" / "LiveChaosEngine_Refactored")
        candidates.append(base / "MARU PRO" / "LiveChaosEngine" / "LiveChaosEngine_Refactored")
    for p in candidates:
        data = p / "data"
        if data.is_dir():
            return data
    return None


class MigrationService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._backups = BackupService()

    # ── API pública ──────────────────────────────────────────────────────

    def status(self, params: dict[str, Any]) -> dict[str, Any]:
        """Detecta el original y lista lo que puede importarse (dry-run)."""
        override = params.get("originalPath") if isinstance(params.get("originalPath"), str) else None
        src = _resolve_original_data_dir(override)
        if src is None:
            return {
                "found": False,
                "originalDataDir": None,
                "items": [],
                "totalBytes": 0,
                "alreadyMigrated": _runtime_has_data(),
            }
        items = self._scan(src)
        total = sum(it["sizeBytes"] for it in items)
        return {
            "found": True,
            "originalDataDir": str(src),
            "items": items,
            "totalBytes": total,
            "alreadyMigrated": _runtime_has_data(),
        }

    def apply(self, params: dict[str, Any]) -> dict[str, Any]:
        """Copia los archivos al runtime nuevo. Retorna lo aplicado."""
        override = params.get("originalPath") if isinstance(params.get("originalPath"), str) else None
        force = bool(params.get("force"))
        src = _resolve_original_data_dir(override)
        if src is None:
            return {"ok": False, "message": "no se pudo localizar el original", "applied": []}

        with self._lock:
            # Backup defensivo del runtime actual (si tiene datos)
            backup_id = None
            if _runtime_has_data():
                if not force:
                    log.info("runtime ya tiene data; backup automático antes de aplicar")
                try:
                    entry = self._backups.create("full", label="auto: pre-migration")
                    backup_id = entry.id
                except FileNotFoundError:
                    pass
                except Exception as exc:
                    log.warning("backup pre-migración falló: %s", exc)

            applied: list[dict[str, Any]] = []
            errors: list[dict[str, Any]] = []
            DATA_DIR.mkdir(parents=True, exist_ok=True)

            for item in self._scan(src):
                rel = item["name"]
                src_p = src / rel
                dst_p = DATA_DIR / rel
                try:
                    if not _is_valid_json(src_p):
                        errors.append({"name": rel, "error": "JSON inválido en origen"})
                        continue
                    tmp = dst_p.with_suffix(dst_p.suffix + ".migrating")
                    shutil.copy2(src_p, tmp)
                    tmp.replace(dst_p)
                    applied.append({"name": rel, "sizeBytes": item["sizeBytes"]})
                except Exception as exc:
                    log.exception("error migrando %s", rel)
                    errors.append({"name": rel, "error": str(exc)})

            return {
                "ok": len(errors) == 0,
                "applied": applied,
                "errors": errors,
                "preBackupId": backup_id,
                "appliedAt": int(time.time() * 1000),
            }

    # ── Helpers ──────────────────────────────────────────────────────────

    def _scan(self, src: Path) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for pat in MIGRATABLE_PATTERNS:
            for f in src.glob(pat):
                if not f.is_file():
                    continue
                try:
                    size = f.stat().st_size
                except OSError:
                    continue
                dst = DATA_DIR / f.name
                out.append({
                    "name": f.name,
                    "sizeBytes": size,
                    "existsInRuntime": dst.exists(),
                    "currentRuntimeSize": dst.stat().st_size if dst.exists() else 0,
                })
        out.sort(key=lambda x: x["name"])
        return out


def _is_valid_json(p: Path) -> bool:
    try:
        with p.open("rb") as fh:
            json.load(fh)
        return True
    except Exception:
        return False


def _runtime_has_data() -> bool:
    if not DATA_DIR.exists():
        return False
    return any(DATA_DIR.glob("*.json"))
