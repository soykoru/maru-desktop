# MARU Original — `core/minigames.py` (648) + `minigame_stats.py` (53) + `spanish_words.py` (1243)

> Lógica pura de minijuegos, sin GUI. Solo datos y algoritmos.

## `WORD_CATEGORIES` (en `minigames.py` lines 11-180+)

19 categorías hardcoded con palabras EN MAYÚSCULAS sin acentos:

1. **animales** (~48 palabras): GATO, PERRO, LEON, TIGRE, OSO, ...
2. **comida** (~46): PIZZA, TACO, SUSHI, PASTA, ...
3. **paises** (~46): PERU, CHILE, CUBA, JAPON, ...
4. **deportes** (~37): FUTBOL, TENIS, GOLF, ...
5. **colores** (~38): ROJO, AZUL, VERDE, ...
6. **gaming** (~38): MAGO, JEFE, VIDA, ARMA, MAPA, ...
7. **musica** (~39): ROCK, JAZZ, SALSA, REGGAE, ...
8. **minecraft** (~42): CREEPER, ZOMBIE, BLOQUE, ...
9. **terror** (~40): VAMPIRO, ZOMBIE, BRUJA, ...
10. **naturaleza** (~41).
11. **espacio** (?).
12. **mitologia, tecnologia, profesiones, cuerpo, ropa, cine, historia, oceano** (resto).

> El archivo `core/spanish_words.py` (1243 líneas) probablemente contiene
> palabras adicionales para wordbomb (sílabas + diccionario más amplio).

## `WordSearchGame` (búsqueda de palabras)

### Constructor
```python
WordSearchGame(rows: int = 10, cols: int = 10)
```

### `@dataclass WordPlacement`
- `word: str`, `row: int`, `col: int`, `direction: int` (0-7 para 8 direcciones), `cells: list`.

### `@dataclass PlayerState`
- `name: str`, `score: int = 0`, `words_found: list[str]`.

### Atributos
- `rows, cols, grid (list[list[str]]), placements (list), category, words`.
- `players: dict[name_norm, PlayerState]`.
- `active: bool`, `start_time: float`, `_timer_started`.

### `generate(category, word_count=8) → bool`
1. Selecciona `word_count` palabras random de `WORD_CATEGORIES[category]`.
2. Filtra palabras que quepan (len <= max(rows, cols)).
3. Para cada palabra: `_try_place_word` (max_attempts=100).
4. Llena celdas vacías con letras random A-Z.
5. Retorna True si pudo colocar al menos `word_count`.

### `_try_place_word(word, max_attempts=100)`
8 direcciones posibles (horizontal, vertical, 2 diagonales × 2 sentidos).
Random direction + random start. Verifica:
- Cabe en el grid.
- No colisiona con letras ya colocadas (excepto match exacto).

### `add_player(name) → bool`
- Verifica `active`.
- Crea `PlayerState(name)` si no existe.
- Returns True si fue agregado.

### `process_input(player_name, text) → dict`
Input format: `"A1 B2"` (start coord, end coord).

1. Parse coords con `_parse_coord` (ej `A1` → `(0, 0)`).
2. `_get_line_cells(r1, c1, r2, c2)` — calcula celdas en línea recta.
3. Verifica que coincida con alguna `WordPlacement`.
4. Si match:
   - `player.score += len(word) * 10`.
   - `player.words_found.append(word)`.
   - Returns `{"ok": True, "hit": True, "word": <word>, "finished": <bool>}`.
5. Si no match: `{"ok": True, "hit": False}`.

### `get_rankings() → list[(name, score)]`
Ordenado por score descendente.

### `get_categories() → list[str]` (classmethod)
Returns `list(WORD_CATEGORIES.keys())`.

## `WordBombGame` (bomba de palabras)

### Constructor
```python
WordBombGame(turn_time: int = 15, lives: int = 3)
```

### `@dataclass BombPlayer`
- `name`, `lives`, `avatar`, `letters_used (set)`.

### Atributos
- `turn_time, max_lives, players (dict)`.
- `started: bool, active: bool`.
- `current_player_idx: int`, `current_fragment: str`.
- `turn_start: float`.
- `_used_words: set[str]` (sin repetir).

### `add_player(name, avatar="") → bool`
- Solo si `not started`.
- Crea `BombPlayer(name, max_lives, avatar)`.

### `start() → bool`
- Min 2 jugadores.
- Setea `active = True`, `started = True`.
- `_pick_fragment()`.
- Setea `turn_start = time.time()`.

### `_pick_fragment()`
Elige sílaba random de un set de fragmentos (probablemente de `spanish_words.py`).

### `current_player_key() → str | None`
Returns key del player con turno actual (alive only).

### `submit_word(player_name, word) → dict`
1. Verifica que sea su turno.
2. Verifica `not in _used_words`.
3. Verifica que la palabra contenga `current_fragment`.
4. Verifica que sea una palabra válida (en diccionario de
   `spanish_words.py`).
5. Si OK:
   - `_used_words.add(word)`.
   - `player.letters_used |= set(word)`.
   - **Bonus life** si `letters_used` cubre todo el abecedario A-Z.
   - `_advance()` (siguiente jugador + nuevo fragmento).
   - Returns `{"ok": True, "word": word, "bonus_life": bool}`.

### `bomb_explode() → dict`
Llamado cuando se acaba el tiempo del turno:
- `current_player.lives -= 1`.
- Si lives == 0: marca como dead, anuncia.
- `_advance()`.
- Returns `{"player": name, "lives_remaining": N, "exploded": bool}`.

### `adjust_time(delta)`
Modifica `turn_time` del juego en runtime (admin).

### `_advance()`
- Avanza `current_player_idx` skip dead players.
- `_pick_fragment()`.
- `turn_start = time.time()`.

### `get_alive_count()`
Players con `lives > 0`.

## `core/minigame_stats.py` (53 líneas)

Estadísticas persistentes de minijuegos.

### Storage
`data/minigame_stats.json`:
```json
{
  "<player_norm>": {
    "name": "<original>",
    "wordsearch_wins": int,
    "wordbomb_wins": int
  }
}
```

### API
```python
record_win(player_name, game_type)  # game_type: "wordsearch" | "wordbomb"
get_player_stats(player_name) → dict
get_leaderboard(game_type, limit=10) → list[(name, wins)]
```

## `core/spanish_words.py` (1243 líneas)

> Diccionario completo de palabras españolas para WordBomb. Contiene:
> - Lista de sílabas/fragmentos para `_pick_fragment`.
> - Set de palabras válidas para validar `submit_word`.

Replicar el archivo COMPLETO en el sidecar Python — es solo data.

## Notas para el port

- **Lógica pura sin GUI** — fácil de portar 1:1. NO requiere PyQt.
- **Las 19 categorías de WordSearch** están hardcoded — replicar igual.
- **Bonus life** del wordbomb: completar abecedario A-Z con
  `letters_used` da vida extra. Replicar idéntico.
- **`_used_words` set** evita repetir palabras en wordbomb.
- **Estadísticas persistentes** en JSON simple — replicar.
- **`spanish_words.py`** es solo data (1243 líneas) — incluir tal cual.
- **8 direcciones en WordSearch** (horizontal, vertical, 4 diagonales) —
  replicar con loops simples.
- **Random fill de celdas vacías** con A-Z para que no se vean huecos.
