"""Bootstrap inicial del sidecar — siembra runtime_data desde el MARU
original al primer boot.

Si `runtime_data/data/` está vacío y existe un seed dir disponible
(env var `MARU_SEED_DIR` o default a la carpeta data del
`LiveChaosEngine_Refactored`), copia todos los archivos JSON relevantes
(gifts, games, data_*, rules_*, social, fortunes, narraciones, etc.).

Idempotente: nunca sobrescribe archivos existentes — solo siembra cuando
el destino no existe.

Las migraciones de schema (gifts paths absolutos → relativos, games
formato MARU → v2 sidecar, data legacy `"X:Y"` → objetos) las hacen
los services individuales en su próximo boot — el bootstrap solo copia.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from ..logger import get_logger
from ..runtime import DATA_DIR, SPOTIFY_SECRETS_DIR

log = get_logger(__name__)


def _resolve_seed_dir() -> Path | None:
    """Devuelve la seed dir si existe y es válida.

    Prioridad:
      1. Env var `MARU_SEED_DIR` (override explícito).
      2. `LiveChaosEngine_Refactored/data/` relativo al monorepo root.
      3. `LiveChaosEngine/data/` (fallback al MARU original sin _Refactored).
    """
    env = os.environ.get("MARU_SEED_DIR")
    if env:
        p = Path(env).expanduser().resolve()
        if p.is_dir():
            return p
        log.warning("MARU_SEED_DIR=%s no existe, ignorado", env)

    # Buscar relativo al sidecar: parents[3]=workspace, parents[4]=parent del workspace.
    here = Path(__file__).resolve()
    candidates: list[Path] = []
    for up in range(3, 7):
        if up >= len(here.parents):
            break
        base = here.parents[up]
        candidates.append(base / "LiveChaosEngine" / "LiveChaosEngine_Refactored" / "data")
        candidates.append(base / "LiveChaosEngine_Refactored" / "data")
        candidates.append(base / "LiveChaosEngine" / "data")

    for c in candidates:
        if c.is_dir():
            return c
    return None


# Archivos a copiar tal cual (sin transformación). Los services hacen
# sus propias migraciones en su próximo boot.
_SEED_FILES = (
    "gifts.json",
    "games.json",
    "config.json",
    "fortunes.json",
    "social_data.json",
    "social_narrations.json",
    "taps_data.json",
    "minigame_stats.json",
    "profiles.json",
    "overlays.json",
)

# Globs adicionales (data_*.json, rules_*.json).
_SEED_GLOBS = (
    "data_*.json",
    "rules_*.json",
    "sounds_*.json",
)

# Subcarpetas de assets que viven DENTRO del programa (no se referencian
# del bundle viejo). Al primer boot copiamos todo el set para que el
# usuario tenga las 415 PNGs base + iconos triggers + game_images en su
# propio runtime_data, y futuras descargas/borrados solo afecten a esa
# carpeta. Después el bundle viejo se ignora.
_SEED_DIRS = (
    "donaciones",
    "icons_triggers",
    "game_images",
    # v1.0.72: portadas de juegos para la galería visual del
    # ManageGamesDialog. Se sirven via `maru://images/game_covers/<gid>.jpg`.
    "game_covers",
)


def _seed_spotify_secrets(seed: Path) -> int:
    """Copia `<MARU_original>/secrets/spotify/` → `runtime_data/secrets/spotify/`
    para que el usuario reuse su token + cuentas del programa viejo.

    Solo copia archivos que NO existan en destino (idempotente, no pisa
    credenciales nuevas). Devuelve count copiado.
    """
    seed_root = seed.parent  # `data/` → parent es la raíz del refactored
    src_secrets = seed_root / "secrets" / "spotify"
    if not src_secrets.is_dir():
        return 0
    SPOTIFY_SECRETS_DIR.mkdir(parents=True, exist_ok=True)
    copied = 0
    for src_file in src_secrets.rglob("*"):
        if not src_file.is_file():
            continue
        rel = src_file.relative_to(src_secrets)
        dst_file = SPOTIFY_SECRETS_DIR / rel
        if dst_file.exists():
            continue
        try:
            dst_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src_file, dst_file)
            copied += 1
        except OSError as exc:
            log.warning("bootstrap: error copiando spotify/%s: %s", rel, exc)
    if copied:
        log.info(
            "bootstrap: spotify secrets — %d copiados (token + cuentas)",
            copied,
        )
    return copied


def run_bootstrap_if_needed() -> dict[str, int]:
    """Punto de entrada principal — llamado al boot del sidecar.

    Returns:
        dict con {seeded: <count>, skipped: <count>, sourceDir: str|None}.
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Determinar qué falta: el state JSON y los asset dirs son independientes.
    # Un usuario con state previo pero sin imágenes (upgrade) necesita assets.
    has_state = (DATA_DIR / "gifts.json").exists() or (DATA_DIR / "games.json").exists()

    # Threshold conservador: si las donaciones tienen menos de 100 PNGs,
    # asumimos que el seed de assets falló o nunca corrió.
    donaciones_dir = DATA_DIR / "donaciones"
    asset_count = (
        sum(1 for _ in donaciones_dir.glob("*.png"))
        if donaciones_dir.is_dir() else 0
    )
    needs_assets = asset_count < 100

    # Spotify secrets — flujo independiente del state principal. Aunque el
    # JSON state esté completo, el usuario puede no tener las credenciales
    # del MARU viejo todavía. Lo chequeamos aparte para no bloquear con el
    # check de skip principal.
    seed_for_spotify = _resolve_seed_dir() if not (
        SPOTIFY_SECRETS_DIR.is_dir()
        and any(SPOTIFY_SECRETS_DIR.glob("*"))
    ) else None
    if seed_for_spotify is not None:
        _seed_spotify_secrets(seed_for_spotify)

    if has_state and not needs_assets:
        # v1.0.76: AUNQUE el state esté completo, igualmente importamos seed
        # files NUEVOS que no existan en el userdata (data_*.json y
        # rules_*.json de juegos agregados en versiones nuevas). Es
        # idempotente: si el archivo ya existe en userdata, NO se pisa.
        # Sin esto, los users que actualicen de v1.0.75 → v1.0.76 NO
        # verían las acciones pre-cargadas de Project Zomboid, ARK,
        # Palworld, ICARUS porque sus userdata ya estaba "completo".
        seed_for_globs = _resolve_seed_dir()
        new_imports = 0
        if seed_for_globs is not None:
            for glob in _SEED_GLOBS:
                for src in seed_for_globs.glob(glob):
                    dst = DATA_DIR / src.name
                    if dst.exists():
                        continue
                    try:
                        shutil.copy2(src, dst)
                        new_imports += 1
                    except OSError as exc:
                        log.warning("bootstrap incremental: error %s: %s", src.name, exc)
            # Mismo flujo para subcarpetas (game_covers nuevas, etc).
            for sub in _SEED_DIRS:
                sub_src = seed_for_globs / sub
                sub_dst = DATA_DIR / sub
                if not sub_src.is_dir():
                    continue
                sub_dst.mkdir(parents=True, exist_ok=True)
                for src_file in sub_src.rglob("*"):
                    if not src_file.is_file():
                        continue
                    rel = src_file.relative_to(sub_src)
                    dst_file = sub_dst / rel
                    if dst_file.exists():
                        continue
                    try:
                        dst_file.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(src_file, dst_file)
                        new_imports += 1
                    except OSError as exc:
                        log.warning(
                            "bootstrap incremental dir: error %s: %s", rel, exc,
                        )
        if new_imports:
            log.info(
                "bootstrap incremental: %d archivos nuevos del seed importados",
                new_imports,
            )
        log.info("bootstrap: runtime_data completo (%d PNGs) — skip seed full", asset_count)
        return {"seeded": new_imports, "skipped": 0, "sourceDir": None}

    seed = _resolve_seed_dir()
    if seed is None:
        log.info(
            "bootstrap: no se encontró seed dir — runtime_data %s",
            "completo" if has_state else "vacío",
        )
        return {"seeded": 0, "skipped": 0, "sourceDir": None}

    log.info(
        "bootstrap: state=%s assets=%d (necesita_assets=%s)",
        has_state, asset_count, needs_assets,
    )

    log.info("bootstrap: seed dir = %s", seed)
    seeded = 0
    skipped = 0

    for name in _SEED_FILES:
        src = seed / name
        dst = DATA_DIR / name
        if not src.exists():
            continue
        if dst.exists():
            skipped += 1
            continue
        try:
            shutil.copy2(src, dst)
            seeded += 1
        except OSError as exc:
            log.warning("bootstrap: error copiando %s: %s", name, exc)

    for glob in _SEED_GLOBS:
        for src in seed.glob(glob):
            dst = DATA_DIR / src.name
            if dst.exists():
                skipped += 1
                continue
            try:
                shutil.copy2(src, dst)
                seeded += 1
            except OSError as exc:
                log.warning("bootstrap: error copiando %s: %s", src.name, exc)

    # Copiar subcarpetas de assets — mover las imágenes DENTRO del
    # programa nuevo para que sea autocontenido y futuras descargas/
    # borrados solo afecten a esa carpeta.
    for sub in _SEED_DIRS:
        src_dir = seed / sub
        if not src_dir.is_dir():
            continue
        dst_dir = DATA_DIR / sub
        dst_dir.mkdir(parents=True, exist_ok=True)
        copied_here = 0
        skipped_here = 0
        for src_file in src_dir.rglob("*"):
            if not src_file.is_file():
                continue
            rel = src_file.relative_to(src_dir)
            dst_file = dst_dir / rel
            if dst_file.exists():
                skipped_here += 1
                continue
            try:
                dst_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src_file, dst_file)
                copied_here += 1
            except OSError as exc:
                log.warning(
                    "bootstrap: error copiando %s: %s", rel, exc,
                )
        seeded += copied_here
        skipped += skipped_here
        if copied_here:
            log.info(
                "bootstrap: %s — %d copiados, %d skipped",
                sub, copied_here, skipped_here,
            )

    # Spotify ya se copió al inicio del flow — ver `_seed_spotify_secrets`.
    log.info(
        "bootstrap: %d archivos sembrados, %d skipped (ya existían) desde %s",
        seeded,
        skipped,
        seed,
    )
    return {"seeded": seeded, "skipped": skipped, "sourceDir": str(seed)}
