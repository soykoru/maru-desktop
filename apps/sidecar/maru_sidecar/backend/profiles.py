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
from ..runtime import DATA_DIR, RUNTIME_DIR, USERDATA_PROFILE_COVERS_DIR

log = get_logger(__name__)

PROFILES_DIR = RUNTIME_DIR / "profiles"
INDEX_PATH = PROFILES_DIR / "index.json"

# Extensiones aceptadas para cover de perfil (igual que game_covers).
_COVER_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".gif")


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
        # v1.0.69: servicios que necesitan reload tras restaurar un profile.
        # Se inyectan desde el registry (`attach_*`). Sin esto, los servicios
        # quedan con caches en memoria de los archivos del profile anterior.
        self._boosts_svc: Any = None
        # v1.1.2: el RuleDispatcher también cachea `engine.profiles[gid]`
        # en memoria. Sin reload tras restore, las reglas del profile
        # anterior siguen siendo las que `rules.test` y el listener
        # de eventos ven (aunque `rules_<gid>.json` ya cambió en disco).
        # Bug reportado: cargar profile Identity en Minecraft → reglas
        # se ven en UI pero "Probar" dice 'regla no existe'.
        self._dispatcher: Any = None

    def attach_boosts(self, svc: Any) -> None:
        """v1.0.69: el RuleBoostsService cachea `_doc` en memoria. Después
        de un `load(profileId)`, los archivos en disco cambian pero la
        cache no se entera → boosts del profile viejo siguen activos.
        Esta inyección permite llamar `boosts.reload()` post-restore."""
        self._boosts_svc = svc

    def attach_dispatcher(self, dispatcher: Any) -> None:
        """v1.1.2: el RuleDispatcher cachea el GameProfile del engine.
        Tras `profiles.load`, el archivo `rules_<gid>.json` cambió pero
        `engine.profiles[gid]` sigue con las reglas anteriores. Esta
        inyección permite llamar `dispatcher.refresh_profile(gid)` para
        forzar reload del engine in-place."""
        self._dispatcher = dispatcher

    # ── API pública ──────────────────────────────────────────────────────

    def list(self, _params: dict[str, Any]) -> dict[str, Any]:
        return {"profiles": [self._to_dict(p) for p in self._read_index().values()]}

    def save(self, params: dict[str, Any]) -> dict[str, Any]:
        """v1.0.86: PERFILES POR JUEGO.

        - Si vino `gameId` en params, snapshot SOLO de ese juego
          (rules_<gameId>.json + sounds_<gameId>.json + rule_boosts_<gameId>.json).
        - Si NO vino gameId, fallback al modo legacy "snapshot completo"
          (compat backwards). Con warning en log.

        El user pidió: "los perfiles son individuales entre juegos para
        poder tener multipiples perfiles en un juego... principalmente
        para guardar las reglas de un juego".
        """
        name = params.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("name requerido")
        description = params.get("description") or ""
        game_id = params.get("gameId")
        if game_id is not None and not isinstance(game_id, str):
            raise TypeError("gameId debe ser string si se provee")
        with self._lock:
            pid = f"p-{int(time.time()*1000)}-{uuid.uuid4().hex[:8]}"
            profile_dir = PROFILES_DIR / pid
            tmp = PROFILES_DIR / f"{pid}.tmp"
            tmp.mkdir(parents=True, exist_ok=True)
            try:
                if game_id:
                    # NUEVO modo per-game: solo rules + sounds + boosts del juego.
                    self._snapshot_per_game(tmp, game_id)
                    is_per_game = True
                else:
                    # Legacy compat: snapshot completo.
                    log.warning(
                        "profiles.save: sin gameId, usando modo legacy "
                        "(snapshot completo). Recomendado pasar gameId.",
                    )
                    self._snapshot_to(tmp)
                    is_per_game = False
                sha = self._hash_dir(tmp)
                stats = self._compute_stats(tmp)
                # Si es per-game, override gameId con el explícito.
                if is_per_game:
                    stats["gameId"] = game_id
                    # gameName se infiere desde games.json si está, sino del game_id.
                    games_doc = (DATA_DIR / "games.json")
                    if games_doc.exists():
                        try:
                            gdoc = json.loads(games_doc.read_text(encoding="utf-8"))
                            games = gdoc.get("games", {}) if isinstance(gdoc, dict) else {}
                            prof = games.get(game_id) if isinstance(games, dict) else None
                            if isinstance(prof, dict) and prof.get("name"):
                                stats["gameName"] = prof["name"]
                        except (json.JSONDecodeError, OSError):
                            pass
                meta = {
                    "id": pid,
                    "name": name.strip(),
                    "description": description,
                    "createdAt": int(time.time() * 1000),
                    "updatedAt": int(time.time() * 1000),
                    "sha256": sha,
                    "isPerGame": is_per_game,
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
        """v1.0.86: detecta si el perfil es per-game (nuevo) o legacy
        (snapshot completo) y restaura solo lo apropiado."""
        pid = params.get("id")
        if not isinstance(pid, str):
            raise TypeError("id requerido")
        src = PROFILES_DIR / pid
        if not src.is_dir():
            raise FileNotFoundError(f"profile no encontrado: {pid}")
        with self._lock:
            # Leer meta para saber si es per-game o legacy
            meta_path = src / "meta.json"
            is_per_game = False
            game_id: str | None = None
            if meta_path.exists():
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                    is_per_game = bool(meta.get("isPerGame"))
                    game_id = meta.get("gameId") if isinstance(meta.get("gameId"), str) else None
                except (json.JSONDecodeError, OSError):
                    pass
            if is_per_game and game_id:
                self._restore_per_game(src, game_id)
                log.info(
                    "profiles.load: %s restaurado en modo per-game para %s",
                    pid, game_id,
                )
            else:
                self._restore_from(src)
                log.info(
                    "profiles.load: %s restaurado en modo legacy (snapshot completo)",
                    pid,
                )
        # v1.0.69: notificar a servicios que cachean en memoria archivos
        # del profile para que recarguen el doc actualizado. Sin esto,
        # los boosts del profile anterior seguirían activos hasta
        # reiniciar la app aunque el archivo en disco ya cambió.
        if self._boosts_svc is not None:
            try:
                self._boosts_svc.reload()
            except Exception:
                log.exception("profiles.load: boosts.reload fallo (no crítico)")
        # v1.1.2 — FIX RAÍZ: el RuleEngine cachea `engine.profiles[gid]`
        # con las reglas del profile anterior. Sin refresh, las reglas
        # del NUEVO profile no se ven al hacer "Probar" ni se ejecutan
        # en eventos reales. Bug reportado: profile Identity con 79
        # reglas en Minecraft → UI muestra reglas, "Probar" dice 'no existe'.
        if self._dispatcher is not None:
            try:
                if is_per_game and game_id:
                    self._dispatcher.refresh_profile(game_id)
                    log.info(
                        "profiles.load: RuleEngine refrescado para %s tras restore",
                        game_id,
                    )
                else:
                    # Legacy: snapshot completo cambia rules_<gid>.json de
                    # múltiples juegos. Refrescar todos los cacheados.
                    self._dispatcher.refresh_all_profiles()
            except Exception:
                log.exception(
                    "profiles.load: dispatcher refresh fallo (no crítico)"
                )
        # v1.0.91+: notificar al frontend que el perfil se restauró para
        # que useData/useRules refresquen sus caches. Sin esto el user
        # cargaba un perfil pero seguía viendo las entries/reglas viejas
        # hasta cerrar y abrir las pestañas.
        try:
            # `profiles.py` vive en `maru_sidecar/backend/`, así que el
            # import relativo correcto a `event_bus.py` es `..event_bus`
            # (dos puntos = subir un nivel). El bug de v1.0.91 fue usar
            # `.event_bus` (un solo punto) → ImportError silenciosamente
            # capturado por el except → push event NO se emitía → la UI
            # no refrescaba al cargar un perfil.
            from ..event_bus import get_event_bus
            bus = get_event_bus()
            bus.publish(
                "profiles:loaded",
                {
                    "profileId": pid,
                    "gameId": game_id,
                    "isPerGame": is_per_game,
                },
            )
        except Exception:
            log.exception("profiles:loaded publish fallo (no crítico)")
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
            # v1.0.94+: limpiar también la portada custom (si existe).
            for cover in USERDATA_PROFILE_COVERS_DIR.glob(f"{pid}.*"):
                try:
                    cover.unlink()
                except OSError:
                    pass
            idx = self._read_index()
            idx.pop(pid, None)
            self._write_index(idx)
        return {"ok": True}

    def update(self, params: dict[str, Any]) -> dict[str, Any]:
        """v1.0.95+: actualiza un perfil EXISTENTE con el estado actual del
        juego — sin crear duplicados ni perder createdAt/coverImage/descripción.

        Pedido del user: "no quiero tener que guardar otro perfil solo por
        un cambio... voy a perfiles y actualizo los cambios". Esto es
        precisamente eso.

        Solo aplica al modo per-game (es lo único donde el "estado actual
        del juego" tiene sentido — el modo legacy snapshotea TODO y casi
        nadie lo usa). Si el perfil es legacy se devuelve error claro.

        Params:
          - id: profileId existente.

        Reusa `_snapshot_per_game(profile_dir, gameId)` apuntando al
        directorio EXISTENTE (no a un tmp). Como `mkdir(exist_ok=True)`
        y `shutil.copy2` sobrescriben sin problema, el snapshot queda
        actualizado in-place.

        Mantiene del meta original: id, name, description, createdAt,
        coverImage, gameId.
        Actualiza: updatedAt, sha256, rulesCount, rulesEnabled, sizeBytes.
        """
        pid = params.get("id")
        if not isinstance(pid, str) or not pid:
            raise TypeError("id requerido")
        profile_dir = PROFILES_DIR / pid
        if not profile_dir.is_dir():
            raise FileNotFoundError(f"profile no encontrado: {pid}")
        meta_path = profile_dir / "meta.json"
        if not meta_path.exists():
            raise FileNotFoundError(f"meta.json del perfil {pid} no existe")
        with self._lock:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            game_id = meta.get("gameId")
            is_per_game = bool(meta.get("isPerGame"))
            if not is_per_game or not isinstance(game_id, str) or not game_id:
                raise ValueError(
                    "Solo se pueden actualizar perfiles per-game (modo recomendado). "
                    "Los perfiles legacy deben reemplazarse manualmente.",
                )
            # Re-snapshotea APUNTANDO al directorio actual del perfil.
            # Los archivos se sobrescriben in-place (rules/, data/, sounds, boosts).
            self._snapshot_per_game(profile_dir, game_id)
            # Recalcular hash + stats desde el snapshot actualizado.
            sha = self._hash_dir(profile_dir)
            stats = self._compute_stats(profile_dir)
            # Mergear: preservar campos identidad/cover/desc, actualizar
            # los que cambian al re-snapshotear.
            meta.update({
                "updatedAt": int(time.time() * 1000),
                "sha256": sha,
                "rulesCount": stats.get("rulesCount", 0),
                "rulesEnabled": stats.get("rulesEnabled", 0),
                "sizeBytes": stats.get("sizeBytes", 0),
                # Re-stat preservando gameId (que ya está en meta) y
                # gameName que puede haber cambiado si el user renombró
                # el juego desde games.json.
                "gameId": game_id,
                "gameName": stats.get("gameName") or meta.get("gameName"),
            })
            meta_path.write_text(
                json.dumps(meta, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            self._upsert_index(meta)
        return {"profile": self._to_dict(self._row(meta))}

    def set_cover(self, params: dict[str, Any]) -> dict[str, Any]:
        """v1.0.94+: copia un archivo de imagen del filesystem del usuario
        a `USERDATA_PROFILE_COVERS_DIR/<profileId>.<ext>` para usarlo como
        portada custom del perfil en el StreamProfilesDialog.

        El frontend lo consume via `maru://images/profile_covers/<file>`.
        El meta.json del perfil se actualiza con `coverImage: "<file>"`.

        Params:
          - id: profileId existente.
          - sourcePath: path absoluto al archivo origen (jpg/png/webp/gif).

        Devuelve `{ok, filename}` con el filename relativo.
        """
        import shutil
        pid = params.get("id")
        src = str(params.get("sourcePath") or "").strip()
        if not isinstance(pid, str) or not pid:
            raise TypeError("id requerido")
        if ".." in pid or "/" in pid or "\\" in pid:
            raise ValueError(f"profileId con caracteres inválidos: {pid!r}")
        target_profile = PROFILES_DIR / pid
        if not target_profile.is_dir():
            raise FileNotFoundError(f"profile no encontrado: {pid}")
        if not src or not Path(src).is_file():
            raise FileNotFoundError(f"archivo origen no existe: {src}")
        ext = Path(src).suffix.lower()
        if ext not in _COVER_EXTS:
            raise ValueError(
                f"extensión {ext} no soportada (use {', '.join(_COVER_EXTS)})"
            )
        with self._lock:
            USERDATA_PROFILE_COVERS_DIR.mkdir(parents=True, exist_ok=True)
            # Borrar variantes con MISMO pid pero distinta extensión.
            for old in USERDATA_PROFILE_COVERS_DIR.glob(f"{pid}.*"):
                try:
                    old.unlink()
                except OSError:
                    pass
            target = USERDATA_PROFILE_COVERS_DIR / f"{pid}{ext}"
            shutil.copyfile(src, target)
            # Actualizar meta.json del perfil con el nombre de archivo.
            meta_path = target_profile / "meta.json"
            if meta_path.exists():
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                    meta["coverImage"] = target.name
                    meta["updatedAt"] = int(time.time() * 1000)
                    meta_path.write_text(
                        json.dumps(meta, indent=2, ensure_ascii=False),
                        encoding="utf-8",
                    )
                    self._upsert_index(meta)
                except (json.JSONDecodeError, OSError) as exc:
                    log.warning("set_cover: no pude actualizar meta.json: %s", exc)
        return {"ok": True, "filename": target.name}

    def delete_cover(self, params: dict[str, Any]) -> dict[str, Any]:
        """Elimina la portada custom del perfil (vuelve al fallback
        gradient + emoji del juego)."""
        pid = params.get("id")
        if not isinstance(pid, str) or not pid:
            raise TypeError("id requerido")
        if ".." in pid or "/" in pid or "\\" in pid:
            raise ValueError(f"profileId con caracteres inválidos: {pid!r}")
        removed = 0
        with self._lock:
            for f in USERDATA_PROFILE_COVERS_DIR.glob(f"{pid}.*"):
                try:
                    f.unlink()
                    removed += 1
                except OSError:
                    pass
            # Limpiar coverImage del meta.
            target_profile = PROFILES_DIR / pid
            meta_path = target_profile / "meta.json"
            if meta_path.exists():
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                    if "coverImage" in meta:
                        meta.pop("coverImage", None)
                        meta["updatedAt"] = int(time.time() * 1000)
                        meta_path.write_text(
                            json.dumps(meta, indent=2, ensure_ascii=False),
                            encoding="utf-8",
                        )
                        self._upsert_index(meta)
                except (json.JSONDecodeError, OSError):
                    pass
        return {"ok": True, "removed": removed}

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
        # v1.0.69 → v1.0.70: boosts ahora son POR JUEGO en archivos
        # `rule_boosts_<gameId>.json`. El glob los copia abajo en
        # _snapshot_to. El archivo legacy `rule_boosts.json` se mantiene
        # acá por retrocompatibilidad (migración automática).
        "rule_boosts.json",
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
        # v1.0.70: boosts por juego — un archivo por gameId.
        for f in DATA_DIR.glob("rule_boosts_*.json"):
            shutil.copy2(f, dest / f.name)
        for name in self._ROOT_FILES:
            src = DATA_DIR / name
            if src.exists():
                shutil.copy2(src, dest / name)

    # ── v1.0.86: snapshot/restore por gameId ────────────────────────────
    def _snapshot_per_game(self, dest: Path, game_id: str) -> None:
        """v1.0.86: snapshot SOLO de los archivos del juego dado.

        Guarda:
          - rules_<gameId>.json (las reglas — archivo crítico)
          - data_<gameId>.json (entries del catálogo — v1.0.91+)
          - sounds_<gameId>.json si existe
          - rule_boosts_<gameId>.json si existe

        NO toca games.json (host/port) ni gifts/voices/ia/etc. Esto permite
        tener múltiples perfiles del MISMO juego (ej. "Vanilla", "Mod
        Terror", "Identity Mod") que cambian reglas + catálogo de entries
        sin pisar la configuración general de la app.

        v1.0.91+: ahora también snapshotea `data_<gameId>.json` para que
        cargar un perfil restaure las entries del catálogo además de las
        reglas. Antes el flujo "10 entries → guardo → borro → 20 nuevas →
        cargo viejo → vuelven 10" NO funcionaba porque las entries
        quedaban solo en el archivo global. Pedido del user.
        """
        # Validar gameId (alfanumérico + _ -)
        if not all(c.isalnum() or c in "_-" for c in game_id):
            raise ValueError(f"gameId inválido: {game_id!r}")

        rules_dir = dest / "rules"
        data_dir = dest / "data"
        rules_dir.mkdir(parents=True, exist_ok=True)
        data_dir.mkdir(parents=True, exist_ok=True)
        # rules_<gameId>.json (crítico — la razón principal del perfil)
        rules_src = DATA_DIR / f"rules_{game_id}.json"
        if rules_src.exists():
            shutil.copy2(rules_src, rules_dir / rules_src.name)
        # data_<gameId>.json — entries del catálogo (entities/items/events).
        # v1.0.91+: el user quiere que guardar perfil + cambiar entries +
        # cargar perfil viejo restaure las entries originales.
        data_src = DATA_DIR / f"data_{game_id}.json"
        if data_src.exists():
            shutil.copy2(data_src, data_dir / data_src.name)
        # sounds_<gameId>.json (opcional)
        sounds_src = DATA_DIR / f"sounds_{game_id}.json"
        if sounds_src.exists():
            shutil.copy2(sounds_src, dest / sounds_src.name)
        # rule_boosts_<gameId>.json (opcional, los boosts del juego)
        boosts_src = DATA_DIR / f"rule_boosts_{game_id}.json"
        if boosts_src.exists():
            shutil.copy2(boosts_src, dest / boosts_src.name)

    def _restore_per_game(self, src: Path, game_id: str) -> None:
        """v1.0.86: restaurar SOLO los archivos del juego dado.

        Reemplaza rules_<gameId>.json, data_<gameId>.json,
        sounds_<gameId>.json y rule_boosts_<gameId>.json en DATA_DIR. NO
        toca otros juegos ni archivos globales.

        v1.0.91+: defensive con perfiles viejos — solo restaura los
        archivos que EFECTIVAMENTE están en el snapshot. Si un perfil fue
        creado pre-v1.0.91 sin `data_<gameId>.json`, las entries actuales
        del catálogo NO se tocan (el comportamiento que el user pidió).
        """
        # rules
        rules_path = src / "rules" / f"rules_{game_id}.json"
        if rules_path.exists():
            shutil.copy2(rules_path, DATA_DIR / rules_path.name)
        # data — solo si está en el snapshot (perfiles viejos no lo tienen).
        data_path = src / "data" / f"data_{game_id}.json"
        if data_path.exists():
            shutil.copy2(data_path, DATA_DIR / data_path.name)
        # sounds
        sounds_path = src / f"sounds_{game_id}.json"
        if sounds_path.exists():
            shutil.copy2(sounds_path, DATA_DIR / sounds_path.name)
        # rule_boosts
        boosts_path = src / f"rule_boosts_{game_id}.json"
        if boosts_path.exists():
            shutil.copy2(boosts_path, DATA_DIR / boosts_path.name)

    def _restore_from(self, src: Path) -> None:
        for sub, glob in (("rules", "rules_*.json"), ("data", "data_*.json")):
            srcd = src / sub
            if not srcd.is_dir():
                continue
            for f in srcd.glob(glob):
                shutil.copy2(f, DATA_DIR / f.name)
        for f in src.glob("sounds_*.json"):
            shutil.copy2(f, DATA_DIR / f.name)
        # v1.0.70: restaurar boosts por juego.
        for f in src.glob("rule_boosts_*.json"):
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
        cover = meta.get("coverImage")
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
            # v1.0.86: indica si es perfil per-game (nuevo) o legacy.
            "isPerGame": bool(meta.get("isPerGame", False)),
            # v1.0.94+: filename relativo de la portada custom del perfil
            # (en USERDATA_PROFILE_COVERS_DIR). None/'' = fallback emoji.
            "coverImage": str(cover) if isinstance(cover, str) and cover else None,
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
        # v1.0.86: si es per-game (no hay games.json en snap), buscar
        # cualquier rules_*.json en /rules ya que solo hay uno (el del juego).
        gid = out["gameId"]
        rules_path = None
        if gid:
            rules_path = snap_dir / "rules" / f"rules_{gid}.json"
        if rules_path is None or not rules_path.exists():
            # Per-game fallback: buscar el único rules_*.json
            rules_dir = snap_dir / "rules"
            if rules_dir.is_dir():
                rule_files = list(rules_dir.glob("rules_*.json"))
                if len(rule_files) == 1:
                    rules_path = rule_files[0]
                    # Inferir gameId del filename
                    inferred_gid = rules_path.stem.removeprefix("rules_")
                    if inferred_gid and not out["gameId"]:
                        out["gameId"] = inferred_gid
        if rules_path and rules_path.exists():
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
