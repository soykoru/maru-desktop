# Diálogo 04 — `entity_selector.py` · EntitySelectorDialog (614 líneas)

> Selector visual con galería para entidades / items / eventos / valuables.
> Soporta **multi-selección con tabs de categoría y cantidad por item**.

## Constructor

```python
EntitySelectorDialog(
    parent, entries: list, game_id: str, category: str,
    entity_images: dict = None, preselected: str = "",
    category_label: str = "",
    all_categories: dict = None,
    multi_select: bool = False,
)
```

### Parámetros importantes
- `entries` — lista clásica para una sola categoría (legacy).
- `all_categories` (preferred) — dict con TODAS las categorías:
  ```python
  {
    "entities": {"entries": [...], "label": "Entidades", "images": {...}},
    "items":    {"entries": [...], "label": "Items",     "images": {...}},
    "events":   {"entries": [...], "label": "Eventos",   "images": {...}},
    "valuables": {...}
  }
  ```
- `multi_select=True` → muestra tabla de selecciones a la derecha + cada
  card incrementa al click (en vez de seleccionar exclusivo).
- `preselected` — display_name a marcar inicialmente.

- minSize 900x700, resize 950x780.
- Title: `"Seleccionar Acciones"` (multi) o `"Seleccionar <label>"`.

## Layout

### Tab bar (visible solo si len(all_categories) > 1)
- `tab_bar = QTabBar()` con `setExpanding(True)`.
- Estilo custom: tabs con padding 10x18px, border-bottom 2px
  `ACCENT_BLUE` cuando seleccionado.
- Cambio de tab → recarga grid con entries de esa categoría.

### Search bar
- QLineEdit `Buscar...`.

### Grid de `_EntityCard` (110x130px)
- Imagen 72x72 (lazy loaded con `defer_image=True` para grids grandes).
- Nombre truncado.
- Comando truncado.
- Click → `_on_card_click`:
  - **Single-select**: marca como seleccionada, deselecciona la anterior.
  - **Multi-select**: abre o incrementa la selección — los cards
    seleccionados muestran fondo verde claro `rgba(85,239,196,0.3)`
    border `#55efc4` (`set_in_selection`).
- Doble-click → `_on_card_double_click`:
  - **Single-select**: acepta diálogo.
  - **Multi-select**: incrementa cantidad.

### Panel de selecciones (visible solo en multi_select)

Lista vertical scrollable con `_SelectionRow` (40px alto):
- Imagen 28x28.
- `cat_label` con color morado (70px wide).
- Nombre truncado a 18 chars.
- `x` separator.
- `amount_spin` (QSpinBox 1–999.999, 60px wide, sin botones).
- Botón `✕` rojo redondo (24x24) → `_remove_selection`.

### Botones inferiores
- Para multi: `Aceptar (<n> seleccionadas)` y `Cancelar`.
- Para single: `Aceptar` y `Cancelar`.

## Métodos públicos

### Single-select
```python
get_selected() → tuple[str, int]   # (display_name, amount)
```
Devuelve display_name del card seleccionado y amount default 1.

### Multi-select
```python
get_multi_selected() → list[dict]
# Cada item:
{
  "display_name": str,
  "amount": int,
  "category": str (cat_id),
  "cat_label": str,
}
```

## `_load_image()` (lazy loading)
Cards instanciadas con `defer_image=True` no cargan la imagen hasta que
se llame `_load_image()`. Útil para grids con cientos de items: solo
cargar las visibles en pantalla via IntersectionObserver-equivalent (no
implementado en el original — el original carga todas al construir).

## Notas para el port

- **Multi-select con tabs por categoría** es UN componente reutilizable
  crítico — se usa desde:
  - `RuleDialog._open_unified_gallery` (selector de acciones).
  - `RuleDialog._edit_action.open_edit_gallery` (single-select para editar
    una acción ya creada).
  - `MainWindow._quick_change_entity` (cambiar acción rápida desde
    item de la lista de reglas).
- **Estilos exactos**:
  - Card normal: bg CARD_BG, border 1px CARD_BORDER, radius 8px.
  - Card hover: border ACCENT_BLUE, bg CARD_BG_HOVER.
  - Card selected (single): bg CARD_SELECTED_BG, border 2px ACCENT_BLUE.
  - Card "in selection" (multi): bg `rgba(85,239,196,0.3)`, border `#55efc4`.
- **Selección row** con label de categoría color morado (`#a29bfe`).
- **Spinbox de cantidad** sin botones, font bold 12px.
- **Lazy image loading** — implementar en React con IntersectionObserver
  o `<img loading="lazy">`.
