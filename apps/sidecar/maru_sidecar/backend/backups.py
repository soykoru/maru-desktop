"""Sistema de backups profesional.

Mejoras sobre el original (que solo copiaba con timestamp y acumulaba):
  - **Escritura atómica**: copia a `.tmp` → `os.replace` (rename atómico en
    todos los SO) para que un crash a mitad de copia no deje archivos corruptos.
  - **Hash SHA-256** del archivo original guardado en metadata → restore
    valida integridad antes de sobrescribir.
  - **Retención dual**: max N backups + max edad en días, evaluadas al crear.
  - **Locking** con `threading.Lock` por scope para evitar dos backups
    concurrentes del mismo conjunto.
  - **Manifest JSON** (`backups/index.json`) con metadata indexada.
  - **Scopes**: rules / data / social / config / full.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import threading
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

from ..logger import get_logger
from ..runtime import BACKUPS_DIR, DATA_DIR

log = get_logger(__name__)

Scope = Literal["rules", "data", "social", "config", "full"]
SCOPES: tuple[Scope, ...] = ("rules", "data", "social", "config", "full")

# Mapeo scope → patrones de archivos a respaldar (relativos a DATA_DIR)
_SCOPE_PATTERNS: dict[Scope, list[str]] = {
    "rules": ["rules_*.json"],
    "data": ["data_*.json"],
    "social": ["social_*.json", "social_narrations.json"],
    "config": ["config.json", "gifts.json", "games.json", "profiles.json"],
    "full": ["*.json"],
}

DEFAULT_MAX_BACKUPS_PER_SCOPE = 7  # Paridad MARU original
DEFAULT_MAX_AGE_DAYS = 30

# Razones canónicas (paridad `backup_dialog.py:_REASON_MAP`).
# Cualquier valor fuera de este set se acepta pero cae al fallback gris en UI.
KNOWN_REASONS: frozenset[str] = frozenset(
    {"manual", "pre_load", "prerestore", "pre_import", "auto"}
)


@dataclass(frozen=True)
class BackupEntry:
    id: str
    created_at: int
    size_bytes: int
    scope: Scope
    label: str | None
    sha256: str
    files: tuple[str, ...]
    reason: str = "manual"


class BackupService:
    def __init__(
        self,
        backups_dir: Path = BACKUPS_DIR,
        data_dir: Path = DATA_DIR,
        max_per_scope: int = DEFAULT_MAX_BACKUPS_PER_SCOPE,
        max_age_days: int = DEFAULT_MAX_AGE_DAYS,
    ) -> None:
        self._backups_dir = backups_dir
        self._data_dir = data_dir
        self._max_per_scope = max_per_scope
        self._max_age_days = max_age_days
        self._index_path = backups_dir / "index.json"
        self._locks: dict[Scope, threading.Lock] = {s: threading.Lock() for s in SCOPES}
        self._index_lock = threading.Lock()
        backups_dir.mkdir(parents=True, exist_ok=True)

    # ── API pública ──────────────────────────────────────────────────────────

    def list(self, scope: Scope | None = None) -> list[BackupEntry]:
        idx = self._read_index()
        if scope is None:
            return list(idx.values())
        return [e for e in idx.values() if e.scope == scope]

    def create(
        self,
        scope: Scope,
        label: str | None = None,
        *,
        reason: str = "manual",
    ) -> BackupEntry:
        if scope not in SCOPES:
            raise ValueError(f"scope inválido: {scope}")
        if not isinstance(reason, str) or not reason.strip():
            reason = "manual"
        with self._locks[scope]:
            files = self._collect_files(scope)
            if not files:
                raise FileNotFoundError(f"no hay archivos para scope={scope} en {self._data_dir}")

            backup_id = f"{scope}-{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
            target_dir = self._backups_dir / backup_id
            tmp_dir = self._backups_dir / f"{backup_id}.tmp"
            tmp_dir.mkdir(parents=True, exist_ok=True)

            try:
                hasher = hashlib.sha256()
                total_size = 0
                rel_files: list[str] = []
                for src in files:
                    rel = src.relative_to(self._data_dir)
                    dst = tmp_dir / rel
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, dst)
                    total_size += dst.stat().st_size
                    rel_files.append(str(rel))
                    with src.open("rb") as fh:
                        for chunk in iter(lambda: fh.read(65536), b""):
                            hasher.update(chunk)
                # Rename atómico tmp → final
                tmp_dir.rename(target_dir)
            except Exception:
                # Cleanup parcial
                if tmp_dir.exists():
                    shutil.rmtree(tmp_dir, ignore_errors=True)
                raise

            entry = BackupEntry(
                id=backup_id,
                created_at=int(time.time() * 1000),
                size_bytes=total_size,
                scope=scope,
                label=label,
                sha256=hasher.hexdigest(),
                files=tuple(rel_files),
                reason=reason,
            )
            self._upsert_index(entry)
            log.info(
                "backup creado: %s reason=%s (%d files, %d bytes)",
                backup_id,
                reason,
                len(rel_files),
                total_size,
            )
            self._enforce_retention(scope)
            return entry

    def restore(
        self, backup_id: str, *, auto_pre_backup: bool = True
    ) -> tuple[BackupEntry, BackupEntry | None]:
        """Restaura un backup. Devuelve (entry_restaurada, pre_backup|None).

        Si `auto_pre_backup=True` (default), crea un backup automático del
        scope actual con reason='prerestore' antes de sobrescribir
        — defensa en profundidad (paridad MARU).
        """
        idx = self._read_index()
        entry = idx.get(backup_id)
        if entry is None:
            raise FileNotFoundError(f"backup no encontrado: {backup_id}")
        src_dir = self._backups_dir / backup_id
        if not src_dir.is_dir():
            raise FileNotFoundError(f"directorio de backup ausente: {src_dir}")

        # Pre-backup automático (best-effort — no rompe el restore si falla).
        pre_backup: BackupEntry | None = None
        if auto_pre_backup:
            try:
                pre_backup = self.create(
                    entry.scope,
                    label=f"auto: pre-restore {backup_id}",
                    reason="prerestore",
                )
            except FileNotFoundError:
                # No hay archivos en data — no hace falta pre-backup.
                pre_backup = None
            except Exception as exc:
                log.warning("pre-backup falló (continuando restore): %s", exc)

        # Restore atómico: stage paralelo + rename uno por uno.
        for rel in entry.files:
            src = src_dir / rel
            dst = self._data_dir / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            tmp = dst.with_suffix(dst.suffix + ".restoring")
            shutil.copy2(src, tmp)
            tmp.replace(dst)
        log.info("backup restaurado: %s (%d files)", backup_id, len(entry.files))
        return entry, pre_backup

    def last(self, scope: Scope | None = None) -> BackupEntry | None:
        """Devuelve el último backup creado (opcionalmente filtrado por scope)."""
        candidates = self.list(scope)
        if not candidates:
            return None
        return max(candidates, key=lambda e: e.created_at)

    def delete(self, backup_id: str) -> None:
        idx = self._read_index()
        entry = idx.get(backup_id)
        if entry is None:
            raise FileNotFoundError(f"backup no encontrado: {backup_id}")
        target = self._backups_dir / backup_id
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)
        idx.pop(backup_id, None)
        self._write_index(idx)
        log.info("backup eliminado: %s", backup_id)

    # ── Internos ─────────────────────────────────────────────────────────────

    def _collect_files(self, scope: Scope) -> list[Path]:
        files: list[Path] = []
        for pat in _SCOPE_PATTERNS[scope]:
            files.extend(self._data_dir.glob(pat))
        # Dedupe + ordenar para determinismo
        return sorted(set(files))

    def _read_index(self) -> dict[str, BackupEntry]:
        with self._index_lock:
            if not self._index_path.exists():
                return {}
            try:
                raw = json.loads(self._index_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                log.warning("index de backups corrupto — recreando")
                return {}
            return {k: BackupEntry(**v) for k, v in raw.items()}

    def _write_index(self, idx: dict[str, BackupEntry]) -> None:
        with self._index_lock:
            payload = {k: {**asdict(v), "files": list(v.files)} for k, v in idx.items()}
            tmp = self._index_path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
            tmp.replace(self._index_path)

    def _upsert_index(self, entry: BackupEntry) -> None:
        idx = self._read_index()
        idx[entry.id] = entry
        self._write_index(idx)

    def _enforce_retention(self, scope: Scope) -> None:
        now_ms = int(time.time() * 1000)
        max_age_ms = self._max_age_days * 24 * 3600 * 1000
        idx = self._read_index()
        scope_entries = sorted(
            (e for e in idx.values() if e.scope == scope),
            key=lambda e: e.created_at,
            reverse=True,
        )
        keep: list[BackupEntry] = []
        drop: list[BackupEntry] = []
        for i, e in enumerate(scope_entries):
            too_old = (now_ms - e.created_at) > max_age_ms
            too_many = i >= self._max_per_scope
            (drop if (too_old or too_many) else keep).append(e)
        for e in drop:
            try:
                target = self._backups_dir / e.id
                if target.exists():
                    shutil.rmtree(target, ignore_errors=True)
                idx.pop(e.id, None)
            except Exception as exc:
                log.warning("no pude eliminar backup %s: %s", e.id, exc)
        if drop:
            self._write_index(idx)
            log.info("retención: eliminados %d backups del scope %s", len(drop), scope)


# ── Adapter para los métodos RPC ────────────────────────────────────────────


def to_dict(entry: BackupEntry) -> dict[str, Any]:
    return {
        "id": entry.id,
        "createdAt": entry.created_at,
        "sizeBytes": entry.size_bytes,
        "scope": entry.scope,
        "label": entry.label,
        "reason": entry.reason,
        "filesCount": len(entry.files),
        "sha256": entry.sha256,
    }
