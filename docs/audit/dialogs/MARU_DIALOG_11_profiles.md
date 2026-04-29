# Diálogo 11 — `profiles_dialog.py` · StreamProfilesDialog (762 líneas)

> Gestor de **Perfiles de Stream** = snapshots completos de la app
> (juego + reglas + regalos + sonidos + voces + TTS).

## Constructor

```python
StreamProfilesDialog(
    parent, profiles_dir: Path, current_game: str,
    custom_games_config: dict,
    save_callback, load_callback, delete_callback,
    current_rules_count: int = 0
)
```

- minSize 880x640.
- Signal `profile_loaded` (sin args) que emite cuando se carga un perfil.
- Iconos por juego en const `GAME_ICONS`:
  ```
  minecraft: ⛏️, terraria: 🌳, valheim: ⚔️,
  7daystodie: 🧟, ror2: ☄️, hytale: 🎮, repo: 📦
  ```
- Custom games del config aportan su propio `icon`.

## Layout

### Header (62px)
- Titulo `Perfiles de Stream` en bold 18px color ACCENT.
- `_counter_lbl` derecha — `<n> perfiles guardados`.
- Background: `gui_constants.header_gradient("rgba(52,73,94,0.7)")`.

### Explanation panel
- Texto explicando qué es un perfil y qué guarda.

### Body (split 3:2)
- **Izquierda (3)**: lista de cards de perfiles + filtro.
- **Derecha (2)**: panel de detalles + acciones.

### `_ProfileCard` (sub-clase)
Tarjeta horizontal de 82px con:
- **Icono** (48px) = del juego (custom o predefinido).
- **Nombre** (Segoe UI 13 bold).
- **Sub** (Segoe UI 10): `<game_title>  ·  <enabled>/<total> reglas  ·  <gifts> regalos`.
- **Right column**: fecha `created[:10]` + tamaño file (`<n> B/KB/MB`).
- Click emite `clicked` → `_select_card`.
- Selected: fondo `CARD_SELECTED_BG` + border 2px `CARD_SELECTED_BORDER`.

### Footer
Botones de acción.

## Acciones (todas requieren un perfil seleccionado)

### `_on_load`
Modal de confirm que dice qué se va a reemplazar:
- `Juego → <game>`
- `<rules_count> reglas`
- `<gifts_count> regalos`
- `Sonidos, voces y TTS`

→ "Se creará un backup automático antes de cargar".

Llama `load_callback(pid)` y emite `profile_loaded`. Cierra diálogo.

### `_on_save`
Llama `save_callback()` (que en MainWindow guarda el perfil actual con
todos sus datos) y `_populate()` para refrescar.

### `_on_duplicate`
- QInputDialog pidiendo nombre, default `<old> (copia)`.
- ID = `name.lower().replace(" ", "_").replace("-", "_")`.
- Si el archivo ya existe: warning.
- Crea copy del JSON con `name`, `profile_id`, `created` (now ISO).

### `_on_rename`
- QInputDialog con name actual.
- Si el ID nuevo ya existe (y es diferente del actual): warning.
- Reescribe el JSON al nuevo path y borra el viejo.

### `_on_export`
- QFileDialog → guarda como `<name>.lce_profile.json`.
- Filtro: `Perfiles LiveChaos (*.lce_profile.json);;Todos (*.*)`.
- Estructura del export:
  ```json
  {
    "export_version": "1.0",
    "exported_at": "<iso>",
    "profile": <data>
  }
  ```

### `_on_import`
- QFileDialog acepta `*.lce_profile.json` o `*.json`.
- Validar JSON. Si tiene `export_version + profile` usa `data = raw["profile"]`,
  si no usa raw directo (legacy).
- Validar que tiene `"game"` (campo obligatorio).
- QInputDialog para nombre (default = original).
- Si el ID nuevo existe: pedir confirmación de sobrescribir.
- Marca con `imported_at` (ISO).

### `_on_delete`
- QMessageBox.question — `¿Eliminar «<name>» permanentemente?`.
- Borra archivo.

## Schema del JSON `stream_profiles/<id>.json`

Inferido del código (no es exhaustivo — auditar `gui/views/stream_profiles.py`
para el formato completo):

```json
{
  "profile_id": str,
  "name": str,
  "game": str,
  "created": "<iso>",
  "imported_at": "<iso>"?,
  "rules": [...],
  "custom_gifts": {...},
  "sounds": {...},
  "voices": {...},
  // y todo lo que escriba save_callback en G0.5
}
```

## Notas para el port

- **Cards en grid vertical** scrolleable, con select por click.
- **Icons resolved**: `custom_icons[gid]` primero → `GAME_ICONS[gid]` →
  fallback `🎮`.
- **File size** con switch B/KB/MB.
- **Backup auto antes de cargar** — el callback `load_callback` hace eso
  (no este diálogo directamente). El mensaje del modal lo promete.
- **Drag&drop** para importar archivos: NO implementado (solo botón).
- **Sin filtro de búsqueda** visible en este código (revisar
  `_apply_filter` línea 549 si lo hay).
