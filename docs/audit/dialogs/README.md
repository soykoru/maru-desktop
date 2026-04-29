# MARU Original — Audit de los 16 diálogos

> Producido en G0.4 · 2026-04-27.
> Cada archivo documenta layout, métodos públicos, schemas, y notas
> para el port a React.

## Índice

| #  | Diálogo                | Líneas | Doc                                                  |
|----|------------------------|-------:|------------------------------------------------------|
| 01 | backup_dialog          |    342 | [`MARU_DIALOG_01_backup.md`](MARU_DIALOG_01_backup.md) |
| 02 | custom_game_dialog     |    837 | [`MARU_DIALOG_02_custom_game.md`](MARU_DIALOG_02_custom_game.md) |
| 03 | data_dialog            |    625 | [`MARU_DIALOG_03_data.md`](MARU_DIALOG_03_data.md) |
| 04 | entity_selector        |    614 | [`MARU_DIALOG_04_entity_selector.md`](MARU_DIALOG_04_entity_selector.md) |
| 05 | gift_selector          |    275 | [`MARU_DIALOG_05_gift_selector.md`](MARU_DIALOG_05_gift_selector.md) |
| 06 | gifts_dialog           |    652 | [`MARU_DIALOG_06_gifts.md`](MARU_DIALOG_06_gifts.md) |
| 07 | manage_games_dialog    |    427 | [`MARU_DIALOG_07_manage_games.md`](MARU_DIALOG_07_manage_games.md) |
| 08 | minigames_dialog       |    254 | [`MARU_DIALOG_08_minigames.md`](MARU_DIALOG_08_minigames.md) |
| 09 | overlays_manager       |    197 | [`MARU_DIALOG_09_overlays_manager.md`](MARU_DIALOG_09_overlays_manager.md) |
| 10 | profile_dialog         |    114 | [`MARU_DIALOG_10_profile.md`](MARU_DIALOG_10_profile.md) |
| 11 | profiles_dialog        |    762 | [`MARU_DIALOG_11_profiles.md`](MARU_DIALOG_11_profiles.md) |
| 12 | rule_dialog            |   1259 | [`MARU_DIALOG_12_rule.md`](MARU_DIALOG_12_rule.md) ⭐ |
| 13 | simulator_dialog       |    688 | [`MARU_DIALOG_13_simulator.md`](MARU_DIALOG_13_simulator.md) |
| 14 | social_config          |   2464 | [`MARU_DIALOG_14_social_config.md`](MARU_DIALOG_14_social_config.md) ⭐ |
| 15 | sounds_dialog          |    650 | [`MARU_DIALOG_15_sounds.md`](MARU_DIALOG_15_sounds.md) |
| 16 | voices_dialog          |    146 | [`MARU_DIALOG_16_voices.md`](MARU_DIALOG_16_voices.md) |

⭐ = los dos diálogos críticos (rule y social_config son ~3.700 líneas
de UI compleja entre los dos).

## Hallazgos importantes

### Rule dialog (`rule_dialog.py`)
- **7 trigger types**: gift, command, follow, share, subscribe, like,
  like_milestone.
- **4 secciones que se ocultan/muestran** según el trigger.
- **Acciones múltiples** con `random_action` para "una al azar".
- **Action types con compatibilidad legacy**:
  - moderno: `entity / item / event / valuable` (usado en `actions[]`).
  - legacy: `spawn / give_item / trigger_event / spawn_valuable`
    (campos top-level).
- **Galería unificada** de acciones (`EntitySelectorDialog` con tabs
  por categoría) reusada en 3 lugares.
- **Per-rule TTS voice** (override sobre la voz por defecto).
- **Filtro de usuarios permitidos** (allowed_users).

### Social config (`social_config.py`)
- **6 tabs** (7 con IA): General, Comandos, Usuarios, Taps Globales,
  Estadísticas, Spotify, IA.
- **Tabla de usuarios con celdas editables** (racha + relaciones).
- **Racha automática** con duración configurable (1–365 días).
- **Spotify**:
  - Multi-cuenta (cuentas guardadas).
  - Anti-rate-limit conservador (refresh cada 45s).
  - 5 comandos enableable individualmente.
  - Usuarios prioritarios con cuota `!playfan / día`.
  - Voz del bot independiente del chat (`tts.speak_social`).
- **IA**: 4 proveedores (Claude / Groq / Gemini / OpenAI), keys
  preservadas por proveedor, system prompt custom, max 800 chars.

### Custom game dialog
- **3 juegos predefinidos** son inmutables en estructura. Solo se puede
  editar host/port/password/tab_names.
- **Categorías custom** con 4 propiedades editables en vivo:
  endpoint / payload / rcon_cmd / tutorial.
- **4 presets** (Valheim, Terraria, 7 Days, Rust RCON).

### Profiles dialog
- **Snapshots completos** del estado: juego + reglas + gifts + sonidos +
  voces + TTS.
- **Backup automático** antes de cargar perfil distinto.
- **Export** con `export_version: "1.0"` + `exported_at` ISO.
- **Import** detecta formato (`export_version + profile`) o legacy.

### Simulator dialog
- **6 trigger types simulables** (no hay `like_milestone` directo, ni
  `command` separado de `comment`).
- **10 presets rápidos** con casos comunes.
- **Burst mode** con repeat 1–100 para test de carga del rule_engine.

### Gifts dialog
- **415 PNG** se mapean 1:1 desde `data/donaciones/`.
- **Metadata embebida** en chunks `tEXt` del PNG (Gift-Name, Gift-Coins).
- **Importar desde carpeta** reconstruye `gifts.json` desde los archivos.
- **ID locked en edición** para no romper referencias en reglas.

### Sounds dialog
- **3 tabs**: Biblioteca, Regalos, Eventos.
- **Solo 3 eventos globales** con sonido: `follow / share / superfan`.
- **Por gift**: combo configurable.
- **Playback** en thread daemon con `pygame.mixer.Sound`.

### Voices dialog
- **3 niveles de voces**:
  1. Voz default (global del TTS engine).
  2. Voces de perfil o globales (`use_global_voices`).
  3. **Per-user voice** (este diálogo) — override máximo.
- **Username normalization**: `lower().replace("@", "").replace(" ", "")`.

### Entity selector
- **Multi-select con tabs por categoría** es CRÍTICO — se usa en 3 lugares:
  1. `RuleDialog._open_unified_gallery`.
  2. `RuleDialog._edit_action.open_edit_gallery` (single-select).
  3. `MainWindow._quick_change_entity` (atajo desde la lista de reglas).
- **Lazy image loading** con `defer_image=True`.

### Backup dialog
- **MAX_BACKUPS = 7** con rotación FIFO.
- **4 reasons tipadas**: manual / pre_load / prerestore / pre_import.
- **Pre-restore backup automático** (defensa en profundidad).

### Overlays manager
- **OVERLAY_REGISTRY** vive en `core/overlays.py` — auditar G0.6.
- **No hay configuración global** — cada overlay tiene su propia card
  con sus ajustes.
- **Alias custom** afecta la URL del overlay (estable entre sesiones).

### Manage games dialog
- **Auto-test debounce 800ms** para HTTP. Minecraft NO auto-testea
  (consume RAM al abrir RCON).
- **Crear perfil basado en otro** copia `data_<base>.json` y crea
  `rules_<new>.json` vacío.

### Minigames dialog
- **3 minijuegos**: WordSearch, WordSearchLite, WordBomb.
- **19 categorías** de palabras.
- **Settings**: rows/cols/words (ws), turn_time/lives (wb).

### Profile dialog (NewProfileDialog)
- Modal mínimo para crear perfil.
- Permite copiar de otro o empezar vacío.
- 2 checkboxes: `share_sounds` y `share_voices` (default checked).

## Patrones reutilizables identificados (clave para G1+)

1. **Card grid con click-select + preview lateral**: gifts, entities, profiles, backups, sounds.
2. **Card grid con multi-select**: entity_selector, simulator (gift gallery).
3. **Header gradient + footer fixed action bar**: profiles, backups,
   simulator, overlays_manager.
4. **Toolbar con search + sort toggle**: gifts, gift_selector,
   rule_dialog (trigger combo), simulator.
5. **Tabs frosted glass** (estilo del social_config) con `setExpanding(True)`.
6. **Test inline** sin guardar: data, rule, voices.
7. **Auto-debounce timers** (100–800ms) en filtros y connection tests.
8. **QDialogButtonBox Ok/Cancel** consistente.
9. **`_wm_exec(dlg)`** como wrapper para `setWindowModality(WindowModal)`.
10. **PNG icons + emoji fallback** para casi todos los items visuales.
