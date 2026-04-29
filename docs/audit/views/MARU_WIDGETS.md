# MARU Original — gui/widgets/ (14 widgets, 4083 líneas)

> Widgets reusables de la UI. Auditados en G0.5.

---

## 1. `log_widget.py` (362 líneas) · `EnhancedLogWidget`

### `LogCategory` — 19 categorías con `(emoji, color, label)`

```python
SYSTEM     = ("⚙️", "#7ed6df", "Sistema")
TIKTOK     = ("🎵", "#ff6b9d", "TikTok")
CONNECTION = ("🔌", "#00d4ff", "Conexión")
GIFT       = ("🎁", "#ffd93d", "Regalo")
RULE       = ("🎮", "#6bcb77", "Regla")
TTS        = ("🔊", "#a29bfe", "TTS")
GAME       = ("🕹️", "#74b9ff", "Juego")
ERROR      = ("❌", "#e74c3c", "Error")
SUCCESS    = ("✅", "#2ecc71", "Éxito")
WARNING    = ("⚠️", "#f39c12", "Aviso")
FOLLOW     = ("➕", "#1abc9c", "Follow")
SHARE      = ("📤", "#e056a0", "Share")
LIKE       = ("❤️", "#fd79a8", "Like")
COMMENT    = ("💬", "#3498db", "Comentario")
SIM        = ("🎭", "#fdcb6e", "Simulador")
TEST       = ("🧪", "#55efc4", "Test")
SOCIAL     = ("🎤", "#ff69b4", "Social")
SPOTIFY    = ("🎵", "#1DB954", "Spotify")
EVENT      = ("📡", "#636e72", "Evento")
```

### `EnhancedLogWidget` (extends `QTextEdit`)

#### Constantes
- `MAX_LOG_ENTRIES = 500` — para evitar lag.
- `BATCH_INTERVAL = 50` ms — entre updates batch.
- `SCROLL_THRESHOLD = 50` px — para detectar "está al final".

#### Atributos
- `_log_buffer = deque(maxlen=50)` — buffer de mensajes pendientes de pintar.
- `_all_messages = deque(maxlen=500)` — historial completo (para filtros).
- `_user_scrolled_up: bool` — si el usuario está leyendo arriba.
- `_active_filters: set` — categorías UI a mostrar.
- `_show_timestamps: bool` — toggle de timestamps.
- `stats: dict` — `{gifts, follows, shares, likes, comments, rules_triggered, errors}`.

#### Filtros UI → categorías (mapping `cat_map`)
```python
GIFT → 'gifts'
FOLLOW/SHARE/LIKE/SOCIAL → 'social'
COMMENT → 'comments'
RULE/GAME/SIM/TEST → 'rules'
ERROR/WARNING → 'errors'
SUCCESS/SYSTEM/TIKTOK/CONNECTION/EVENT → 'system'
TTS → 'tts'
SPOTIFY → 'spotify'
```

8 filtros UI: `comments, gifts, social, rules, spotify, tts, system, errors`.

#### `log(msg, category=None)`
- Timestamp `HH:MM:SS.ms` (con milisegundos).
- Si no hay category, usa `_detect_category(msg)`.
- Update stats si categoría matchea.
- Append a `_all_messages` (siempre).
- Append a `_log_buffer` solo si pasa filtro actual.

#### `_detect_category(msg) → tuple` (auto-detection)
Reglas en orden:
1. Errores/avisos: `❌, error, fallo, traceback` → ERROR.
2. Warnings: `⚠️, rate limit, timeout` → WARNING.
3. Success: `✅, exitosamente` → SUCCESS.
4. Connection: `🔌, reconexión, websocket` → CONNECTION.
5. Sim/Test: `🎭, [sim], 🧪, [test]`.
6. Spotify: `spotify, 🎵 cola, playfan, reproduciendo... pedido por`.
7. Eventos TikTok: `🎁/regalo, 🎮/regla, ➕/siguió, 📤/compartió, ❤️/like, 💬/comentó`.
8. Social: `🎤, racha, matrimonio, duelo, !register, !pelea`.
9. TTS: `🔊, tts, fortuna, narración`.
10. TikTok genérico: `tiktok, @ + live`.
11. Game: `puerto, rcon, servidor`.
12. Fallback: `None`.

#### Smart auto-scroll
- Si el usuario está cerca del fondo (`max - value < 50px`): auto-scroll.
- Si está leyendo arriba: NO scrollea + cuenta `_unread_count`.
- `scroll_to_bottom()` para volver al final manual.

#### Render optimization
- `_flush_buffer()` cada 50ms: arma TODOS los HTMLs en memoria, hace
  un `insertHtml(batch + "<br>")` solo.
- `_reapply_filters_optimized()`: para re-render con filtros — usa
  `setHtml(joined)` en lugar de `insertHtml` en loop (mucho más rápido).

#### Public API
```python
set_filters(categories: set)
set_show_timestamps(show: bool)
log(msg, category=None)
scroll_to_bottom()
get_unread_count() → int
get_stats_summary() → str
reset_stats()
export_log(filepath: str)
```

---

## 2. `splash.py` (123 líneas) · `AnimatedSplashScreen`

Ya documentado en `MARU_VISUAL_AUDIT.md` sección 1.

---

## 3. `animated.py` (103 líneas) · 3 clases

### `AnimatedButton(QPushButton)`
- `pulse()`: animación 150ms `OutCubic`, expansion ±2px y vuelta.
- Trigger en `mousePressEvent`.

### `AnimatedLabel(QLabel)`
- `flash(color, duration=500)`: setea bg, después restaura el styleSheet original.

### `NotificationWidget(QLabel)`
- 4 estilos por color: success/error/warning/info.
- `show_notification(message, duration=3000, style="success")`:
  - `setText`, `adjustSize`, posiciona top-center del parent (10px desde top).
  - `_timer.start(duration)` → `_fade_out` → `hide()`.

---

## 4. `searchable.py` (111 líneas) · 2 clases

### `SearchableComboBox(QComboBox)`
- `setEditable(True)`, `NoInsert`.
- `QCompleter` con `MatchContains`, `CaseInsensitive`.
- `addSearchItem(text, data, icon)`.

### `SearchableListWidget(QWidget)`
- QLineEdit (search) + QListWidget interna.
- `_filter_items(text)`: hide items que no matchean (case-insensitive).
- API que mimickea QListWidget: `addItem, clear, currentItem, currentRow,
  selectedItems, count, item(row), takeItem(row), setCurrentRow(row)`.
- Signals: `itemSelectionChanged, itemDoubleClicked`.

---

## 5. `backup_manager.py` (135 líneas) · `BackupManager`

> No es un widget UI — es lógica de negocio. Pero vive en widgets/.

### Constantes
- `MAX_BACKUPS = 7`.
- `BACKUP_DIR_NAME = "backups"`.
- `CRITICAL_FILES = ["config.json", "social_data.json", "fortunes.json"]`.

### Métodos públicos
```python
__init__(data_dir: Path)
create_backup(reason="auto") → (bool, msg)
restore_backup(backup_path: Path) → (bool, msg)
get_available_backups() → list[dict]
get_last_backup_info() → str
```

### Estructura de un backup
- Carpeta: `data/backups/backup_<YYYYMMDD_HHMMSS>_<reason>/`.
- Archivos copiados:
  - Los 3 críticos: `config.json, social_data.json, fortunes.json`.
  - Todos `rules_*.json` (glob).
  - Todos `data_*.json` (glob).

### Auto-cleanup
- Al crear: ordena por mtime, mantiene los `MAX_BACKUPS` más recientes,
  borra el resto con `shutil.rmtree`.

### Item de `get_available_backups()`
```python
{
  "path": Path,
  "name": "backup_20260426_143045_manual",
  "datetime": datetime,
  "display": "26/04/2026 14:30",  # %d/%m/%Y %H:%M
  "reason": "manual",
  "files": int  # count *.json
}
```

---

## 6. `health.py` (116 líneas) · `SystemHealthWidget`

### `HealthStatus` constantes
- `OK = "ok"`, `WARNING = "warning"`, `ERROR = "error"`, `UNKNOWN = "unknown"`.

### Colores por estado
```python
OK:      "#2ecc71" (verde)
WARNING: "#f39c12" (naranja)
ERROR:   "#e74c3c" (rojo)
UNKNOWN: "#7f8c8d" (gris)
```

### Iconos
```python
OK:      "🟢"
WARNING: "🟡"
ERROR:   "🔴"
UNKNOWN: "⚫"
```

### UI
- QFrame con `border-radius: 8px`, padding 4px.
- Max height 32, min height 28.
- 4 indicadores en fila + emoji `🏥` al inicio:
  - `tiktok` — `<icon> TikTok`
  - `game` — `<icon> Juego`
  - `tts` — `<icon> TTS`
  - `backup` — `<icon> Backup` (default OK "Listo").

### `update_status(component, status, message)`
- Setea `_states[component]`.
- Cambia label text + color via stylesheet.
- Setea tooltip con el message.

### `get_full_status() → dict`
Retorna copia de `_states`.

---

## 7. `rule_validator.py` (200 líneas) · `RuleValidator`

> No-UI, lógica de validación.

### `__init__(data_dir: Path)`
- `_cache = {}` para `_load_game_data()` (evita re-leer JSON cada vez).

### `_load_game_data(game_id) → dict`
Carga `data_<game>.json` y construye:
```python
{
  "raw": <data>,
  "lookup": {
    "<category>": set([...lowercase variants])
  }
}
```
Variants incluidas: `name_part.lower()`, `cmd_part.lower()`,
`clean_name.lower()` (sin emoji), y full-string si no tiene `:`.

### Métodos públicos
```python
validate_rule(rule, game_id, custom_gifts) → list[problem]
validate_rules_batch(rules, game_id, custom_gifts) → dict
clear_cache()
```

### Tipos de problemas detectados (líneas 106+)
- Trigger gift no encontrado en `custom_gifts` (warning con suggestion).
- Action value no encontrado en data del juego (error).
- Conflictos entre reglas (mismo trigger).
- Trigger value vacío.
- Cooldown inválido.
- Etc.

### Resultado de `validate_rules_batch`
```python
{
  "error_count": int,
  "warning_count": int,
  "info_count": int,
  "problems": [{
    "rule_name", "type": "error|warning|info",
    "field", "message", "suggestion"?
  }, ...],
  "conflicts": [{
    "message", "rules": [name1, name2]
  }, ...]
}
```

---

## 8. `image_cache.py` (143 líneas)

> Caché global LRU de QPixmap y QIcon.

### Constantes
- `_MAX_PIXMAP = 400` (`OrderedDict`).
- `_MAX_ICON = 400`.

### Funciones públicas
```python
get_pixmap(path, size=0) → QPixmap | None
get_icon(path, size=48) → QIcon | None
invalidate(path="")  # vacío → invalida todo
tint_icon_file(path, color) → bool  # tinting destructivo (sobrescribe el archivo)
strip_emoji(text) → str
find_entity_image(img_dir, cmd, display, default="") → str
cache_stats() → dict
```

### Tinting (`tint_icon_file`)
1. Carga el PNG fuente.
2. Crea pixmap del mismo tamaño relleno con el color target.
3. `CompositionMode_DestinationIn` con `drawPixmap` del original →
   resultado: silueta original con el color nuevo.
4. Guarda sobre el archivo.
5. Invalida la caché para ese path.

### `find_entity_image` — lookup por nombre
- Lista archivos del dir (`_list_dir` cacheado).
- Genera candidates con varios formatos (cmd, display, sin-emoji,
  underscore, lowercase).
- Prueba con extensiones `.png, .jpg, .jpeg, .webp`.
- Devuelve path completo o `default`.

---

## 9. `default_images.py` (209 líneas)

Ya documentado en `MARU_VISUAL_AUDIT.md` sección 5.

### Funciones públicas
```python
ensure_trigger_icons(icons_dir) → dict[str, str]
ensure_category_default(images_dir, category) → str
ensure_game_folders(data_dir, game_id, categories) → dict[str, str]
get_default_for_category(data_dir, game_id, category) → str
generate_custom_category_default(images_dir, category_name, emoji="") → str
```

### `_draw_letter_icon(letter, size, bg, fg, border) → QPixmap`
- 128x128, transparent.
- RoundedRect 16% radius con gradient radial.
- Border 2.5px.
- Letra centrada, 45% size, bold.

---

## 10. `game_sounds.py` (81 líneas) · `play_sound(sound_type)`

> Sonidos sintetizados para minijuegos. Sin archivos externos.

### 9 tipos de sonido
```python
"correct"      # Correcto: 880→1108→1320 Hz
"word_found"   # Palabra encontrada: arpeggio C-E-G-C2
"game_over"    # Game over: arpeggio + nota sostenida
"explosion"    # Explosión: low freqs descendentes (150→90→55→35)
"wrong"        # Error: 350→280
"join"         # Join: 659→880→1047
"tick"         # Tick: 1200 Hz cortito
"ws_found"     # WordSearch found: arpeggio brillante
"ws_wrong"     # WordSearch wrong: 440→370→311
"ws_join"      # WordSearch join
"ws_victory"   # Victoria: secuencia melódica completa
```

### Síntesis
- 44100 Hz, int16.
- ADSR envelope: attack 4ms, sustain con decay 30%, release 18ms.
- Armónicos por frecuencia:
  - >200 Hz: fundamental + 2nd (30%) + 3rd (10%) + 4th (4%).
  - 80-200 Hz: fundamental + sub-octave (40%) + 2nd (15%) + noise.
  - <80 Hz: bass con sub-octaves.
- Volume: 0.28.
- Caché por sound_type — re-genera solo la primera vez.

---

## 11. `overlay_card.py` (429 líneas) · `OverlayCard` + `OverlaySettingsDialog`

### `OverlayCard(QFrame)`
- Fixed 420x420.
- Border-radius 16px.
- Header: emoji `spec.icon` (28px) + título (16 bold) + descripción (11) + status badge.
- Preview con `QWebEngineView` que carga el HTML local del overlay con
  query params (`?preview=1&goal=...&color=...`).
- Action row: `📋 Copiar URL` (gradient verde 38px), `🧪 test`, `🔄 reload`, `⚙️ settings`.

### Status display
- `🟢 ACTIVO` (verde) si `client.is_overlay_enabled(id)`.
- `⚫ INACTIVO` si no.

### `_send_test_event` — payloads por overlay
- `taps`: `{"count": 50}` (manda 50 likes).
- `streak`: `{"user": "TEST", "days": <random 7|47|234|9999>}`.
- otros: `{"test": True}`.

### `_send_reload`: manda `type=reload` para forzar `location.reload()`
en el browser source de TikTok Studio (purga cache).

### `OverlaySettingsDialog`

Mini-modal con campos por overlay:

#### Para `taps`
- `goal_input` (QSpinBox 1–1.000.000, suffix `" likes"`).
- Color picker (QColorDialog) con swatch 36x28.
- `message_input` (QLineEdit).
- `reset_chk` (`Resetear al alcanzar la meta`).

#### Para `streak`
- `duration_input` (QSpinBox 2000–30000 ms, step 500).
- `label_input` (QLineEdit, default `"DÍAS DE RACHA"`).

### `_save()` — al guardar
1. `client.update_overlay(overlay_id, **updates)` (persiste config local).
2. **Live update al overlay**: envía `<overlay_id>_config` con
   `{goal, color, message, label}` para que el browser source actualice
   sin recargar.

---

## 12-14. `wordbomb_widget.py` / `wordsearch_widget.py` / `wordsearch_lite_widget.py` (≈2000 líneas)

> 3 ventanas de juego. Layouts verticales para usar como overlay de stream.

### `WordBombWindow` (871 líneas)
- Lobby + jugadores + sílaba + timer + lives.
- `_PLAYER_COLORS` 15 colores rotando para cada jugador.
- Avatar pool: PNGs de `data/game_images/<game>/entities/*.png`.
- `pick_avatar()`: random del pool.
- `_LetterBox`: caja de letra con color (48x58, font Segoe UI 24 bold).
- `_BombPlayerCard`: card 90x120 con avatar 44x44 redondo, nombre,
  vidas (`❤` / `🖤`).
- Constantes:
  - `_BG = "#0d0d14"`.
  - `_FRAG_COLOR = "#f39c12"`.
  - `_CORRECT_COLOR = "#2ecc71"`.
  - `_EXPLODE_COLOR = "#e74c3c"`.

### `WordSearchWindow` (592 líneas)
- Grilla NxN con letras coloreadas según jugador.
- Lista de palabras a encontrar (visible).
- Cada jugador escribe `A1 B2` (start-end coords).
- Highlight de palabras encontradas.

### `WordSearchLiteWindow` (575 líneas)
- Modo "rápido": solo grilla, sin lista de pistas.
- Rondas automáticas.

### Comunes a los 3
- Signal `closed` que el MainWindow conecta a `_on_minigame_closed`.
- Reciben `game` (instancia de `WordSearchGame` o `WordBombGame` de
  `core/minigames.py`) en el constructor.
- Se cierran al terminar la ronda (después de mostrar ranking).

---

## Resumen — Patrones reutilizables

### Caching/perf
- `OrderedDict` LRU para pixmaps/icons (max 400).
- Buffer + flush con timer 50ms para logs.
- Pre-index al boot (`_image_index, _list_dir`).
- Cache de fortunes a nivel clase (no instancia).

### Workers/async
- Sound worker daemon con cola.
- `ConnectionWorker(QThread)` con signal `finished(ok, msg)`.
- `core.games.EX` (ThreadPoolExecutor 50 workers) compartido.

### Auto-fallbacks
- PNG → URL primaria → URL fallback → letter PNG generado.
- Theme inválido → DEFAULT_THEME ("midnight").
- Imagen no encontrada → default por categoría.

### Smart UI
- Auto-scroll log SOLO si usuario está al final.
- `block-signals` antes de cambios programáticos.
- Debounce de filtros (100ms) y connection tests (800ms).
- `_unsaved_changes` flag + auto-save 5min.

### Estilos uniformes via helpers (`gui/constants.py`)
- `card_style`, `card_hover_style`, `input_style`, `btn_*_style`,
  `header_gradient`, `footer_style`, `scroll_style`.
