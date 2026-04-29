# Diálogo 02 — `custom_game_dialog.py` · CustomGameDialog (837 líneas)

> Crear / editar juego custom con categorías declarativas
> (entity / item / event) y endpoints/payloads/RCON commands por categoría.

## Constructor

```python
CustomGameDialog(parent, game_config: dict | None)
STANDARD_GAMES = ["valheim", "terraria", "minecraft"]
```

- `is_edit = bool(game_config)`.
- `is_standard_game = id ∈ STANDARD_GAMES` → modo limitado (solo permite
  editar host/port/RCON password + nombres de pestañas; NO permite
  modificar categorías).
- minSize: `700x500` (estándar) o `700x800` (custom).
- Title: `✏️ Editar Juego` o `➕ Añadir Juego Personalizado`.

## Layout (todo dentro de `QScrollArea`)

### `📋 Información Básica`
- `game_id` (QLineEdit) — placeholder `"ark, 7daystodie, rust, etc."`.
  En modo edición: `setEnabled(False)`.
- `game_name` — placeholder `"ARK: Survival, 7 Days to Die..."`.
- `game_icon` (QLineEdit, max 60px) — placeholder `"🦖, 🧟, 🔫..."`,
  default `"🎮"`.

### `🔌 Tipo de Conexión`
- 2 RadioButton: `🌐 HTTP` / `🎮 RCON` (default desde `connection_type`).
- Para juegos estándar: oculto (cada juego tiene su propio método).

### `🔗 Conexión`
- `host` (QLineEdit, default `"localhost"`).
- `port` (QSpinBox 1–65535, default 5000).
- `rcon_password` (QLineEdit, `EchoMode.Password`).

### Para juegos ESTÁNDAR · `📁 Nombres de Pestañas`
Solo permite editar texto visible de las 3 pestañas fijas:
- `tab_name_entities` (default `"🐉 Entidades"`)
- `tab_name_items` (default `"📦 Items"`)
- `tab_name_events` (default `"⚡ Eventos"`)

> Hint: *"Los juegos principales no permiten añadir/eliminar categorías"*.

### Para juegos CUSTOM · `📁 Categorías de Datos (Pestañas)` ⭐
- `cat_list` (QListWidget, max 150px alto).
- Botones: `➕ Añadir` / `✏️ Editar` / `🗑️ Eliminar`.
- Al seleccionar una categoría, se carga su config en el grupo siguiente.

### `⚙️ Configuración de Categoría Seleccionada`
- `cat_endpoint_edit` (QLineEdit) — placeholder `"/spawn, /item, /command..."`.
- `cat_payload_edit` (QLineEdit) — placeholder
  `'{"entity_name": "{entity}", "amount": {amount}}'`.
- `cat_rcon_cmd_edit` (QLineEdit) — placeholder `"summon {entity}"`.
- `cat_tutorial_edit` (QPlainTextEdit max 100px) — texto que se muestra
  cuando el usuario abre el editor de datos de esa categoría.

> Cualquier cambio en estos 4 inputs llama `_save_category_config` que
> actualiza `custom_categories[selected_index]` en vivo.

### `🎯 Presets`
4 botones que cargan plantillas completas (tipo conexión + puerto +
categorías con endpoints/payloads/RCON):

- **Valheim**: HTTP, port 5000, 2 categorías (entities + items).
- **Terraria**: HTTP, port 5000, 3 categorías (entities + items + events).
  Los endpoints terminan en `/`.
- **7 Days**: HTTP, port 8089, 3 categorías.
- **Rust RCON**: RCON, port 28016, 3 categorías con RCON commands.

Cada preset llama `_refresh_categories()` y selecciona la primera fila.

### Páginas HTTP/RCON legacy (`config_stack`)
- Se mantienen widgets ocultos para compatibilidad con código viejo:
  `spawn_endpoint`, `item_endpoint`, `event_endpoint`,
  `spawn_payload`, `item_payload`, `event_payload`,
  `rcon_item_cmd`, `rcon_event_cmd`.
- Solo cambian la página visible cuando se cambia el RadioButton
  HTTP/RCON.

## Métodos públicos

### `validate_and_accept()`
- ID obligatorio.
- ID solo `[a-zA-Z0-9_]`.
- ID mínimo 2 chars.

### `get_config() → dict`

#### Para juegos ESTÁNDAR:
```python
{
  "id", "name", "icon", "host", "port",
  "tab_names": {"entities", "items", "events"}
}
# Para minecraft: + "rcon_password"
```

#### Para juegos CUSTOM:
```python
{
  "id", "name", "icon", "host", "port",
  "connection_type": "rcon" | "http",
  "has_entities": bool,   # any(c.type == "entity")
  "has_items": bool,
  "has_events": bool,
  "categories": [
    {"id", "name", "type", "icon", "data_key",
     "endpoint", "payload", "rcon_cmd", "tutorial"},
    ...
  ],
  # Legacy (primer endpoint/payload de cada tipo):
  "spawn_endpoint", "item_endpoint", "event_endpoint",
  "spawn_payload", "item_payload", "event_payload",
  "rcon_spawn_cmd", "rcon_item_cmd", "rcon_event_cmd",
  # Solo si rcon:
  "rcon_password"
}
```

### `_load_categories()`
- Carga `categories` de `game_config`.
- Si vacío: usa `has_entities/has_items/has_events` para crear las 3
  default con endpoints/payloads desde fields legacy.
- Si sigue vacío: crea 3 categorías default `entities/items/events`.
- Recorre `custom_categories` y asegura que cada una tenga
  `endpoint/payload/rcon_cmd` (rellena con defaults si faltan).

### `add_category()` — abre subdiálogo
QInputDialog (o similar) que pide ID + Nombre + Tipo (entity/item/event)
+ Icon. La nueva categoría se añade con endpoint/payload defaults
según el tipo.

### `edit_category()` / `del_category()` — sobre la categoría seleccionada.

## Variables del payload templating

- `{entity}` — nombre del entity/item/etc.
- `{amount}` — cantidad.
- `{user}` — username.
- `{username}` — alias de user.
- `{command}` — para events/commands.
- `{value}` — valor del comando si tiene.

## Notas para el port

- **`STANDARD_GAMES`** son los 3 predefinidos. Lo único que el usuario
  puede tocar de ellos es host/port/password/tab_names.
- **`tab_names`** dict permite renombrar las pestañas sin tocar el resto
  del código que sigue usando los keys `entities/items/events`.
- **Categorías custom** tienen 9 propiedades:
  - identidad: `id, name, type, icon, data_key`.
  - red: `endpoint, payload, rcon_cmd`.
  - UX: `tutorial`.
- **`type`** puede ser solo `entity / item / event` (no hay `valuable`
  como tipo declarable acá, pero sí hay `valuables` en el data del juego
  para REPO).
- **Live-update** de los 4 inputs de categoría → `_save_category_config`.
  En React equivale a `onChange` que actualiza el array de categorías.
