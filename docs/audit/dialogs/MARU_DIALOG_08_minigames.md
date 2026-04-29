# Diálogo 08 — `minigames_dialog.py` · MinigamesDialog (254 líneas)

> Panel para seleccionar, configurar y lanzar minijuegos interactivos.
> 3 minijuegos: **Sopa de Letras**, **Sopa Rápida**, **Bomba de Palabras**.

## Constructor

```python
MinigamesDialog(parent=None)
```

- minSize 520x580.

### Signals
- `game_started(object)` — emite la instancia de `WordSearchGame`.
- `bomb_started(object)` — emite la instancia de `WordBombGame`.
- `lite_started(object)` — emite la instancia de `WordSearchGame` (modo lite).

## Layout

### Header
- Title `MINIGAMES` (Segoe UI 20 bold ACCENT, letter-spacing 3).
- Sub `Juegos interactivos para tu stream en vivo`.

### Tab/group 1 · `Sopa de Letras`
Descripción: *"Los jugadores escriben !game para unirse. Escriben inicio
y fin de una palabra: A1 C3. El primero en encontrar más palabras gana."*

#### Form
- `_ws_category` (QComboBox) cargado desde `WordSearchGame.get_categories()`:
  ```
  animales, comida, paises, deportes, colores, gaming, musica,
  minecraft, terror, naturaleza, espacio, mitologia, tecnologia,
  profesiones, cuerpo, ropa, cine, historia, oceano
  ```
  Display custom desde `_CAT_DISPLAY` dict (capitalizado).
- `_ws_word_count` (QSpinBox 4–12, default 8).
- `_ws_rows` (QSpinBox 8–15, default 10, suffix `" filas"`).
- `_ws_cols` (QSpinBox 8–15, default 10, suffix `" cols"`).

#### Botones (gradient)
- `Iniciar Sopa de Letras` (gradient ACCENT→naranja) → `_start_wordsearch`:
  - Crea `WordSearchGame(rows, cols)`.
  - `game.generate(cat, words)`.
  - Si OK: emite `game_started(game)` y `accept()`.
- `Iniciar Sopa Rápida ⚡` (gradient turquesa) → `_start_lite`:
  - Mismo proceso pero emite `lite_started(game)`.
  - Tooltip: *"Solo la grilla, sin pistas. Rondas automáticas."*

### Tab/group 2 · `Bomba de Palabras`
Descripción: *"Los jugadores escriben !game para unirse, luego inicias.
Se muestra una sílaba y el jugador actual debe escribir una palabra que
la contenga antes de que explote la bomba. Si completa el abecedario
(A-Z) gana una vida extra."*

#### Form
- `_wb_time` (QSpinBox 5–30, default 15, suffix `" seg"`).
- `_wb_lives` (QSpinBox 1–5, default 3).

#### Botón
- `Abrir Bomba de Palabras` (gradient rojo) → `_start_wordbomb`:
  - `WordBombGame(turn_time, lives)`.
  - Emite `bomb_started(game)` y `accept()`.

### Footer
- Info: *"Los minijuegos solo consumen recursos mientras están activos."*

## Notas para el port

- **3 minijuegos** confirmados (no 2 como decía la memoria — además de
  WordSearch normal, hay WordSearchLite que reusa la clase pero corre
  en otra ventana).
- **19 categorías** de palabras. Cada una con N palabras en
  `core/spanish_words.py` (1243 líneas — auditar en G0.6).
- **Configuración por minijuego** se pasa al constructor del game (no
  se persiste por diálogo — el game vive solo mientras está activo).
- **Validación pre-launch**: `game.generate(cat, words)` puede fallar si
  no hay suficientes palabras de esa categoría — muestra warning.
- **Window dispatch** se hace desde el `MainWindow._on_*_started`:
  - `WordSearchWindow(game)` 470x800
  - `WordBombWindow(game)` 470x800
  - `WordSearchLiteWindow(game)` (sin tamaño fijo).
