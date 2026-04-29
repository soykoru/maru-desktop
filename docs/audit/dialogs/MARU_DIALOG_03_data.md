# Diálogo 03 — `data_dialog.py` · DataDialog (625 líneas)

> Gestión visual de **entidades / items / eventos / valuables** con
> tarjetas, preview y edición lateral. Persiste en
> `data_<juego>.json[<categoria>]`.

## Constructor

```python
DataDialog(parent, title: str, data: list, game,
           action_type: str, game_id: str,
           game_name: str = "", custom_tutorial: str = "")
```

- `action_type` ∈ `entity | item | event | <custom>`. Mapeado a
  `category ∈ entities | items | events | <custom>`.
- minSize 950x700.
- `data.copy()` — modificaciones se persisten al hacer Accept.
- `_img_dir = DATA_DIR / "game_images" / game_id / category`.
  Se crea si no existe.

## Constantes

```python
IMG_SIZE_CARD = 64
IMG_SIZE_PREVIEW = 140
IMG_SIZE_COPY = 128
IMG_SIZE_LIST = 48
```

## Layout

### Header
- Title `<game_name> — <type_name>` (16px bold ACCENT).
- `type_labels = {entity: Entidades, item: Items, event: Eventos/Comandos}`.

### Toolbar
- `search_input` (QLineEdit) — `Buscar <type_name.lower()>...`.
- `count_label` derecha — `<n> elementos` (color TEXT_MUTED).

### Content split (3:1)

#### Grid de `_EntryCard` (izquierda, minWidth 560)

Card 120x120px:
- Imagen 64x64 (PNG de `game_images/<game>/<category>/<entry>.png` o
  default).
- Nombre truncado a 12 chars + `..` con tooltip
  `<display_name>\n→ <command>`.
- Si `display_name != command`: muestra el `command` truncado debajo
  en gris.

#### Preview/edit panel (derecha, 300–350px)

GroupBox `Detalle`:
- `preview_image` (140x140) con border y bg PANEL_BG.
- `preview_name` (15px bold).
- `preview_cmd` (11px gris) — `→ <comando>`.

Form de edición:
- `edit_name` (QLineEdit) — placeholder `Nombre visible`.
- Si **es event** o **es minecraft**:
  - `edit_cmd` (QPlainTextEdit) — placeholder
    `"Comando(s) RCON — uno por línea\n\nVariables: {user}, {username}"`.
- Si no:
  - `edit_cmd_line` (QLineEdit) — placeholder `"Comando / ID del juego"`.
- `edit_icon_label` (QLineEdit) — placeholder `"Sin imagen personalizada"`.
  + botón browse → `_browse_image` (QFileDialog).

Botones:
- `Guardar` / `Eliminar` / `Probar` (`_test_entry`) /
  `Nueva` (`_new_entry`) / `Mostrar ayuda` (`_show_help`).

### Botones globales
- QDialogButtonBox Ok | Cancel.

## Métodos clave

### `_test_entry()`
Verifica connection del juego, ejecuta:
- `entity` → `game.spawn(cmd, 1, "TestUser")`.
- `item` → `game.give_item(cmd, 1, "TestUser")`.
- `event` → `game.trigger_event(cmd, "TestUser")`.

### `_save_image_for_entry(cmd) → path | None`
Copia la imagen seleccionada a `game_images/<game>/<category>/<cmd>.png`
y retorna el path.

### `_get_icon_path(entry) → str`
Busca PNG en orden:
1. `game_images/<game>/<category>/<command>.png`.
2. Default category icon (de `default_images.get_default_for_category`).

### `refresh()`
Recrea las cards desde `self.data`. Limpia y repobla el grid.

### `_apply_filter()`
Hide cards que no matchean `display_name` lower.

### `_show_help()`
Muestra QMessageBox con `_get_instructions()`:
- Si hay `custom_tutorial` desde `games.json[<juego>].categories[<cat>].tutorial`:
  lo muestra.
- Si no: muestra defaults por tipo de juego (valheim/terraria/minecraft).

### `get_data() → list`
Lista de strings con formato `"NombreVisible:Comando"`.

## Formato de cada entry

`entry` es un string con formato `"NombreVisible:Comando"`.
`get_display_name(entry)` y `get_command(entry)` (de `core.rule_engine`)
parsean `:` y devuelven cada parte.

Si no hay `:`, asume `display_name == command`.

## Notas para el port

- **Cards 120x120 con imagen 64x64** — más compactas que las de gifts.
- **PNG por entry** se guarda como `<command>.png` (no `<display_name>.png`)
  — usar el comando como key del filename evita problemas con espacios.
- **Tutorial inline** en `_show_help` — se debe poder pasar un texto
  custom desde `games.json`.
- **edit_cmd** es `QPlainTextEdit` (multiline) para Minecraft + events,
  pero `QLineEdit` para items/entities en juegos no-RCON.
- **Probar in-place** sin guardar — útil para iterar.
- **Auto-create** `_img_dir` al boot del diálogo.
