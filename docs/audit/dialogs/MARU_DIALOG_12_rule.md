# Diálogo 12 — `rule_dialog.py` · RuleDialog (1259 líneas)

> **El diálogo más crítico del producto**. Crear / editar reglas con
> trigger + acciones múltiples + cooldowns + TTS + filtro de usuarios.

## Constructor

```python
RuleDialog(parent, game_id: str, profile, voices: dict,
           rule: dict | None, custom_gifts: dict)
```

- `voices` = `TTSEngine.VOICES` (74 voces).
- `rule = None` → modo "Nueva", título `➕ Nueva Regla`.
- `rule = dict` → modo "Editar", título `✏️ Editar Regla`.
- Tamaño: minSize 650x800, resize 680x880.
- Stylesheet: `gui_constants.CURRENT_STYLE`.
- `actions_list = []` lista interna de acciones múltiples.
- `init_data` con `QTimer.singleShot(50, ...)` para evitar
  freeze de UI mientras se cargan.

## Layout (todo dentro de un QScrollArea con scrollbar minimalista 4px)

### Sección 1 · `📋 Información`
- `name` (QLineEdit) — placeholder `"Ej: Rosa = 5 Zombies"`.
- `event` (QComboBox) — los **7 trigger types**:
  - `🎁 Regalo (gift)` → `"gift"`
  - `💬 Comando (!cmd)` → `"command"`
  - `➕ Follow` → `"follow"`
  - `📤 Share` → `"share"`
  - `⭐ Super Fan` → `"subscribe"`
  - `❤️ Like (cada like)` → `"like"`
  - `🎯 Meta de Likes` → `"like_milestone"`

### Sección 2 · `🎁 Seleccionar Regalo/Trigger` (visible si trigger == gift)
- `trigger_search` (QLineEdit) — placeholder `"🔍 Buscar regalo..."` con
  `clearButtonEnabled`. Llama a `_filter_trigger_combo` en cada cambio.
- 2 botones de orden: `↓ Mayor` y `↑ Menor` (checkable, **default: descendente**).
- `trigger_combo` (QComboBox) con altura mínima 32 — todos los gifts en
  `custom_gifts` ordenados por `coins`. Cada item lleva PNG escalado a 20x20
  como icono.
- Botón `🖼️ Galería visual` → abre `GiftSelectorDialog` (Diálogo 05).
- `trigger_input` (QLineEdit, max 150px) para escribir ID manual.

### Sección 3 · `❤️ Configuración de Likes` (visible si trigger == like)
- `like_every` (QSpinBox 1–10000, default 10, sin botones).
- Hint: *"La regla se activará cada vez que se acumulen X likes"*.

### Sección 4 · `🎯 Meta de Likes` (visible si trigger == like_milestone)
- `like_milestone_value` (QSpinBox 100–1.000.000, default 1000, step 100).
- Hint: *"Se activará UNA VEZ cuando el stream alcance esta meta"*.

### Sección 5 · `💬 Configuración de Comando` (visible si trigger == command)
- `command_input` (QLineEdit) — placeholder `"!spawn, !zombie, !help..."`.

### Sección 6 · `👤 Usuarios permitidos (opcional)`
- `users_enabled` (QCheckBox) — `"Solo permitir usuarios específicos"`.
- `users_input` (QLineEdit) — desactivado hasta que el checkbox se active.
  Placeholder `"usuario1, usuario2, usuario3..."`.
- Hint: *"Deja vacío para permitir a todos. Separa usuarios con comas"*.

### Sección 7 · `⚡ Acciones` ⭐ (lo más importante del diálogo)

#### Lista de acciones añadidas (`actions_list_widget`)
- QListWidget de altura 130–180px.
- Doble-click sobre un item → `_edit_action(row)` abre subdiálogo.
- Display por item:
  - Si tiene `commands` y no `value`: `"<type_name> → 📝 <preview comando>"`.
  - Si no: `"<type_name> → <value> x<amount>"`.

#### Botones de gestión
- `🗑️ Eliminar`, `✏️ Editar`, contador `"<N> acción(es)"`.

#### Modo aleatorio
- `random_action_check` (QCheckBox) — `🎲 Modo Aleatorio`. Tooltip:
  *"En vez de ejecutar TODAS, ejecuta UNA al azar"*.

#### Formulario de añadir nueva acción
- `action_type` (QComboBox) cargado **dinámicamente desde
  `config.json` o `custom_games.json`** del juego activo.
  Cada item: `name → id` de la categoría definida en `categories[]`.
  Fallback si no hay categorías: usar `GAME_FEATURES` →
  `🐉 Entidad / 📦 Item / ⚡ Comando/Evento`.
- `action_combo` (QComboBox, minWidth 220px) cargado por
  `load_action_combo()` que lee `profile.get_display_<categoria>()` o
  `profile.get_category_data(data_key)`.
- Botón `🖼️ Galería` → abre `EntitySelectorDialog` con `multi_select=True`
  y todas las categorías visibles del juego. Si selecciona N, todas se
  agregan a la lista de acciones.
- Botón `🧪` → `test_action()`:
  - Para Minecraft: usa `cmds.toPlainText()` y `game.test_command(cmd, "TestUser")`.
    Detecta errores Minecraft (`Unknown`, `error`, `incorrect`, `<--[HERE`).
  - Para juegos con categorías custom y endpoint: usa
    `parent_win.send_to_game_with_category(cat, cmd, 1, "TestUser", game_id)`.
  - Fallback: `game.spawn/give_item/trigger_event` según mapeo
    `entity→spawn, item→give_item, event→trigger_event,
    valuable→spawn` (valuables usan give_item).
- **Solo Minecraft tiene** un `QPlainTextEdit` (`cmds`, max 60px alto)
  con placeholder `summon zombie ~ ~1 ~ {CustomName:'\"{username}\"'}`.
- `amount` (QSpinBox 1–999.999, default 1, sin botones).
- Botón `➕ Añadir Acción` → `_add_action()` valida y añade al `actions_list`.

### Sección 8 · `⏱️ Cooldown`
- `cooldown` (QSpinBox 0–3600, suffix `" seg"`, sin botones, minWidth 80px).

### Sección 9 · `🔊 Texto a Voz`
- `tts_on` (QCheckBox) — `"Activar TTS para esta regla"`.
- `tts_msg` (QLineEdit) — placeholder `"{user} envió {gift}"` (variables).
- `tts_voice` (QComboBox con TODAS las 74 voces de `voices`).

### Botonera final
- `QDialogButtonBox` Ok | Cancel.

## Subdiálogo "Editar Acción" (`_edit_action(row)`)
- Se abre al doble-click sobre un item de `actions_list_widget`.
- Tamaño: minSize 480x320.
- Form:
  - Tipo (label readonly): muestra `action_type_name`.
  - Valor: `QComboBox` con todas las opciones de la categoría +
    botón `🖼️` (40px) que abre `EntitySelectorDialog` (multi_select=False).
  - Cantidad: QSpinBox 1–999.999.
  - Comandos (solo si Minecraft o si la acción ya tenía comandos):
    `QPlainTextEdit` max 100px.
- Botones: `💾 Guardar` y `Cancelar`.

## Métodos públicos clave

### `get_rule() → dict`
Estructura exacta del JSON resultante:

```python
{
  "name": str,
  "enabled": True,                    # de self.rule.get("enabled", True)
  "trigger_type": str,                # gift|command|follow|share|subscribe|like|like_milestone
  "trigger_value": str.lower().strip(),
  # Compat (primera acción):
  "action_type": "spawn"|"give_item"|"trigger_event"|"spawn_valuable",
  "action_value": str,
  "commands": str,
  "amount": int,
  # Moderno:
  "actions": [{
    "action_type": cat_id,
    "action_type_name": label,
    "action_value": display_name,
    "amount": int,
    "commands": str
  }, ...],
  "random_action": bool,
  "cooldown": int,
  "tts_enabled": bool,
  "tts_message": str,
  "tts_voice": str | "es_mx_002",
  "allowed_users": [lowered_user, ...]
}
```

**Mapeo `action_type` ID → `atype` legacy** (para compatibilidad):
- `entity / entities` → `spawn`
- `item / items` → `give_item`
- `event / events` → `trigger_event`
- `valuable / valuables` → `spawn_valuable`

`trigger_value` se determina según el tipo:
- `like` → `str(like_every.value())`
- `like_milestone` → `str(like_milestone_value.value())`
- `command` → `command_input.text().strip()`
- `gift` → `trigger_input.text().strip()`
- `follow / share / subscribe` → vacío.

### `load_rule()` — restaura una regla existente
- Carga `name`, `trigger_type`, `trigger_value`.
- Para `like` / `like_milestone` / `command` setea sus widgets propios.
- Carga `actions` (formato moderno) o si no existe convierte
  el formato legacy (`action_type/value/amount/commands`) a una sola
  acción.
- Carga `random_action`, `cooldown`, `tts_*`, `allowed_users`.

## Patrón visual reutilizable a portar
- **2 modos del combo de gifts**: dropdown con icono PNG escalado 20x20
  + galería modal completa.
- **Selector unificado** (`EntitySelectorDialog`) con tabs por categoría
  cuando hay múltiples y multi-select.
- **Sub-secciones que se ocultan/muestran** según `event.currentData()`
  (4 paneles: gift / like / milestone / command).
- **Lista de acciones múltiples** dentro del mismo diálogo (no en wizard
  separado). Edit con sub-modal, drag-drop ausente (no se reordena
  manualmente).
