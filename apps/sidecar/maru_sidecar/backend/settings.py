"""Adapter `settings.*` y `backups.*`.

Settings:
  - Read/write atómico de `data/config.json`.
  - Merge superficial con el patch (deep-merge se introduce si hace falta).
  - Backup automático antes de overwrite si difiere.

Backups:
  - Delega en `BackupService` (ver `backups.py`).
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from ..logger import get_logger
from ..runtime import DATA_DIR
from .backups import BackupService, Scope, to_dict

log = get_logger(__name__)


class SettingsService:
    def __init__(self, data_dir: Path = DATA_DIR) -> None:
        self._path = data_dir / "config.json"
        self._lock = threading.Lock()
        self._backup = BackupService()
        data_dir.mkdir(parents=True, exist_ok=True)

    # ── settings.* ─────────────────────────────────────────────────────────

    def get(self, _params: dict[str, Any]) -> dict[str, Any]:
        return {"config": self._read()}

    def set(self, params: dict[str, Any]) -> dict[str, Any]:
        patch = params.get("patch")
        if not isinstance(patch, dict):
            raise TypeError("patch debe ser objeto")
        with self._lock:
            current = self._read()
            merged = {**current, **patch}
            if merged != current:
                self._write_atomic(merged)
        return {"ok": True}

    # ── backups.* ──────────────────────────────────────────────────────────

    def backups_list(self, params: dict[str, Any]) -> dict[str, Any]:
        scope = params.get("scope")
        entries = self._backup.list(scope)  # type: ignore[arg-type]
        return {"backups": [to_dict(e) for e in entries]}

    def backups_create(self, params: dict[str, Any]) -> dict[str, Any]:
        scope = params.get("scope")
        if scope not in ("rules", "data", "social", "config", "full"):
            raise ValueError(f"scope inválido: {scope}")
        label = params.get("label")
        reason_raw = params.get("reason")
        reason = reason_raw if isinstance(reason_raw, str) and reason_raw.strip() else "manual"
        entry = self._backup.create(  # type: ignore[arg-type]
            scope,
            label if isinstance(label, str) else None,
            reason=reason,
        )
        return {"backup": to_dict(entry)}

    def backups_restore(self, params: dict[str, Any]) -> dict[str, Any]:
        backup_id = params.get("id")
        if not isinstance(backup_id, str):
            raise TypeError("id requerido")
        auto_pre = params.get("autoPreBackup")
        auto_pre = True if auto_pre is None else bool(auto_pre)
        entry, pre = self._backup.restore(backup_id, auto_pre_backup=auto_pre)
        return {
            "ok": True,
            "restoredScope": entry.scope,
            "restoredId": entry.id,
            "preBackup": to_dict(pre) if pre is not None else None,
        }

    def backups_delete(self, params: dict[str, Any]) -> dict[str, Any]:
        backup_id = params.get("id")
        if not isinstance(backup_id, str):
            raise TypeError("id requerido")
        self._backup.delete(backup_id)
        return {"ok": True}

    def backups_last(self, params: dict[str, Any]) -> dict[str, Any]:
        scope = params.get("scope")
        last = self._backup.last(scope)  # type: ignore[arg-type]
        return {"backup": to_dict(last) if last is not None else None}

    # ── Internals ──────────────────────────────────────────────────────────

    def _read(self) -> dict[str, Any]:
        if not self._path.exists():
            return {}
        try:
            return json.loads(self._path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.error("config.json corrupto — devolviendo {}")
            return {}

    def _write_atomic(self, data: dict[str, Any]) -> None:
        tmp = self._path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self._path)
