# Diálogo 05 — `gift_selector.py` · GiftSelectorDialog (275 líneas)

> Selector rápido de gift visual para asignar a una regla.

## Constructor

```python
GiftSelectorDialog(parent, custom_gifts: dict, preselected_id: str = "")
```

- minSize 750x550.
- `sort_ascending = False` (default: mayor a menor).

## Layout

### Header
- Label info: `"Selecciona la donacion que activara esta regla"`.

### Toolbar
- `search` (QLineEdit) — `Buscar donacion...` con clear button.
- `sort_btn` toggle `Mayor a Menor` ↔ `Menor a Mayor`.

### Preview bar (60px alto)
- Frame con bg CARD_BG, padding 4px.
- `preview_img` (48x48).
- `preview_name` (14 bold).
- `preview_coins` (13 bold amarillo).
- `preview_id_label` (10px gris) — `ID: <gid>`.

### Grid de `_SelectorCard` (100x130px)
- Imagen 72x72 (PNG real o `Rose_black_white.png` fallback).
- Nombre truncado a 11 chars + `..` + tooltip.
- Coins en amarillo `#f9ca24`.
- 6 columnas.
- Click → `_on_card_click` (selecciona + actualiza preview).
- Doble-click → selecciona + acepta diálogo.

### Footer
- `count_label` — `<n> donaciones disponibles` o `<n> donaciones encontradas`.
- QDialogButtonBox Ok | Cancel.

## Filtrado

`_apply_filter()` con timer de debounce **150ms**:
- Hide cards que no matchean `name` o `gid` lower.
- Reposiciona en grid sin huecos.

## Métodos públicos

```python
get_selected() → tuple[str, dict]   # (gift_id, gift_data)
```

Devuelve el ID y dict completo del gift seleccionado. Si no hay
selección, llama `QMessageBox.warning(...)` en `_on_accept`.

## Notas para el port

- **Subset de `GiftsDialog`**: solo selección, no edición.
- **Cards 100x130** (más altas que las de simulator 100x92, más bajas
  que las de gifts_dialog 110x135).
- **Default sort descendente** (gifts caros primero).
- **Solo gifts con `disabled=False`** se muestran (filtrado en
  `_rebuild_grid`).
- **Doble-click acepta directo** — patrón rápido de selección.
