"""Adapter `profiles.*` — snapshots completos del estado del usuario.

Un profile es un ZIP en `runtime/profiles/<id>/` con:
  - meta.json     — id, name, description, createdAt, sha256
  - rules/        — copia de data/rules_*.json
  - data/         — copia de data/data_*.json
  - games.json    — config de juegos
  - config.json   — settings generales
  - overlays/     — futuras configuraciones de overlays

Mejoras sobre el original (que solo guardaba json sueltos):
  - Snapshot **completo y consistente** (transaccional).
  - Hash SHA-256 del snapshot para detectar drift.
  - Export/import como JSON único (base64 del zip embebido) — F4 hace
    JSON plano para portabilidad y debug.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..logger import get_logger
from ..runtime import DATA_DIR, RUNTIME_DIR

log = get_logger(__name__)

PROFILES_DIR = RUNTIME_DIR / "profiles"
INDEX_PATH = PROFILES_DIR / "index.json"


@dataclass(frozen=True)
class ProfileSnapshot:
    id: str
    name: str
    description: str
    created_at: int
    updated_at: int
    sha256: str


class ProfilesService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        PROFILES_DIR.mkdir(parents=True, exist_ok=True)

    # ── API pública ──────────────────────────────────────────────────────

    def list(self, _params: dict[str, Any]) -> dict[str, Any]:
        return {"profiles": [self._to_dict(p) for p in self._read_index().values()]}

    def save(self, params: dict[str, Any]) -> dict[str, Any]:
        name = params.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("name requerido")
        description = params.get("description") or ""
        with self._lock:
            pid = f"p-{int(time.time()*1000)}-{uuid.uuid4().hex[:8]}"
            profile_dir = PROFILES_DIR / pid
            tmp = PROFILES_DIR / f"{pid}.tmp"
            tmp.mkdir(parents=True, exist_ok=True)
            try:
                self._snapshot_to(tmp)
                sha = self._hash_dir(tmp)
                stats = self._compute_stats(tmp)
                meta = {
                    "id": pid,
                    "name": name.strip(),
                    "description": description,
                    "createdAt": int(time.time() * 1000),
                    "updatedAt": int(time.time() * 1000),
                    "sha256": sha,
                    **stats,
                }
                (tmp / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
                tmp.rename(profile_dir)
            except Exception:
                if tmp.exists():
                    shutil.rmtree(tmp, ignore_errors=True)
                raise
            self._upsert_index(meta)
            return {"profile": self._to_dict(self._row(meta))}

    def load(self, params: dict[str, Any]) -> dict[str, Any]:
        pid = params.get("id")
        if not isinstance(pid, str):
            raise TypeError("id requerido")
        src = PROFILES_DIR / pid
        if not src.is_dir():
            raise FileNotFoundError(f"profile no encontrado: {pid}")
        with self._lock:
            self._restore_from(src)
        return {"ok": True}

    def duplicate(self, params: dict[str, Any]) -> dict[str, Any]:
        pid = params.get("id")
        new_name = params.get("name")
        if not isinstance(pid, str) or not isinstance(new_name, str) or not new_name.strip():
            raise ValueError("id y name requeridos")
        src = PROFILES_DIR / pid
        if not src.is_dir():
            raise FileNotFoundError(f"profile no encontrado: {pid}")
        with self._lock:
            new_id = f"p-{int(time.time()*1000)}-{uuid.uuid4().hex[:8]}"
            target = PROFILES_DIR / new_id
            shutil.copytree(src, target)
            meta = json.loads((target / "meta.json").read_text(encoding="utf-8"))
            stats = self._compute_stats(target)
            meta.update(
                {
                    "id": new_id,
                    "name": new_name.strip(),
                    "createdAt": int(time.time() * 1000),
                    "updatedAt": int(time.time() * 1000),
                    **stats,
                }
            )
            (target / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
            self._upsert_index(meta)
            return {"profile": self._to_dict(self._row(meta))}

    def rename(self, params: dict[str, Any]) -> dict[str, Any]:
        pid = params.get("id")
        new_name = params.get("name")
        if not isinstance(pid, str) or not isinstance(new_name, str) or not new_name.strip():
            raise ValueError("id y name requeridos")
        target = PROFILES_DIR / pid
        if not target.is_dir():
            raise FileNotFoundError(f"profile no encontrado: {pid}")
        with self._lock:
            meta = json.loads((target / "meta.json").read_text(encoding="utf-8"))
            meta["name"] = new_name.strip()
            meta["updatedAt"] = int(time.time() * 1000)
            (target / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
            self._upsert_index(meta)
        return {"profile": self._to_dict(self._row(meta))}

    def delete(self, params: dict[str, Any]) -> dict[str, Any]:
        pid = params.get("id")
        if not isinstance(pid, str):
            raise TypeError("id requerido")
        with self._lock:
            target = PROFILES_DIR / pid
            if target.exists():
                shutil.rmtree(target, ignore_errors=True)
            idx = self._read_index()
            idx.pop(pid, None)
            self._write_index(idx)
        return {"ok": True}

    def export(self, params: dict[str, Any]) -> dict[str, Any]:
        pid = params.get("id")
        if not isinstance(pid, str):
            raise TypeError("id requerido")
        src = PROFILES_DIR / pid
        if not src.is_dir():
            raise FileNotFoundError(f"profile no encontrado: {pid}")
        bundle = self._read_bundle(src)
        return {"json": json.dumps(bundle, indent=2, ensure_ascii=False)}

    def import_(self, params: dict[str, Any]) -> dict[str, Any]:
        raw = params.get("json")
        if not isinstance(raw, str):
            raise TypeError("json requerido")
        try:
            bundle = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"JSON inválido: {exc}") from exc
        name = params.get("name") or bundle.get("meta", {}).get("name") or "Importado"
        with self._lock:
            new_id = f"p-{int(time.time()*1000)}-{uuid.uuid4().hex[:8]}"
            target = PROFILES_DIR / new_id
            target.mkdir(parents=True, exist_ok=True)
            self._write_bundle(target, bundle)
            stats = self._compute_stats(target)
            meta = {
                "id": new_id,
                "name": name,
                "description": bundle.get("meta", {}).get("description", ""),
                "createdAt": int(time.time() * 1000),
                "updatedAt": int(time.time() * 1000),
                "sha256": self._hash_dir(target),
                **stats,
            }
            (target / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
            self._upsert_index(meta)
            return {"profile": self._to_dict(self._row(meta))}

    # ── Internals ───────────────────────────────────────────────────────

    # Archivos sueltos a copiar tal cual al root del snapshot.
    _ROOT_FILES = (
        "games.json",
        "config.json",
        "social_narrations.json",
        "gifts.json",
        "voices.json",
        "ia.json",
        "social_data.json",
        "sounds.json",
    )

    def _snapshot_to(self, dest: Path) -> None:
        rules_dir = dest / "rules"
        data_subdir = dest / "data"
        rules_dir.mkdir(parents=True, exist_ok=True)
        data_subdir.mkdir(parents=True, exist_ok=True)
        for f in DATA_DIR.glob("rules_*.json"):
            shutil.copy2(f, rules_dir / f.name)
        for f in DATA_DIR.glob("data_*.json"):
            shutil.copy2(f, data_subdir / f.name)
        for f in DATA_DIR.glob("sounds_*.json"):
            shutil.copy2(f, dest / f.name)
        for name in self._ROOT_FILES:
            src = DATA_DIR / name
            if src.exists():
                shutil.copy2(src, dest / name)

    def _restore_from(self, src: Path) -> None:
        for sub, glob in (("rules", "rules_*.json"), ("data", "data_*.json")):
            srcd = src / sub
            if not srcd.is_dir():
                continue
            for f in srcd.glob(glob):
                shutil.copy2(f, DATA_DIR / f.name)
        for f in src.glob("sounds_*.json"):
            shutil.copy2(f, DATA_DIR / f.name)
        for name in self._ROOT_FILES:
            sf = src / name
            if sf.exists():
                shutil.copy2(sf, DATA_DIR / name)

    def _read_bundle(self, src: Path) -> dict[str, Any]:
        bundle: dict[str, Any] = {"meta": {}, "files": {}}
        meta_p = src / "meta.json"
        if meta_p.exists():
            bundle["meta"] = json.loads(meta_p.read_text(encoding="utf-8"))
        for f in src.rglob("*.json"):
            if f.name == "meta.json":
                continue
            rel = f.relative_to(src).as_posix()
            bundle["files"][rel] = json.loads(f.read_text(encoding="utf-8"))
        return bundle

    def _write_bundle(self, dest: Path, bundle: dict[str, Any]) -> None:
        files = bundle.get("files") or {}
        for rel, content in files.items():
            target = dest / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(content, indent=2, ensure_ascii=False), encoding="utf-8")

    @staticmethod
    def _hash_dir(d: Path) -> str:
        h = hashlib.sha256()
        for f in sorted(d.rglob("*")):
            if f.is_file():
                h.update(f.relative_to(d).as_posix().encode())
                h.update(b"\0")
                with f.open("rb") as fh:
                    for chunk in iter(lambda: fh.read(65536), b""):
                        h.update(chunk)
        return h.hexdigest()

    def _read_index(self) -> dict[str, dict[str, Any]]:
        if not INDEX_PATH.exists():
            return {}
        try:
            return json.loads(INDEX_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}

    def _write_index(self, idx: dict[str, dict[str, Any]]) -> None:
        tmp = INDEX_PATH.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(idx, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(INDEX_PATH)

    def _upsert_index(self, meta: dict[str, Any]) -> None:
        idx = self._read_index()
        idx[meta["id"]] = meta
        self._write_index(idx)

    @staticmethod
    def _row(meta: dict[str, Any]) -> dict[str, Any]:
        return meta

    @staticmethod
    def _to_dict(meta: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": meta.get("id"),
            "name": meta.get("name"),
            "description": meta.get("description") or "",
            "createdAt": int(meta.get("createdAt") or 0),
            "updatedAt": int(meta.get("updatedAt") or 0),
            "sha256": meta.get("sha256") or "",
            "gameId": meta.get("gameId"),
            "gameName": meta.get("gameName"),
            "rulesCount": int(meta.get("rulesCount") or 0),
            "rulesEnabled": int(meta.get("rulesEnabled") or 0),
            "giftsCount": int(meta.get("giftsCount") or 0),
            "customGamesCount": int(meta.get("customGamesCount") or 0),
            "sizeBytes": int(meta.get("sizeBytes") or 0),
        }

    # ── Stats inferidas del snapshot ─────────────────────────────────────

    def _compute_stats(self, snap_dir: Path) -> dict[str, Any]:
        """Inferir contadores y juego activo del snapshot.

        Revisa games.json (selectedGameId si existe, o el primer custom),
        rules_*.json (count + enabled), gifts.json (count), tamaño total.
        """
        out: dict[str, Any] = {
            "gameId": None,
            "gameName": None,
            "rulesCount": 0,
            "rulesEnabled": 0,
            "giftsCount": 0,
            "customGamesCount": 0,
            "sizeBytes": 0,
        }

        # Tamaño total (bytes).
        try:
            for f in snap_dir.rglob("*"):
                if f.is_file():
                    out["sizeBytes"] += f.stat().st_size
        except OSError:
            pass

        # games.json — buscar selectedGameId / primer juego.
        games_path = snap_dir / "games.json"
        if games_path.exists():
            try:
                gdoc = json.loads(games_path.read_text(encoding="utf-8"))
                games = (gdoc.get("games") or {}) if isinstance(gdoc, dict) else {}
                if isinstance(games, dict) and games:
                    selected = gdoc.get("selectedGameId")
                    if not selected or selected not in games:
                        # Preferir un standard si hay; si no, el primero.
                        std = next(
                            (gid for gid in games if isinstance(games.get(gid), dict) and games[gid].get("isStandard")),
                            None,
                        )
                        selected = std or next(iter(games))
                    profile = games.get(selected) or {}
                    out["gameId"] = selected
                    out["gameName"] = (profile or {}).get("name") if isinstance(profile, dict) else None
                    out["customGamesCount"] = sum(
                        1 for p in games.values() if isinstance(p, dict) and not p.get("isStandard")
                    )
            except (json.JSONDecodeError, OSError):
                pass

        # rules_<gid>.json — count + enabled.
        gid = out["gameId"]
        if gid:
            rules_path = snap_dir / "rules" / f"rules_{gid}.json"
            if rules_path.exists():
                try:
                    rdoc = json.loads(rules_path.read_text(encoding="utf-8"))
                    rules = rdoc.get("rules") if isinstance(rdoc, dict) else rdoc
                    if isinstance(rules, list):
                        out["rulesCount"] = len(rules)
                        out["rulesEnabled"] = sum(
                            1 for r in rules if isinstance(r, dict) and r.get("enabled", True)
                        )
                except (json.JSONDecodeError, OSError):
                    pass

        # gifts.json (al root del snapshot) — count.
        gifts_path = snap_dir / "gifts.json"
        if gifts_path.exists():
            try:
                gdoc = json.loads(gifts_path.read_text(encoding="utf-8"))
                custom = (gdoc.get("custom_gifts") or {}) if isinstance(gdoc, dict) else {}
                if isinstance(custom, dict):
                    out["giftsCount"] = len(custom)
            except (json.JSONDecodeError, OSError):
                pass

        return out
