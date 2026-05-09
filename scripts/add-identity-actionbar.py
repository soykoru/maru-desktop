"""Agrega `/title @a actionbar [...]` a los 79 comandos del catálogo
Identity en data_minecraft.json.

El user mostró que cuando agregó manualmente este comando al entry "Allay":
    execute as soykoru run identity equip @s minecraft:allay
    title @a actionbar ["",{"text":"{username}","color":"gold","bold":true},
                        {"text":" ha cambiado de entidad","color":"gray"}]

Apareció en pantalla "soykoru ha cambiado de entidad" cuando ejecutaba
con doble click. Pero al probar desde la regla solo cambiaba la identidad
y NO salía el texto — eso fue el bug raíz `.split('\\n')[0]` arreglado en
v1.0.95.

Acá replicamos ese mismo patrón en los 79 entries y reglas para que
TODAS las transformaciones del perfil Identity muestren actionbar. Plus,
agregamos también el nombre legible del mob al texto.

Formato del title que el user pidió:
    /title @a actionbar ["",
        {"text":"{username}","color":"gold","bold":true},
        {"text":" ha cambiado de entidad ","color":"gray"},
        {"text":"[Entidad]","color":"green","bold":true}
    ]

PRECONDICIÓN: MARU desktop debe estar CERRADO.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_runtime_override = os.environ.get("MARU_RUNTIME_DIR")
if _runtime_override:
    DATA_DIR = Path(_runtime_override).expanduser().resolve() / "data"
else:
    DATA_DIR = ROOT / "apps" / "runtime_data" / "data"

DATA_MC = DATA_DIR / "data_minecraft.json"


def actionbar_for(display_name: str) -> str:
    """Construye el comando /title @a actionbar para el mob dado.

    El display_name viene con emoji + nombre español (ej. "🐺 Lobo").
    Lo dejamos tal cual en el "[Entidad]" del actionbar (lookbar nice).
    Escapado JSON inline (comillas dobles → escapadas).
    """
    # Escape de comillas dobles dentro del payload (JSON dentro de JSON).
    safe = display_name.replace("\\", "\\\\").replace('"', '\\"')
    return (
        'title @a actionbar ["",'
        '{"text":"{username}","color":"gold","bold":true},'
        '{"text":" ha cambiado de entidad ","color":"gray"},'
        f'{{"text":"{safe}","color":"green","bold":true}}'
        "]"
    )


def main() -> None:
    if not DATA_MC.is_file():
        raise SystemExit(f"data_minecraft.json no existe en: {DATA_MC}")
    print(f"Leyendo: {DATA_MC}")
    doc = json.loads(DATA_MC.read_text(encoding="utf-8"))
    entities = doc.get("entities") or []
    if not isinstance(entities, list) or not entities:
        raise SystemExit("data_minecraft.json no tiene 'entities'")

    updated = 0
    skipped = 0
    for entry in entities:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name") or ""
        cmd = entry.get("command") or ""
        if not isinstance(name, str) or not isinstance(cmd, str):
            continue
        if "identity equip" not in cmd:
            # No es entry del mod Identity — no tocar
            continue
        if "actionbar" in cmd:
            # Ya tiene actionbar — saltear (idempotente)
            skipped += 1
            continue
        # Tomar la PRIMERA línea (el `execute as soykoru run identity ...`)
        # y mantenerla. Después del \n viene el actionbar.
        first = cmd.strip().split("\n")[0].strip()
        new_cmd = first + "\n" + actionbar_for(name)
        entry["command"] = new_cmd
        updated += 1

    DATA_MC.write_text(
        json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"\nResultado:")
    print(f"  ✓ Updated: {updated} entries")
    print(f"  ✓ Skipped (ya tenían actionbar): {skipped}")
    print(f"  Total entities: {len(entities)}")


if __name__ == "__main__":
    main()
