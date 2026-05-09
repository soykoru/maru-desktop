"""Genera los archivos del perfil 'Identity' para Minecraft + perfil de
backup 'Default Koru' con el estado actual.

Este script se ejecuta UNA sola vez para sembrar dos perfiles:
  1. 'Default Koru' — snapshot de lo que el user tiene HOY en
     data_minecraft.json + rules_minecraft.json (zombie con koru_void
     + item siu). Sin reglas.
  2. 'Identity' — 79 mobs del Identity Mod como entries en `entities`
     + 79 reglas tipo `command` (`!lobo`, `!gato`, etc.) que disparan
     /execute as soykoru run identity equip @s minecraft:<mob>.

Después de correr esto:
  - data_minecraft.json activo queda con las 79 entries de Identity.
  - rules_minecraft.json activo queda con las 79 reglas command.
  - Los perfiles "Default Koru" e "Identity" están en
    apps/runtime_data/profiles/.
  - El index.json está actualizado.

PRECONDICIÓN: MARU desktop debe estar CERRADO. El sidecar cachea estos
archivos en memoria; si está corriendo durante la escritura puede haber
inconsistencias.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import time
import uuid
from pathlib import Path

# ── Paths ────────────────────────────────────────────────────────────────
# Default: workspace dev path. Override con MARU_RUNTIME_DIR env var apuntando
# al AppData real cuando el user usa el .exe instalado:
#   Windows:  %APPDATA%/MARU Live/
#   macOS:    ~/Library/Application Support/MARU Live/
#   Linux:    ~/.local/share/MARU Live/
ROOT = Path(__file__).resolve().parents[1]  # maru-desktop/
_runtime_override = os.environ.get("MARU_RUNTIME_DIR")
if _runtime_override:
    RUNTIME_DIR = Path(_runtime_override).expanduser().resolve()
    DATA_DIR = RUNTIME_DIR / "data"
    PROFILES_DIR = RUNTIME_DIR / "profiles"
    print(f"Using MARU_RUNTIME_DIR override: {RUNTIME_DIR}")
else:
    DATA_DIR = ROOT / "apps" / "runtime_data" / "data"
    PROFILES_DIR = ROOT / "apps" / "runtime_data" / "profiles"
INDEX_PATH = PROFILES_DIR / "index.json"

DATA_MC = DATA_DIR / "data_minecraft.json"
RULES_MC = DATA_DIR / "rules_minecraft.json"
SOUNDS_MC = DATA_DIR / "sounds_minecraft.json"
BOOSTS_MC = DATA_DIR / "rule_boosts_minecraft.json"

# ── 79 mobs Identity Mod: (mc_id, display_es, trigger_es) ──────────────
MOBS: list[tuple[str, str, str]] = [
    ("allay", "🩵 Allay", "allay"),
    ("axolotl", "🦎 Axolotl", "axolotl"),
    ("bat", "🦇 Murciélago", "murcielago"),
    ("bee", "🐝 Abeja", "abeja"),
    ("blaze", "🔥 Blaze", "blaze"),
    ("camel", "🐪 Camello", "camello"),
    ("cat", "🐈 Gato", "gato"),
    ("cave_spider", "🕷️ Araña Cueva", "aranacueva"),
    ("chicken", "🐔 Pollo", "pollo"),
    ("cod", "🐟 Bacalao", "bacalao"),
    ("cow", "🐄 Vaca", "vaca"),
    ("creeper", "💚 Creeper", "creeper"),
    ("dolphin", "🐬 Delfín", "delfin"),
    ("donkey", "🫏 Burro", "burro"),
    ("drowned", "💧 Ahogado", "ahogado"),
    ("elder_guardian", "🛡️ Guardián Anciano", "guardiananciano"),
    ("ender_dragon", "🐉 Ender Dragon", "enderdragon"),
    ("enderman", "👤 Enderman", "enderman"),
    ("endermite", "🪲 Endermite", "endermite"),
    ("evoker", "🧙 Evocador", "evocador"),
    ("fox", "🦊 Zorro", "zorro"),
    ("frog", "🐸 Rana", "rana"),
    ("ghast", "👻 Ghast", "ghast"),
    ("giant", "👹 Gigante", "gigante"),
    ("glow_squid", "💫 Calamar Brillante", "calamarbrillante"),
    ("goat", "🐐 Cabra", "cabra"),
    ("guardian", "🛡️ Guardián", "guardian"),
    ("hoglin", "🐗 Hoglin", "hoglin"),
    ("horse", "🐎 Caballo", "caballo"),
    ("husk", "🏜️ Husk", "husk"),
    ("illusioner", "🎭 Ilusionista", "ilusionista"),
    ("iron_golem", "🤖 Golem Hierro", "golemhierro"),
    ("llama", "🦙 Llama", "llama"),
    ("magma_cube", "🟧 Cubo Magma", "cubomagma"),
    ("mooshroom", "🍄 Mooshroom", "mooshroom"),
    ("mule", "🐴 Mula", "mula"),
    ("ocelot", "🐆 Ocelote", "ocelote"),
    ("panda", "🐼 Panda", "panda"),
    ("parrot", "🦜 Loro", "loro"),
    ("phantom", "🦇 Phantom", "phantom"),
    ("pig", "🐖 Cerdo", "cerdo"),
    ("piglin", "👹 Piglin", "piglin"),
    ("piglin_brute", "👹 Piglin Bruto", "piglinbruto"),
    ("pillager", "🏹 Saqueador", "saqueador"),
    ("polar_bear", "🐻‍❄️ Oso Polar", "osopolar"),
    ("pufferfish", "🐡 Pez Globo", "pezglobo"),
    ("rabbit", "🐇 Conejo", "conejo"),
    ("ravager", "🦏 Devastador", "devastador"),
    ("salmon", "🐟 Salmón", "salmon"),
    ("sheep", "🐑 Oveja", "oveja"),
    ("shulker", "📦 Shulker", "shulker"),
    ("silverfish", "🐛 Pececillo", "pececillo"),
    ("skeleton", "💀 Esqueleto", "esqueleto"),
    ("skeleton_horse", "🦴 Caballo Esqueleto", "caballoesqueleto"),
    ("slime", "🟢 Slime", "slime"),
    ("sniffer", "👃 Olfateador", "olfateador"),
    ("snow_golem", "☃️ Golem Nieve", "golemnieve"),
    ("spider", "🕸️ Araña", "arana"),
    ("squid", "🦑 Calamar", "calamar"),
    ("stray", "🏔️ Vagabundo", "vagabundo"),
    ("strider", "🦴 Strider", "strider"),
    ("tadpole", "🪷 Renacuajo", "renacuajo"),
    ("trader_llama", "🦙 Llama Comerciante", "llamacomerciante"),
    ("tropical_fish", "🐠 Pez Tropical", "peztropical"),
    ("turtle", "🐢 Tortuga", "tortuga"),
    ("vex", "👻 Vex", "vex"),
    ("villager", "👨‍🌾 Aldeano", "aldeano"),
    ("vindicator", "⚔️ Vindicador", "vindicador"),
    ("wandering_trader", "🛒 Comerciante", "comerciante"),
    ("warden", "🌑 Warden", "warden"),
    ("witch", "🧙‍♀️ Bruja", "bruja"),
    ("wither", "💀 Wither", "wither"),
    ("wither_skeleton", "🪦 Esqueleto Wither", "esqueletowither"),
    ("wolf", "🐺 Lobo", "lobo"),
    ("zoglin", "🐗 Zoglin", "zoglin"),
    ("zombie", "🧟 Zombie", "zombie"),
    ("zombie_horse", "🧟 Caballo Zombie", "caballozombie"),
    ("zombie_villager", "🧟 Aldeano Zombie", "aldeanozombie"),
    ("zombified_piglin", "🧟 Piglin Zombi", "piglinzombi"),
]


def cmd_for(mc_id: str) -> str:
    """Comando RCON Identity Mod — transforma a soykoru en el mob dado."""
    return f"execute as soykoru run identity equip @s minecraft:{mc_id}"


def build_identity_data() -> dict:
    """data_minecraft.json con 79 entries Identity en `entities`."""
    entries = [
        {"name": display, "command": cmd_for(mc_id)}
        for mc_id, display, _trigger in MOBS
    ]
    return {
        "entities": entries,
        "items": [],
        "events": [],
        "valuables": [],
        "updatedAt": int(time.time() * 1000),
    }


def build_identity_rules() -> dict:
    """rules_minecraft.json con 79 reglas tipo command."""
    rules = []
    for mc_id, display, trigger in MOBS:
        rule_id = f"rule-identity-{mc_id}"
        rule = {
            "id": rule_id,
            "name": f"Transformar en {display}",
            "enabled": True,
            "trigger_type": "command",
            "trigger_value": trigger,
            "actions": [
                {
                    "action_type": "entity",
                    "action_type_name": "🐉 Entidad",
                    "action_value": display,
                    "amount": 1,
                    "commands": "",
                }
            ],
            "random_action": False,
            "cooldown": 5,
            "tts_enabled": False,
            "tts_message": "",
            "tts_voice": "es_mx_002",
            "allowed_users": [],
            "required_ranks": [],
            "excluded_ranks": [],
            # compat fields espejo de actions[0]
            "action_type": "spawn",
            "action_value": display,
            "amount": 1,
            "commands": "",
        }
        rules.append(rule)
    return {"schemaVersion": 2, "rules": rules}


def hash_dir(d: Path) -> str:
    h = hashlib.sha256()
    for f in sorted(d.rglob("*")):
        if f.is_file():
            h.update(f.relative_to(d).as_posix().encode())
            h.update(b"\0")
            with f.open("rb") as fh:
                for chunk in iter(lambda: fh.read(65536), b""):
                    h.update(chunk)
    return h.hexdigest()


def compute_stats(snap_dir: Path, game_id: str) -> dict:
    """Espejo simplificado de ProfilesService._compute_stats."""
    out = {
        "gameId": game_id,
        "gameName": "Minecraft",
        "rulesCount": 0,
        "rulesEnabled": 0,
        "giftsCount": 0,
        "customGamesCount": 0,
        "sizeBytes": 0,
    }
    for f in snap_dir.rglob("*"):
        if f.is_file():
            try:
                out["sizeBytes"] += f.stat().st_size
            except OSError:
                pass
    rules_p = snap_dir / "rules" / f"rules_{game_id}.json"
    if rules_p.exists():
        try:
            doc = json.loads(rules_p.read_text(encoding="utf-8"))
            rules = doc.get("rules") if isinstance(doc, dict) else doc
            if isinstance(rules, list):
                out["rulesCount"] = len(rules)
                out["rulesEnabled"] = sum(
                    1 for r in rules if isinstance(r, dict) and r.get("enabled", True)
                )
        except Exception:
            pass
    return out


def write_profile(name: str, description: str, data_doc: dict, rules_doc: dict) -> dict:
    """Crea el directorio de perfil con meta + rules + data + index entry."""
    pid = f"p-{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
    p = PROFILES_DIR / pid
    (p / "rules").mkdir(parents=True, exist_ok=True)
    (p / "data").mkdir(parents=True, exist_ok=True)
    (p / "rules" / "rules_minecraft.json").write_text(
        json.dumps(rules_doc, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (p / "data" / "data_minecraft.json").write_text(
        json.dumps(data_doc, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    if SOUNDS_MC.exists():
        shutil.copy2(SOUNDS_MC, p / SOUNDS_MC.name)
    if BOOSTS_MC.exists():
        shutil.copy2(BOOSTS_MC, p / BOOSTS_MC.name)
    sha = hash_dir(p)
    stats = compute_stats(p, "minecraft")
    meta = {
        "id": pid,
        "name": name,
        "description": description,
        "createdAt": int(time.time() * 1000),
        "updatedAt": int(time.time() * 1000),
        "sha256": sha,
        "isPerGame": True,
        **stats,
    }
    (p / "meta.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return meta


def update_index(metas: list[dict]) -> None:
    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    if INDEX_PATH.exists():
        try:
            idx = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
            if not isinstance(idx, dict):
                idx = {}
        except Exception:
            idx = {}
    else:
        idx = {}
    for m in metas:
        idx[m["id"]] = m
    INDEX_PATH.write_text(
        json.dumps(idx, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def main() -> None:
    print(f"Working in: {ROOT}")
    if not DATA_DIR.exists():
        raise SystemExit(f"DATA_DIR no existe: {DATA_DIR}")

    # 1) Snapshot del estado ACTUAL como perfil "Default Koru".
    print("[1/3] Guardando estado actual como 'Default Koru'…")
    cur_data = (
        json.loads(DATA_MC.read_text(encoding="utf-8")) if DATA_MC.exists() else {}
    )
    cur_rules = (
        json.loads(RULES_MC.read_text(encoding="utf-8")) if RULES_MC.exists() else {"rules": []}
    )
    meta_default = write_profile(
        name="Default Koru",
        description=(
            "Snapshot del estado original con los comandos zombie+koru_void "
            "y el item 'siu'. Cargá este perfil para volver al setup que "
            "tenías antes de instalar el perfil Identity."
        ),
        data_doc=cur_data,
        rules_doc=cur_rules,
    )
    print(f"  ✓ {meta_default['id']} ({meta_default['rulesCount']} reglas, "
          f"{meta_default['sizeBytes']} bytes)")

    # 2) Sobrescribir data_minecraft.json + rules_minecraft.json con el
    #    contenido del perfil Identity.
    print("[2/3] Sobrescribiendo data_minecraft + rules_minecraft con Identity…")
    identity_data = build_identity_data()
    identity_rules = build_identity_rules()
    DATA_MC.write_text(
        json.dumps(identity_data, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    RULES_MC.write_text(
        json.dumps(identity_rules, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"  ✓ data_minecraft.json: {len(identity_data['entities'])} entries")
    print(f"  ✓ rules_minecraft.json: {len(identity_rules['rules'])} reglas")

    # 3) Snapshot del nuevo estado como perfil "Identity".
    print("[3/3] Guardando estado nuevo como 'Identity'…")
    meta_identity = write_profile(
        name="Identity",
        description=(
            "79 transformaciones del mod Identity para Minecraft. Cada "
            "comando del chat (ej. !lobo, !creeper, !warden) transforma a "
            "soykoru en el mob correspondiente. Comando RCON usado: "
            "/execute as soykoru run identity equip @s minecraft:<mob>."
        ),
        data_doc=identity_data,
        rules_doc=identity_rules,
    )
    print(f"  ✓ {meta_identity['id']} ({meta_identity['rulesCount']} reglas, "
          f"{meta_identity['sizeBytes']} bytes)")

    # 4) Index.
    update_index([meta_default, meta_identity])
    print(f"\n✅ Perfiles creados:")
    print(f"   - 'Default Koru' (id={meta_default['id']})")
    print(f"   - 'Identity' (id={meta_identity['id']}) ← ACTIVO en disco")
    print(f"\nIndex: {INDEX_PATH}")
    print(f"Profiles dir: {PROFILES_DIR}")


if __name__ == "__main__":
    main()
