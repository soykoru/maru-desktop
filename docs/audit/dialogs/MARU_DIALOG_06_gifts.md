# Diálogo 06 — `gifts_dialog.py` · GiftsDialog (652 líneas)

> Galería completa de las **415 PNG de donaciones** + edición visual.

## Funciones top-level

### `_read_png_metadata(filepath) → dict`
Lee chunks `tEXt` del PNG. Devuelve `{key: value}` con
`Gift-Name`, `Gift-Coins`, etc.

### `scan_donaciones_folder() → dict`
Recorre `DATA_DIR / "donaciones"`, salta archivos que empiezan con `_`,
extrae metadatos, devuelve catálogo:

```python
{
  gift_id (lower, _ as separator): {
    "name": str,
    "coins": int,
    "icon": "",
    "icon_path": str (full path),
    "file": filename
  }
}
```

> Esto explica cómo se popula `gifts.json` automáticamente desde la
> carpeta — los **415 PNG** vienen con metadata embebida.

## Constructor

```python
GiftsDialog(parent, gifts: dict)
```

- minSize 950x750.
- `gifts.copy()` — modificaciones se persisten al hacer Accept.
- Default sort: ASCENDING (`Menor a Mayor`).
- `show_disabled = False`.

## Layout

### Header
- Title `Donaciones de TikTok Live` (font 18 bold ACCENT).

### Toolbar
- `gift_search` (QLineEdit) — `Buscar donacion por nombre...`,
  con timer de debounce 150ms (`_search_timer`).
- `sort_btn` (toggle) — `Menor a Mayor` ↔ `Mayor a Menor` (fixed 130px).
- `show_disabled_cb` (QCheckBox) — `Mostrar desactivadas`.
- `import_btn` (QPushButton) — `Importar desde carpeta` →
  `import_from_folder()` que llama `scan_donaciones_folder()` y
  reemplaza/añade.

### Content split (3:1)

#### Grid de cards (izquierda, minWidth 580px)
- `GiftCardWidget` por gift (≈110x135px).
  - Imagen 80x80 (PNG real o `DEFAULT_IMAGE = Rose_black_white.png`).
  - Nombre truncado a 12 chars + `..` con tooltip = nombre completo.
  - Coins (10px, color `#f9ca24` bold).
- 5 columnas.
- Click → `on_card_clicked` (selecciona + carga preview).
- Doble-click → `on_card_double_clicked` (lo mismo en este diálogo).
- Card seleccionada: border 2px CARD_SELECTED_BORDER + bg CARD_SELECTED_BG.
- Card disabled: `set_disabled_look(True)` con bg gris y texto gris.

#### Preview/edit panel (derecha, minWidth 300, maxWidth 340)

GroupBox `Detalle de donacion`:
- `preview_image` (180x180) — pixmap escalado.
- `preview_name` (label 16px bold).
- `preview_coins` (label 14px amarillo).
- `preview_id` (label 11px gris) — `ID: <gid>`.

Form de edición (compacto):
- `edit_name` (QLineEdit).
- `edit_id` (QLineEdit, **disabled** cuando se está editando — el ID
  no se puede cambiar para no romper referencias en reglas).
- `edit_coins` (QSpinBox 0–999.999).
- `edit_icon_path` (QLineEdit readonly) + botón `📂` (36px) →
  `browse_icon` con QFileDialog filtro
  `Imagenes (*.png *.jpg *.jpeg *.gif *.webp *.ico)`,
  start_dir = `DATA_DIR / "donaciones"`.
- `edit_enabled` (QCheckBox) — `Donacion activa`.

Botones de acción:
- `Guardar cambios` (verde) → `save_gift`.
- `Eliminar` (rojo) → `delete_gift`.
- `+ Nueva donacion` → `new_gift` (limpia el form).

### Footer
- `count_label` — `Mostrando: X | Total: Y | Desactivadas: Z`.
- QDialogButtonBox Ok | Cancel.

## Métodos clave

### `refresh()`
Limpia cards, ordena por `coins` (asc/desc), y crea
`GiftCardWidget` para cada gift activo (o todos si
`show_disabled`). Aplica filtro de búsqueda al final.

### `_apply_filter()`
- Hide cards que no matchean (`name` o `gid` lower).
- Reposiciona en grid sin huecos.

### `save_gift()` / `delete_gift()` / `new_gift()`
Modifica `self.gifts` dict y llama `refresh()`.

### `import_from_folder()`
Llama `scan_donaciones_folder()` → para cada gift importado, si no
existe en `self.gifts` lo añade; si existe, actualiza nombre/coins/icon
preservando `disabled`.

### `get_gifts() → dict`
Devuelve `self.gifts`. Usado por MainWindow para `custom_gifts`.

## Estructura del `gifts.json`

```python
{
  "<gift_id>": {
    "name": "Rose",
    "icon": "",                   # Reservado / no usado
    "coins": 1,
    "icon_path": "C:/.../data/donaciones/Rose.png",
    "disabled": False
  },
  ...
}
```

> Confirmar en G0.7. Las **415 PNG** se mapean 1:1 a este dict.

## Notas para el port

- **PNG metadata** (`tEXt` chunks): es un patrón menos común. En el port
  podemos leer el JSON `gifts.json` directo sin re-parsear PNGs cada vez.
  El "Importar desde carpeta" es un fallback para reconstruir el JSON
  desde los archivos.
- **Doble-click no edita**, solo re-selecciona. La edición es vía form.
- **ID locked en edición** es importante para no romper referencias en
  reglas existentes.
- **`Rose_black_white.png`** es el placeholder universal cuando no hay
  PNG (verificar que existe en `data/donaciones/`).
- **Galería 5 columnas, cards 80x80 imagen**, badge de monedas amarillo
  como Tikfinity.
- **Search con debounce 150ms**.
