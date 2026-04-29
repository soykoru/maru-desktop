# Diálogo 13 — `simulator_dialog.py` · SimulatorDialog (688 líneas)

> Simular eventos TikTok sin estar en vivo. Galería visual de gifts +
> presets rápidos + repeat para test de carga.

## Constructor

```python
SimulatorDialog(parent, custom_gifts: dict,
                execute_callback, log_callback)
```

- minSize 780x740, resize 800x760.
- `_sort_descending = True` (default).
- Ventana modal.

## Layout

### Header (52px) — gradient morado
- Title `Simulador de Eventos` (Segoe UI 17 bold ACCENT).
- Hint derecha `"Prueba sin estar en vivo"` (TEXT_HINT 10).

### Body (scrolleable)

#### Form panel
- Row "Evento" → `_type_combo` (height 36):
  - `🎁  Regalo` → `gift`
  - `💬  Comentario` → `comment`
  - `➕  Follow` → `follow`
  - `📤  Compartir` → `share`
  - `⭐  Super Fan` → `subscribe`
  - `❤️  Like` → `like`
- Row "Usuario" → `_user_input` (default `"TestUser"`).

#### Gift Section (visible solo cuando type = gift)
- `_gift_search` (QLineEdit) — `🔍 Buscar regalo...` con clear button.
- `_sort_btn` (`⬇ Mayor` / `⬆ Menor`, fixed 105x34px).
- `_gift_count_lbl` con número de visibles.
- **Selected preview bar** (42px) con icono, nombre, monedas.
- **Grid de gift cards** (`_SimGiftCard`, 100x92px) en QScrollArea
  fixed 220px alto:
  - Icon 40x40 (PNG escalado de `data/donaciones/<gift>.png` o
    fallback `Rose_black_white.png`, o fallback emoji `🎁`).
  - Nombre truncado a 12 chars + `..`.
  - Monedas `<n> 💎` en bold amarillo `#f9ca24`.
  - 6 columnas.

Solo gifts con `disabled=False`. Sort por `coins`.

#### Comment Section (visible solo cuando type = comment)
- `_comment_input` (QLineEdit) — placeholder
  `"Comentario o comando (ej: !spawn, !ia hola)"`.

#### Likes Section (visible solo cuando type = like)
- Spinbox/input con cantidad de likes.

### Action row
- Botón `Simular Evento` (gradient verde, 46px alto, font 12 bold).
- Label `Repetir:`.
- `_repeat_spin` (QSpinBox 1–100, fixed 70x46px).
- Botón `Enviar` (gradient morado, 46px) → `_burst()` ejecuta en ráfaga.

### Atajos Rápidos (`Atajos Rápidos` label en ACCENT)
Grid 5 columnas con 10 `_PresetButton` (fixed 90x76px):

| Icon | Label | Tipo | Valor |
|------|-------|------|-------|
| 🌹 | Rosa | gift | rose |
| 🌌 | Galaxy | gift | galaxy |
| 🦁 | León | gift | lion |
| 💎 | Diamante | gift | diamond |
| ➕ | Follow | follow | "" |
| 📤 | Share | share | "" |
| ⭐ | SuperFan | subscribe | "" |
| ❤️ | 10 Likes | like | "10" |
| 💬 | !spawn | comment | "!spawn" |
| 💬 | !ia hola | comment | "!ia hola" |

Cada preset llama `_quick(etype, val)`.

### Footer (44px)
- `_status` label (default `"Listo para simular"`).
- Botón `Cerrar` (fixed 100x34).

## Métodos clave

### `_simulate()`
Construye `data` desde `_build_event_data()` y llama
`_execute(etype, data)` (callback al MainWindow). Log + `_flash_status`.

### `_burst()`
Ejecuta `_simulate()` N veces (N = `_repeat_spin.value()`).
Status `Enviando ráfaga de N eventos...`.

### `_quick(etype, value)`
Setea `_type_combo` al evento, escribe el value en el campo correcto, y
ejecuta `_simulate()` directo.

### `_build_event_data() → dict`
Construye el dict según el tipo:
- `gift` → `{user, gift_name, gift_id, count}`.
- `comment` → `{user, text, unique_id}`.
- `like` → `{user, count}`.
- `follow / share / subscribe` → `{user}`.

### `_flash_status(etype, data)`
- Setea status con icono + texto (ej: `🎁 TestUser envió rose`).
- `QTimer.singleShot(2000, lambda: status.setText("Listo para simular"))`.

## Notas para el port

- **3 secciones que se ocultan/muestran** según el tipo seleccionado
  (gift / comment / likes).
- **Galería de gifts compacta** con cards 100x92 (vs cards 120x... de
  GiftSelectorDialog). Mismo patrón pero más small.
- **Presets** son atajos a casos comunes — replicar los 10 exactos.
- **Burst mode** importante para test de carga del rule_engine.
- **Diálogo es modal** — bloquea la app (en MainWindow se abre con
  `_wm_exec`).
- **Status temporal** con QTimer.singleShot — replicar con setTimeout.

## Eventos / triggers que el simulador puede emitir

Los **6** mismos del TikTokWorker original:
- `gift, follow, share, subscribe, comment, like`.

Notar que NO existe trigger directo de `like_milestone` (usa eventos like
acumulados) ni `command` (usa comments con `!`).
