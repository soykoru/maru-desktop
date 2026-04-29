# MARU Original — Matriz Feature × Archivo × Diálogo × JSON × Fase G

> Producido en G0.9 · 2026-04-27.
> El **CONTRATO** del port: cada feature mapeada a su origen, dónde se
> expone, qué dato persiste, y a qué fase G se porta.
>
> **Cero features huérfanas.**

---

## Convenciones de la tabla

- **Feature**: nombre corto y único.
- **Origen Python**: archivo donde vive la lógica.
- **UI**: dónde se expone (sidebar / diálogo / tab / window).
- **Persistencia**: archivo JSON que la guarda.
- **Fase G**: G1–G15 según el plan G final.

---

## SECCIÓN A — Identidad visual (Fase G1)

| ID | Feature | Origen Python | UI | Persistencia | Fase G |
|----|---------|---------------|----|----|--------|
| A1 | Logo MaruLive (root logo.png) | `gui/main_window._build_left_panel` | sidebar (top) + splash | — | G1 |
| A2 | Splash screen animado 380x280 | `gui/widgets/splash.py:AnimatedSplashScreen` | boot | — | G1 |
| A3 | Tema único oscuro "midnight" | `gui/themes.py:THEMES["midnight"]` | global stylesheet | `config.json:theme` | G1 |
| A4 | 34 design tokens (paleta hex) | `gui/constants.py` | todos | — | G1 |
| A5 | 9 helpers de estilo (`card_style`, `btn_*_style`, `header_gradient`, etc.) | `gui/constants.py` | todos | — | G1 |
| A6 | Iconos del sidebar (emojis Unicode) | `_build_left_panel` | sidebar | — | G1 |
| A7 | Background gradient `#1a1a2e → #16213e` | `themes.py:midnight` | QMainWindow/QDialog | — | G1 |
| A8 | Window icon (icon.ico) | `gui/main_window.__init__` | window titlebar | — | G1 |
| A9 | NotificationWidget toasts (4 tipos) | `gui/widgets/animated.py:NotificationWidget` | top-center floating | — | G1 |
| A10 | AnimatedButton pulse 150ms | `gui/widgets/animated.py:AnimatedButton` | botones | — | G1 |
| A11 | AnimatedLabel flash | `gui/widgets/animated.py:AnimatedLabel` | labels | — | G1 |

---

## SECCIÓN B — Sistema de imágenes (Fase G2)

| ID | Feature | Origen Python | UI | Persistencia | Fase G |
|----|---------|---------------|----|----|--------|
| B1 | Custom protocol para servir PNGs | (nuevo) | renderer | bundle | G2 |
| B2 | Image cache LRU (max 400) | `gui/widgets/image_cache.py:get_pixmap/get_icon` | todos | en memoria | G2 |
| B3 | Pre-build `_image_index` al boot | `gui/views/images.py:_build_image_index` | — | en memoria | G2 |
| B4 | Lookup con normalización de nombres | `gui/views/images.py:_get_entity_icon` | — | — | G2 |
| B5 | `_resolve_gift_images()` al boot | `gui/views/images.py` | — | — | G2 |
| B6 | Auto-descarga PNG de gifts en vivo (TikTok) | `gui/views/images.py:_on_gift_image_detected` | — | `gifts.json` | G2 |
| B7 | Inyección metadata `tEXt` (Gift-Name, Gift-Coins) | `gui/views/images.py:_inject_png_metadata` | — | PNG file | G2 |
| B8 | `ensure_trigger_icons()` (7 PNGs) al boot | `gui/widgets/default_images.py` | — | `data/icons_triggers/` | G2 |
| B9 | `ensure_category_default()` por juego/categoria | `gui/widgets/default_images.py` | — | `_default_<cat>.png` | G2 |
| B10 | Letter PNG fallback generado a 128x128 | `gui/widgets/default_images.py:_draw_letter_icon` | — | — | G2 |
| B11 | Tinting destructivo de PNG | `gui/widgets/image_cache.py:tint_icon_file` | — | sobreescribe PNG | G2 |
| B12 | `find_entity_image()` con variantes (cmd, display, lower) | `gui/widgets/image_cache.py` | — | — | G2 |
| B13 | Migración de paths absolutos → relativos | (nuevo) | — | `gifts.json` | G2 |

---

## SECCIÓN C — Galería de Donaciones (Fase G3)

| ID | Feature | Origen Python | UI | Persistencia | Fase G |
|----|---------|---------------|----|----|--------|
| C1 | Galería de gifts con grid de cards | `gui/dialogs/gifts_dialog.py:GiftsDialog` | dialog 950x750 | `gifts.json:custom_gifts` | G3 |
| C2 | Card 110x135 con imagen 80x80 | `gifts_dialog.py:GiftCardWidget` | grid 5 cols | — | G3 |
| C3 | Search con debounce 150ms | `gifts_dialog.py:_on_search_changed` | toolbar | — | G3 |
| C4 | Sort asc/desc por coins | `gifts_dialog.py:toggle_sort` | toolbar | — | G3 |
| C5 | Toggle "Mostrar desactivadas" | `gifts_dialog.py:_on_show_disabled` | toolbar | — | G3 |
| C6 | "Importar desde carpeta" → `scan_donaciones_folder` | `gifts_dialog.py:scan_donaciones_folder` | botón toolbar | `gifts.json` | G3 |
| C7 | Preview lateral (180x180 + nombre + coins + ID) | `gifts_dialog.py:_load_preview` | right panel | — | G3 |
| C8 | Form de edición: nombre, ID (locked), coins, icon, enabled | `gifts_dialog.py` | right panel | — | G3 |
| C9 | Browse imagen con QFileDialog | `gifts_dialog.py:browse_icon` | botón | — | G3 |
| C10 | CRUD: save, delete, new gift | `gifts_dialog.py` | botones | `gifts.json` | G3 |
| C11 | `GiftSelectorDialog` reusable (selector visual) | `gui/dialogs/gift_selector.py` | modal 750x550 | — | G3 |
| C12 | Gift card 100x130 en selector | `gift_selector.py:_SelectorCard` | grid 6 cols | — | G3 |
| C13 | Doble-click acepta directo | `gift_selector.py` | — | — | G3 |
| C14 | Read PNG `tEXt` metadata para auto-import | `gifts_dialog.py:_read_png_metadata` | — | — | G3 |
| C15 | `Rose_black_white.png` placeholder universal | `gifts_dialog.py:DEFAULT_IMAGE` | — | bundle | G3 |
| C16 | Filtrar por search en gallery | `gifts_dialog.py:_apply_filter` | — | — | G3 |
| C17 | Disabled gifts con bg gris | `gifts_dialog.py:set_disabled_look` | — | — | G3 |

---

## SECCIÓN D — Conexión con juegos (Fase G4)

| ID | Feature | Origen Python | UI | Persistencia | Fase G |
|----|---------|---------------|----|----|--------|
| D1 | ValheimGame (HTTP /spawn + /event) | `core/games.py:ValheimGame` | — | — | G4 |
| D2 | TerrariaGame (HTTP /spawn/ + /command/) | `core/games.py:TerrariaGame` | — | — | G4 |
| D3 | MinecraftGame (RCON puerto 25575) | `core/games.py:MinecraftGame` | — | — | G4 |
| D4 | MinecraftRCON cliente puro | `core/games.py:MinecraftRCON` | — | — | G4 |
| D5 | CustomGame configurable HTTP/RCON | `core/games.py:CustomGame` | — | `games.json:custom_games` | G4 |
| D6 | Templating de payload con 6 variables | `core/games.py:CustomGame._build_payload` | — | — | G4 |
| D7 | Pool global `EX = ThreadPoolExecutor(50)` | `core/games.py:EX` | — | — | G4 |
| D8 | Fire-and-forget HTTP/RCON | `core/games.py` | — | — | G4 |
| D9 | `test_connection()` con cascading (status → spawn → socket) | `core/games.py` | — | — | G4 |
| D10 | `ConnectionWorker(QThread)` async | `gui/controllers/connection.py` | — | — | G4 |
| D11 | Sidebar: selector de juego con 8 opciones | `gui/main_window._build_left_panel` | sidebar QComboBox | `config.json:current_game` | G4 |
| D12 | "Probar" connection con feedback color | `gui/main_window.test_connection` | sidebar | — | G4 |
| D13 | "Config" → `config_game()` | `gui/main_window.config_game` | sidebar → CustomGameDialog | — | G4 |
| D14 | "Añadir Juego" → ManageGamesDialog | `gui/main_window.manage_custom_games` | sidebar | — | G4 |
| D15 | CustomGameDialog completo (837 líneas) | `gui/dialogs/custom_game_dialog.py` | dialog | `games.json` | G4 |
| D16 | 4 presets (Valheim, Terraria, 7 Days, Rust RCON) | `custom_game_dialog.py:preset_*` | botones | — | G4 |
| D17 | Categorías declarables (id, name, type, endpoint, payload, rcon_cmd, tutorial) | `custom_game_dialog.py` | grupo | `games.json` | G4 |
| D18 | Tutorial inline por categoría | `custom_game_dialog.py:cat_tutorial_edit` | textarea | — | G4 |
| D19 | ManageGamesDialog (3 predefinidos editables + custom CRUD) | `gui/dialogs/manage_games_dialog.py` | dialog 650x600 | — | G4 |
| D20 | EditPredefinedDialog (host/port/password) | `manage_games_dialog.py:EditPredefinedDialog` | sub-modal | `config.json:games` | G4 |
| D21 | Auto-test debounce 800ms (HTTP) | `EditPredefinedDialog._auto_test_timer` | — | — | G4 |
| D22 | NewProfileDialog (crear perfil basado en otro) | `gui/dialogs/profile_dialog.py` | sub-modal 500x400 | crea `data_<id>.json` + `rules_<id>.json` | G4 |
| D23 | Async via `core.games.EX` desde category_tabs | `gui/views/category_tabs.py:send_to_game_with_category` | — | — | G4 |
| D24 | `_execute_custom_game_action` callback (RuleEngine → GUI) | `gui/views/category_tabs.py` | — | — | G4 |

---

## SECCIÓN E — Catálogo de entidades por juego (Fase G5)

| ID | Feature | Origen Python | UI | Persistencia | Fase G |
|----|---------|---------------|----|----|--------|
| E1 | DataDialog con grid + preview lateral | `gui/dialogs/data_dialog.py` | dialog 950x700 | `data_<game>.json[<cat>]` | G5 |
| E2 | EntryCard 120x120 con imagen 64x64 | `data_dialog.py:_EntryCard` | grid | — | G5 |
| E3 | Form CRUD: name, command, icon, "Probar" | `data_dialog.py` | right panel | — | G5 |
| E4 | Browse PNG → save en `game_images/<game>/<cat>/<cmd>.png` | `data_dialog.py:_save_image_for_entry` | — | bundle/runtime | G5 |
| E5 | Tutorial inline (de games.json o defaults) | `data_dialog.py:_show_help` | botón | — | G5 |
| E6 | Search con debounce | `data_dialog.py:_on_search_changed` | toolbar | — | G5 |
| E7 | EntitySelectorDialog reusable (multi-tab + multi-select) | `gui/dialogs/entity_selector.py` | modal 900x700 | — | G5 |
| E8 | EntityCard 110x130 lazy-loaded | `entity_selector.py:_EntityCard` | grid | — | G5 |
| E9 | Tabs por categoría con `setExpanding(True)` | `entity_selector.py:tab_bar` | top tabs | — | G5 |
| E10 | Multi-select con `_SelectionRow` (qty per item) | `entity_selector.py` | right panel | — | G5 |
| E11 | Lazy image loading (`defer_image=True`) | `entity_selector.py:_EntityCard._load_image` | — | — | G5 |
| E12 | Tabs dinámicas por juego (CategoryTabsMixin) | `gui/views/category_tabs.py:_update_category_tabs` | center QTabWidget | — | G5 |
| E13 | parse_entry "NombreVisible:Comando" | `core/rule_engine.py:parse_entry` | — | — | G5 |
| E14 | `find_command()` fuzzy con 4 estrategias | `core/rule_engine.py:GameProfile._search_in_source` | — | — | G5 |
| E15 | Manejo de categorías extra (`_extra_data`) | `core/rule_engine.py:GameProfile` | — | `data_*.json` keys custom | G5 |
| E16 | Quick-change entity desde la lista de reglas | `gui/main_window._quick_change_entity` | botón en card de regla | — | G5 |
| E17 | Resolver 18 mismatches de entries sin PNG | (nuevo) | — | `data_*.json` | G5 |
| E18 | Dedup `7_days_to_die` vs `7daystodie` | (nuevo) | — | runtime | G5 |
| E19 | Categoría `valuables` (158 PNGs en R.E.P.O.) | `data_repo.json` | — | — | G5 |
| E20 | Categoría `equipment` (30 PNGs en RoR2) | `data_ror2.json` | — | — | G5 |

---

## SECCIÓN F — Editor de reglas (Fase G6)

| ID | Feature | Origen Python | UI | Persistencia | Fase G |
|----|---------|---------------|----|----|--------|
| F1 | RuleDialog con scroll + 9 secciones | `gui/dialogs/rule_dialog.py` | dialog 680x880 | `rules_<game>.json` | G6 |
| F2 | 7 trigger types (gift/command/follow/share/subscribe/like/like_milestone) | `rule_dialog.py:event` combo | — | `rules:trigger_type` | G6 |
| F3 | 4 secciones que se ocultan/muestran según trigger | `rule_dialog.py:on_event_change` | — | — | G6 |
| F4 | Selector visual de gift (combo + galería) | `rule_dialog.py` | — | — | G6 |
| F5 | Sort asc/desc del combo de gift | `rule_dialog.py:_set_sort_order` | — | — | G6 |
| F6 | Search en combo de gift | `rule_dialog.py:_filter_trigger_combo` | — | — | G6 |
| F7 | "Galería visual" → GiftSelectorDialog | `rule_dialog.py:_open_gift_gallery` | botón | — | G6 |
| F8 | Like cada N (QSpinBox 1-10000) | `rule_dialog.py:like_every` | — | `rules:trigger_value` | G6 |
| F9 | Like milestone (QSpinBox 100-1M, step 100) | `rule_dialog.py:like_milestone_value` | — | — | G6 |
| F10 | Command input (`!cmd`) | `rule_dialog.py:command_input` | — | — | G6 |
| F11 | Allowed_users con checkbox + lista CSV | `rule_dialog.py:users_enabled/users_input` | — | `rules:allowed_users` | G6 |
| F12 | Lista de acciones múltiples (QListWidget) | `rule_dialog.py:actions_list_widget` | — | `rules:actions[]` | G6 |
| F13 | Add/edit/delete acción | `rule_dialog.py:_add_action/_remove_action/_edit_action` | botones | — | G6 |
| F14 | Sub-modal de edit acción (480x320) | `rule_dialog.py:_edit_action` | — | — | G6 |
| F15 | Random action checkbox | `rule_dialog.py:random_action_check` | — | `rules:random_action` | G6 |
| F16 | Combo de action_type cargado de games.json | `rule_dialog.py:action_type` | — | — | G6 |
| F17 | "Galería unificada" multi-select | `rule_dialog.py:_open_unified_gallery` | botón | — | G6 |
| F18 | Test inline de acción | `rule_dialog.py:test_action` | botón 🧪 | — | G6 |
| F19 | QPlainTextEdit para Minecraft (multi-line cmds) | `rule_dialog.py:cmds` | — | `rules:actions:commands` | G6 |
| F20 | Cooldown (QSpinBox 0-3600 seg) | `rule_dialog.py:cooldown` | — | `rules:cooldown` | G6 |
| F21 | TTS por regla (toggle + msg + voice) | `rule_dialog.py:tts_on/tts_msg/tts_voice` | — | `rules:tts_*` | G6 |
| F22 | Backward-compat con campos legacy (action_type, action_value, amount) | `rule_dialog.py:get_rule()` | — | `rules:action_*` | G6 |
| F23 | Lista de reglas del MainWindow (drag&drop reorder) | `gui/main_window:rules_list` | center tab "📋 Reglas" | — | G6 |
| F24 | `_build_rule_widget` con 2 imágenes (trigger + action) + flecha | `gui/main_window:_build_rule_widget` | — | — | G6 |
| F25 | Click en imagen → `_quick_change_gift/_quick_change_entity` | `gui/main_window:_quick_change_*` | — | — | G6 |
| F26 | 6 botones CRUD (Nueva, Duplicar, Editar, Eliminar, On/Off, Probar) | `gui/main_window._build_center_panel` | toolbar | — | G6 |
| F27 | Import/Export reglas a JSON con `version` y `exported_at` | `gui/main_window:import_rules/export_rules` | botones | — | G6 |
| F28 | Validate all rules con resumen | `gui/main_window:validate_all_rules` | botón | — | G6 |
| F29 | RuleValidator con cache + lookup O(1) | `gui/widgets/rule_validator.py` | — | `data_*.json` | G6 |
| F30 | Backup automático antes de import (`pre_import`) | `gui/main_window:import_rules` | — | `backups/` | G6 |
| F31 | Test selected rule ejecutando todas las acciones | `gui/main_window:test_selected_rule` | botón | — | G6 |
| F32 | Search + filter de reglas | `gui/main_window:_filter_rules` | toolbar | — | G6 |
| F33 | RuleEngine: process_event con 8 trigger types | `core/rule_engine.py:process_event` | — | — | G6 |
| F34 | Like counter por (rule_id, user) + milestone reached set | `core/rule_engine.py:_matches` | — | — | G6 |
| F35 | Multi-action atómica (no aborta si falla una) | `core/rule_engine.py:_execute` | — | — | G6 |
| F36 | TTS automático en rule trigger (con `{user}/{username}` replace) | `core/rule_engine.py:process_event` | — | — | G6 |

---

## SECCIÓN G — Sistema social (Fase G7)

| ID | Feature | Origen Python | UI | Persistencia | Fase G |
|----|---------|---------------|----|----|--------|
| G1 | SocialSystem con 6 mixins + 35 comandos | `core/social_system.py` + `core/social/*` | — | `social_data.json` | G7 |
| G2 | 8 categorías de comandos | `social_system.py:CATEGORIES` | — | — | G7 |
| G3 | DUEL_COMMANDS (6) → CombatMixin | `core/social/combat.py` | — | — | G7 |
| G4 | ACCEPT_COMMANDS (15) → InteractionsMixin | `core/social/interactions.py` | — | — | G7 |
| G5 | RESPONSE_COMMANDS (3: dado, aceptar, rechazar) | `core/social/combat.py + interactions.py` | — | — | G7 |
| G6 | UTILITY_COMMANDS (12: tarot, decision, mesa, etc) | `core/social/utilities.py + streaks_rankings.py` | — | — | G7 |
| G7 | MUSIC_COMMANDS (5: play, skip, cola, pause, playfan) | `core/social/music_ia.py` | — | — | G7 |
| G8 | IA_COMMANDS (1: ia) | `core/social/music_ia.py` | — | — | G7 |
| G9 | SYSTEM_COMMANDS (1: register) | `core/social_system.py:_cmd_register` | — | — | G7 |
| G10 | Auto-add new commands con `known_commands` tracking | `social_system.py.__init__` | — | `social_data.json:config` | G7 |
| G11 | Rachas diarias (`!racha`) + record | `core/social/streaks_rankings.py:_cmd_racha` | — | `social_data.json:users:racha` | G7 |
| G12 | Auto-rachas (admin activar N días) + timer 1h | `streaks_rankings.py:process_auto_rachas` + `MainWindow._auto_racha_timer` | — | `users:racha_automatica` | G7 |
| G13 | Sistema de duelos con `!dado` (tira aleatoria) | `core/social/combat.py:_resolve_duel` | — | — | G7 |
| G14 | Timeout de respuesta (90s default) | `social_system.py:_start_timeout/_on_timeout` | — | — | G7 |
| G15 | Cooldown por user (10s default) | `social_system.py:_check_cooldown` | — | — | G7 |
| G16 | Relaciones single-per-type (casado, novios, mejor_amigo, rival) | `core/social/interactions.py` | — | `social_data.json:users` | G7 |
| G17 | Stats per-user (>14 keys) | `social_data.json:users[user]:stats` | — | — | G7 |
| G18 | Stats globales (total_duelos, matrimonios, etc) | `social_data.json:stats` | — | — | G7 |
| G19 | Tarot con 78+ cartas + interpretación | `core/social/_tarot_data.py` | — | — | G7 |
| G20 | `!ranking, !top, !likes` | `streaks_rankings.py` | — | — | G7 |
| G21 | Taps system con historial diario | `streaks_rankings.py:record_tap` | — | `taps_data.json` | G7 |
| G22 | Taps cleanup (>7 días, excepto top 3) timer 6h | `streaks_rankings.py:cleanup_inactive_taps` + `MainWindow._taps_cleanup_timer` | — | — | G7 |
| G23 | Streak overlay callback | `MainWindow._on_racha_marked` | — | overlay event | G7 |
| G24 | 111 narraciones (238 variantes) JSON-driven | `social_system.py:_narrate` | — | `social_narrations.json` | G7 |
| G25 | Username normalization (`_normalize`) | `social_system.py:_normalize` | — | — | G7 |
| G26 | Silencio sin TTS si user no registrado (anti-saturación) | `social_system.py:_process_async` | — | — | G7 |
| G27 | SocialConfigDialog (2464 líneas, 7 tabs) | `gui/dialogs/social_config.py` | dialog 1100x800 | varios | G7 |
| G28 | Tab General: enabled, require_register, cooldown, timeout, volume, voice | `social_config.py` | — | `social_data:config` | G7 |
| G29 | Tab Comandos: 35 checkboxes en grid | `social_config.py` | — | `social_data:config:enabled_commands` | G7 |
| G30 | Tab Usuarios: tabla 9 cols con celdas editables | `social_config.py` | — | `social_data.json:users` | G7 |
| G31 | Tab Taps Globales: ranking total/semanal/mensual + medallas | `social_config.py:_refresh_taps_ranking` | — | `taps_data.json` | G7 |
| G32 | Tab Estadísticas globales + Zona de Peligro (reset all) | `social_config.py:_refresh_stats/_reset_all_data` | — | — | G7 |
| G33 | Sub-modal Auto-Racha (1-365 días) | `social_config.py:_show_auto_racha_dialog` | — | — | G7 |
| G34 | AdminMixin con 30+ admin methods | `core/social/admin.py` | — | — | G7 |
| G35 | "Sistema Social" GroupBox en sidebar (toggle + Configurar + Minijuegos) | `MainWindow._build_left_panel` | sidebar | `config.json:social_*` | G7 |

---

## SECCIÓN H — IA real (Fase G8)

| ID | Feature | Origen Python | UI | Persistencia | Fase G |
|----|---------|---------------|----|----|--------|
| H1 | IAEngine con 4 proveedores | `core/ia_engine.py` | — | `config.json:ia` | G8 |
| H2 | Provider Claude (Sonnet 4.6, Opus 4.6) | `core/ia_engine.py:_ask_claude` | — | — | G8 |
| H3 | Provider Groq (4 modelos Llama/Qwen) | `core/ia_engine.py:_ask_groq` | — | — | G8 |
| H4 | Provider Gemini (3 modelos) | `core/ia_engine.py:_ask_gemini` | — | — | G8 |
| H5 | Provider OpenAI (4 modelos) | `core/ia_engine.py:_ask_openai` | — | — | G8 |
| H6 | `_FREE_FALLBACK_ORDER = [groq, gemini]` auto-fallback en cuota | `core/ia_engine.py:ask` | — | — | G8 |
| H7 | API keys por proveedor (`ia_api_keys` dict) | `core/ia_engine.py:configure` | — | `config.json:ia.ia_api_keys` | G8 |
| H8 | `MODELS` por proveedor con descripciones | `core/ia_engine.py:MODELS` | — | — | G8 |
| H9 | `_COST_RATES` USD por 1M tokens (modelos de pago) | `core/ia_engine.py:_COST_RATES` | — | — | G8 |
| H10 | Cooldown por user (3-120s) | `core/ia_engine.py:_check_cooldown` | — | — | G8 |
| H11 | Truncado max_response_length 100-800 chars | `core/ia_engine.py:_truncate` | — | — | G8 |
| H12 | Detección automática de fortune type (suerte/tarot/horoscopo) | `core/ia_engine.py:_detect_fortune_type` | — | — | G8 |
| H13 | 3 prompts dramáticos especiales | `core/ia_engine.py:_FORTUNE_PROMPTS` | — | — | G8 |
| H14 | `SOYKORU_CONTEXT` configurable (en G hacer dinámico) | `core/ia_engine.py:SOYKORU_CONTEXT` | — | — | G8 |
| H15 | System prompt custom configurable | `core/ia_engine.py:configure` | — | `config.json:ia.ia_system_prompt` | G8 |
| H16 | Log detallado: tokens, costo USD, gratis/pago | `core/ia_engine.py:_log_ia_detail` | log | — | G8 |
| H17 | Tab IA en SocialConfigDialog | `social_config.py:_build_ia_tab` | tab | — | G8 |
| H18 | Test IA con thread daemon + signal QMetaObject | `social_config.py:_ia_test/_ia_show_test_result` | botón | — | G8 |
| H19 | Comando `!ia` desde social_system | `core/social/music_ia.py:_cmd_ia` | — | — | G8 |
| H20 | `_ia_speak_lock` para serializar respuestas TTS | `social_system.py.__init__` | — | — | G8 |

---

## SECCIÓN I — Voces TTS (Fase G9)

| ID | Feature | Origen Python | UI | Persistencia | Fase G |
|----|---------|---------------|----|----|--------|
| I1 | TTSEngine con endpoint TikTok TTS | `core/tts_engine.py:ENDPOINT` | — | — | G9 |
| I2 | 74 voces verificadas hardcoded | `core/tts_engine.py:VOICES` | — | — | G9 |
| I3 | Canal CHAT (comentarios) | `tts_engine.py:_channel_chat + _process_chat_queue` | — | — | G9 |
| I4 | Canal SOCIAL (sistema social/duelos) | `tts_engine.py:_channel_social + _process_social_queue` | — | — | G9 |
| I5 | Canal FORTUNE (exclusivo, instantáneo) | `tts_engine.py:_channel_fortune + _process_fortune_queue` | — | — | G9 |
| I6 | 3 canales pueden sonar simultáneamente | `tts_engine.py` | — | — | G9 |
| I7 | Cache MD5 de audio MP3 | `tts_engine.py:_gen` | — | `data/tts_cache/<md5>.mp3` | G9 |
| I8 | Retries con backoff exponencial | `tts_engine.py:_gen` | — | — | G9 |
| I9 | Truncado: chat 150, social/fortune 400 chars | `tts_engine.py` | — | — | G9 |
| I10 | Split por `". "` para chunks largos en social | `tts_engine.py:_queue_social_audio` | — | — | G9 |
| I11 | `_social_gen_lock` atomicidad de mensajes | `tts_engine.py` | — | — | G9 |
| I12 | Username normalization | `tts_engine.py:_normalize_username` | — | — | G9 |
| I13 | 3 niveles de voces (default → perfil/global → per-user) | `tts_engine.py:_get_voice_for_user` | — | varias | G9 |
| I14 | Voces globales vs por perfil (radio toggle) | `gui/views/audio.py:_on_voice_type_changed` | sidebar radios | `config:use_global_voices` | G9 |
| I15 | VoicesDialog (asignar voz por @user) | `gui/dialogs/voices_dialog.py` | dialog 550x500 | `profiles.json:profile_voices` o `global_voices` | G9 |
| I16 | "Probar voz" en VoicesDialog | `voices_dialog.py:test` | botón | — | G9 |
| I17 | Sub-modal de edit voz por user | `voices_dialog.py:edit` | — | — | G9 |
| I18 | TTS GroupBox en sidebar (volumen, voice combo, prueba, voces button) | `MainWindow._build_left_panel` | sidebar | `config:tts_*` | G9 |
| I19 | Volumen slider con label `%` live | `gui/views/audio.py:_on_volume_change` | — | — | G9 |
| I20 | `speak_now` síncrono para botón "Probar" | `tts_engine.py:speak_now` | — | — | G9 |
| I21 | clear_cache al boot | `tts_engine.py.__init__` | — | — | G9 |
| I22 | Stop limpio de los 3 canales | `tts_engine.py:stop` | — | — | G9 |

---

## SECCIÓN J — Stream Profiles + sonidos + minigames (Fase G10)

| ID | Feature | Origen Python | UI | Persistencia | Fase G |
|----|---------|---------------|----|----|--------|
| J1 | StreamProfilesDialog con cards | `gui/dialogs/profiles_dialog.py` | dialog 880x640 | `stream_profiles/*.json` | G10 |
| J2 | Card 82px con icono, name, sub-info, fecha | `profiles_dialog.py:_ProfileCard` | — | — | G10 |
| J3 | Save profile (snapshot completo) | `gui/views/stream_profiles.py:save_stream_profile` | botón | crea JSON | G10 |
| J4 | Load profile con backup automático `pre_load` | `stream_profiles.py:_load_profile_by_id` | botón | — | G10 |
| J5 | Block-signals antes de cambios programáticos | `stream_profiles.py:_load_profile_by_id` | — | — | G10 |
| J6 | Duplicate / Rename / Delete profile | `profiles_dialog.py:_on_*` | botones | — | G10 |
| J7 | Export/Import .lce_profile.json | `profiles_dialog.py:_on_export/_on_import` | — | — | G10 |
| J8 | Schema completo (name, game, gifts, sounds, voices, tts, theme, rules, entities, items, events) | `stream_profiles.py:save_stream_profile` | — | `stream_profiles/*.json` | G10 |
| J9 | SoundsDialog 3 tabs (Biblioteca, Regalos, Eventos) | `gui/dialogs/sounds_dialog.py` | dialog | `profiles.json:profile_sounds` | G10 |
| J10 | Tab Biblioteca: cards de archivos + add/test/delete | `sounds_dialog.py:_build_library_tab` | tab | — | G10 |
| J11 | Tab Regalos: card por gift + combo de sonido + test/remove | `sounds_dialog.py:_build_gifts_tab` | tab | — | G10 |
| J12 | Tab Eventos: 3 filas (follow, share, superfan) + combo | `sounds_dialog.py:_build_events_tab` | tab | — | G10 |
| J13 | Volume slider | `sounds_dialog.py:_on_vol` | — | — | G10 |
| J14 | Playback con `pygame.mixer.Sound` en thread daemon | `sounds_dialog.py:_play_sound` + `gui/views/audio.py:_play_event_sound` | — | — | G10 |
| J15 | Sound queue + worker daemon (cola FIFO) | `gui/views/audio.py:_queue_sound/_start_sound_worker` | — | — | G10 |
| J16 | Sound cache LRU 50 max | `gui/views/audio.py:_play_sound_and_wait` | — | — | G10 |
| J17 | MinigamesDialog (3 minijuegos) | `gui/dialogs/minigames_dialog.py` | dialog 520x580 | — | G10 |
| J18 | WordSearchGame (8 direcciones, NxN) | `core/minigames.py:WordSearchGame` | window | — | G10 |
| J19 | WordSearchLite mode (sin pistas, rondas auto) | `core/minigames.py` + `WordSearchLiteWindow` | window | — | G10 |
| J20 | WordBombGame (fragmentos, vidas, bonus abecedario) | `core/minigames.py:WordBombGame` | window | — | G10 |
| J21 | 19 categorías de palabras | `core/minigames.py:WORD_CATEGORIES` | — | — | G10 |
| J22 | spanish_words.py diccionario (1243 líneas) | `core/spanish_words.py` | — | — | G10 |
| J23 | minigame_stats persistentes | `core/minigame_stats.py` | — | `minigame_stats.json` | G10 |
| J24 | Avatar pool from `data/game_images/<g>/entities/*.png` | `gui/widgets/wordbomb_widget.py:pick_avatar` | — | — | G10 |
| J25 | game_sounds sintetizados (11 tipos ADSR) | `gui/widgets/game_sounds.py:play_sound` | — | — | G10 |
| J26 | `_process_minigame_command` desde chat | `MainWindow._process_minigame_command` | — | — | G10 |
| J27 | NewProfileDialog (compartir sonidos/voces globales) | `gui/dialogs/profile_dialog.py` | sub-modal | — | G10 |

---

## SECCIÓN K — Simulador + log (Fase G11)

| ID | Feature | Origen Python | UI | Persistencia | Fase G |
|----|---------|---------------|----|----|--------|
| K1 | SimulatorDialog 800x760 | `gui/dialogs/simulator_dialog.py` | dialog | — | G11 |
| K2 | 6 trigger types simulables (gift/comment/follow/share/subscribe/like) | `simulator_dialog.py:_build_type_combo` | — | — | G11 |
| K3 | Galería de gift cards 100x92 | `simulator_dialog.py:_SimGiftCard` | grid 6 cols | — | G11 |
| K4 | Search + sort por coins | `simulator_dialog.py:_on_gift_search/_toggle_sort` | — | — | G11 |
| K5 | Repeat con QSpinBox 1-100 | `simulator_dialog.py:_repeat_spin` | — | — | G11 |
| K6 | Burst mode con stagger 200ms | `gui/views/simulator.py:simulate_burst` | botón | — | G11 |
| K7 | 10 presets (Rosa/Galaxy/León/Diamante/Follow/Share/SuperFan/10 Likes/!spawn/!ia hola) | `simulator_dialog.py:presets` | grid 5 cols | — | G11 |
| K8 | Preview del gift seleccionado | `simulator_dialog.py:_selected_preview` | top bar | — | G11 |
| K9 | Status bar con auto-clear 2s | `simulator_dialog.py:_flash_status` | footer | — | G11 |
| K10 | `_execute_simulated_event` flujo idéntico a `on_event` real | `gui/views/simulator.py:_execute_simulated_event` | — | — | G11 |
| K11 | EnhancedLogWidget con 19 categorías | `gui/widgets/log_widget.py:LogCategory` | center bottom | — | G11 |
| K12 | 8 filtros UI (comments, gifts, social, rules, spotify, tts, system, errors) | `MainWindow._build_right_panel` | log toolbar pills | — | G11 |
| K13 | Auto-detection de category con 12 reglas regex | `log_widget.py:_detect_category` | — | — | G11 |
| K14 | Smart auto-scroll (solo si user está al final) | `log_widget.py:_on_scroll_changed` | — | — | G11 |
| K15 | Batch updates 50ms via timer | `log_widget.py:_flush_buffer` | — | — | G11 |
| K16 | Stats counter (gifts, follows, shares, likes, comments, rules) | `log_widget.py:stats` | right panel | — | G11 |
| K17 | MAX_LOG_ENTRIES = 500 con trim automático | `log_widget.py:_trim_old_entries` | — | — | G11 |
| K18 | Clear / Export / Reset stats / Show timestamps | `MainWindow._clear_log/_export_log/_reset_stats` | botones | — | G11 |
| K19 | SystemHealthWidget (TikTok/Game/TTS/Backup) | `gui/widgets/health.py` | right panel | — | G11 |
| K20 | Health timer 30s | `MainWindow._health_timer` | — | — | G11 |
| K21 | Activity indicator + 5s pulse | `MainWindow._activity_timer/_update_activity` | sidebar | — | G11 |

---

## SECCIÓN L — Backup manager (Fase G12)

| ID | Feature | Origen Python | UI | Persistencia | Fase G |
|----|---------|---------------|----|----|--------|
| L1 | BackupManager con MAX_BACKUPS=7 FIFO | `gui/widgets/backup_manager.py` | — | `data/backups/` | G12 |
| L2 | 4 reasons: manual, pre_load, prerestore, pre_import | `backup_manager.py:CRITICAL_FILES + reason param` | — | — | G12 |
| L3 | 3 critical files + glob `rules_*.json` + glob `data_*.json` | `backup_manager.py:create_backup` | — | — | G12 |
| L4 | BackupDialog con cards de respaldos | `gui/dialogs/backup_dialog.py` | dialog 700x580 | — | G12 |
| L5 | Card con icon + reason badge + age relativo | `backup_dialog.py:_BackupCard + _REASON_MAP` | — | — | G12 |
| L6 | Restore con confirm + pre-restore backup auto | `backup_dialog.py:_on_restore` | botón | — | G12 |
| L7 | Delete con confirm | `backup_dialog.py:_on_delete` | botón | — | G12 |
| L8 | Auto-cleanup al crear (ordenar por mtime) | `backup_manager.py:_cleanup_old_backups` | — | — | G12 |
| L9 | Atomic write con `os.fsync` (config_store) | `core/config_store.py:_write_json_atomic` | — | — | G12 |
| L10 | Migración automática config monolítico → particionado | `core/config_store.py:migrate_from_monolithic` | — | — | G12 |
| L11 | "Respaldos" botón en sidebar | `MainWindow._build_left_panel` | sidebar | — | G12 |

---

## SECCIÓN M — Overlays manager (Fase G13)

| ID | Feature | Origen Python | UI | Persistencia | Fase G |
|----|---------|---------------|----|----|--------|
| M1 | OverlayClient con backend Cloudflare Workers | `core/overlays.py:OverlayClient` | — | `overlays.json` | G13 |
| M2 | OVERLAY_REGISTRY (taps, streak — extensible) | `core/overlays.py:OVERLAY_REGISTRY` | — | — | G13 |
| M3 | Anonymous user_id SHA256 hostname | `core/overlays.py:_generate_user_id` | — | — | G13 |
| M4 | Migración automática de IDs viejos (`<os_user>-XXXX`) | `OverlayClient._load_config` | — | — | G13 |
| M5 | `send_event` async fire-and-forget (timeout 1.5s) | `OverlayClient.send_event` | — | — | G13 |
| M6 | Skip si NO hay overlay enabled (anti-waste) | `OverlayClient.send_event` | — | — | G13 |
| M7 | Throttled error log (3 max + silencio) | `OverlayClient._log_error_throttled` | — | — | G13 |
| M8 | `test_connection()` GET /health | `OverlayClient.test_connection` | — | — | G13 |
| M9 | OverlaysManager dialog con grid 2 cols | `gui/dialogs/overlays_manager.py` | dialog 960x720 | — | G13 |
| M10 | OverlayCard 420x420 con preview QWebEngineView | `gui/widgets/overlay_card.py:OverlayCard` | — | — | G13 |
| M11 | Pre-warmup OverlaysManager detrás del splash | `MainWindow._warmup_overlays_manager` | — | — | G13 |
| M12 | "Copiar URL" con feedback "Copiado al portapapeles" | `OverlayCard._copy_url` | botón | — | G13 |
| M13 | "Test" event con payload por overlay | `OverlayCard._send_test_event` | botón 🧪 | — | G13 |
| M14 | "Reload remoto" forzar location.reload() en browser source | `OverlayCard._send_reload` | botón 🔄 | — | G13 |
| M15 | OverlaySettingsDialog con campos por overlay | `overlay_card.py:OverlaySettingsDialog` | sub-modal 440 | — | G13 |
| M16 | Live update via `<id>_config` event SIN recargar | `OverlaySettingsDialog._save` | — | — | G13 |
| M17 | Settings de taps: goal, color (QColorDialog), message, reset_on_goal | `overlay_card.py:OverlaySettingsDialog` | — | `overlays.json:overlays.taps` | G13 |
| M18 | Settings de streak: duration ms, label | `overlay_card.py` | — | `overlays.json:overlays.streak` | G13 |
| M19 | "Cambiar mi alias" con sanitización URL-safe | `OverlaysManager._change_alias` | botón footer | — | G13 |
| M20 | Cards "PRÓXIMAMENTE" placeholder (3) | `OverlaysManager._build_placeholder_card` | — | — | G13 |
| M21 | "Overlays" botón en sidebar | `MainWindow._build_left_panel` | sidebar | — | G13 |

---

## SECCIÓN N — Conexión TikTok (Fase G14 — pulido + integración)

| ID | Feature | Origen Python | UI | Persistencia | Fase G |
|----|---------|---------------|----|----|--------|
| N1 | TikTokWorker (584 líneas, QThread) | `core/tiktok_client.py` | — | — | G14 |
| N2 | 8 signals (connected, disconnected, event_received, log_message, error, api_error, stats_updated, gift_image_detected) | `tiktok_client.py` | — | — | G14 |
| N3 | Backoff exponencial (max 8 retries) | `tiktok_client.py:run` | — | — | G14 |
| N4 | Auto-reconexión tras DisconnectEvent | `tiktok_client.py:_should_reconnect` | — | — | G14 |
| N5 | Detección de cambios de API (19 keywords + types) | `tiktok_client.py:API_CHANGE_ERRORS` | dialog modal | — | G14 |
| N6 | Verificar `is_live` con timeout 15s | `tiktok_client.py:_run_client_optimized` | — | — | G14 |
| N7 | 6 event handlers (Connect, Disconnect, Gift, Like, Comment, Follow, Share) | `tiktok_client.py` | — | — | G14 |
| N8 | Streak con `group_id` (OrderedDict max 50) | `tiktok_client.py:on_gift` | — | — | G14 |
| N9 | Calibración inicial de likes + delta cap 0-500 | `tiktok_client.py:on_like` | — | — | G14 |
| N10 | Auto-comando si comment empieza con `!` | `tiktok_client.py:on_comment` | — | — | G14 |
| N11 | Username extraction con 4 fallbacks | `tiktok_client.py:_get_username_fast` | — | — | G14 |
| N12 | `_extract_gift_image` URL del PNG del gift | `tiktok_client.py` | — | — | G14 |
| N13 | "TikTok Live" GroupBox sidebar (status, likes, user input, conectar btn) | `MainWindow._build_left_panel` | sidebar | `config:tiktok_username` | G14 |
| N14 | `_check_tiktok_api` con check_update + rollback | `MainWindow._check_tiktok_api` + `core/version_checker.py` | botón sidebar | — | G14 |
| N15 | KNOWN_GOOD_VERSIONS para rollback | `core/version_checker.py` | — | — | G14 |
| N16 | API Error modal con copy command | `MainWindow:on_api_error` | dialog | — | G14 |

---

## SECCIÓN O — Spotify (Fase G14)

| ID | Feature | Origen Python | UI | Persistencia | Fase G |
|----|---------|---------------|----|----|--------|
| O1 | SpotifyClient con anti-rate-limit | `core/spotify_client.py` (1652 líneas) | — | — | G14 |
| O2 | OAuth con server local :8888 | `spotify_client.py:_authenticate_inner` | — | `secrets/spotify/cache` | G14 |
| O3 | Auto-reconnect al boot sin abrir browser | `spotify_client.py:try_auto_connect` + `MainWindow:_init_spotify` | — | — | G14 |
| O4 | Multi-cuenta (`accounts.json`) | `spotify_client.py:_save_account_info` | — | `secrets/spotify/accounts.json` | G14 |
| O5 | Throttling 3s/call + 8/30s window | `spotify_client.py:_throttle_api_call` | — | — | G14 |
| O6 | Cap progresivo 60→120→300s | `spotify_client.py:_RATE_LIMIT_CAPS` | — | — | G14 |
| O7 | Recovery mode 10min cache 120s | `spotify_client.py:_RECOVERY_DURATION` | — | — | G14 |
| O8 | Search cache 15min | `spotify_client.py:_search_cache` | — | — | G14 |
| O9 | `_SpotipyFilter` para silenciar logs 429 | `spotify_client.py` | — | — | G14 |
| O10 | `play_request` con cola random para priority users | `spotify_client.py:play_request` | — | — | G14 |
| O11 | `playfan_request` con cuota diaria + context save | `spotify_client.py:playfan_request` | — | — | G14 |
| O12 | `_save_spotify_context/_restore_spotify_context` | `spotify_client.py` | — | — | G14 |
| O13 | `check_and_advance` timer 30s | `spotify_client.py:check_and_advance` + `MainWindow._spotify_timer` | — | — | G14 |
| O14 | Skip / Pause / Resume / Toggle | `spotify_client.py:skip_current/pause/resume/toggle_playback` | — | — | G14 |
| O15 | Get devices + device_id config | `spotify_client.py:get_devices` | — | — | G14 |
| O16 | Tab Spotify en SocialConfigDialog | `social_config.py:_build_spotify_tab` | tab | `config.json:spotify` | G14 |
| O17 | Cuentas guardadas combo + load/save/delete | `social_config.py:_spotify_load_account/_save/_delete` | — | — | G14 |
| O18 | Guía paso a paso colapsable | `social_config.py:spotify_guide_*` | — | — | G14 |
| O19 | Now playing label + queue table | `social_config.py:_spotify_apply_ui_data` | — | — | G14 |
| O20 | UI timer 45s para refresh now playing | `social_config.py:_spotify_ui_timer` | — | — | G14 |
| O21 | Priority users + playfan_uses configurables | `social_config.py:spotify_prio_table` | — | — | G14 |
| O22 | 5 comandos enabled (`play, skip, cola, pause, playfan`) configurables | `social_config.py:spotify_cmd_checks` | checkboxes | — | G14 |
| O23 | TTS lectura de comandos música toggle | `social_config.py:spotify_tts_check` | checkbox | — | G14 |

---

## SECCIÓN P — Fortuna (cross-fase, principalmente G7+G9)

| ID | Feature | Origen Python | UI | Persistencia | Fase G |
|----|---------|---------------|----|----|--------|
| P1 | "Fortuna" GroupBox en sidebar | `MainWindow._build_left_panel` | sidebar | `config:fortune_*` | G7 |
| P2 | fortune_enabled checkbox | `MainWindow` | — | — | G7 |
| P3 | fortune_gift selector (combo de gifts) | `gui/views/audio.py:_load_fortune_gifts` | — | — | G7 |
| P4 | fortune_voice combo (74 voces) | `MainWindow._build_left_panel` | — | — | G7 |
| P5 | fortune_volume slider | `MainWindow + audio.py:_on_fortune_volume_change` | — | — | G7 |
| P6 | "Probar Fortuna" button | `audio.py:_test_fortune` | — | — | G7 |
| P7 | `_check_fortune_trigger` (gift match exacto normalizado) | `audio.py:_check_fortune_trigger` | — | — | G7 |
| P8 | 17 categorías + 25 intros (842 mensajes total) | `data/fortunes.json` | — | — | G7 |
| P9 | Random uniforme entre TODOS los mensajes | `audio.py:_get_random_fortune` | — | — | G7 |
| P10 | `_clean_name_for_tts` (solo letras) | `audio.py:_clean_name_for_tts` | — | — | G7 |
| P11 | Canal FORTUNE TTS exclusivo | `tts_engine.py:speak_fortune` | — | — | G7/G9 |

---

## SECCIÓN Q — Infraestructura runtime (cross-fase, base)

| ID | Feature | Origen Python | UI | Persistencia | Fase G |
|----|---------|---------------|----|----|--------|
| Q1 | Paths centralizados | `core/paths.py` | — | — | G14 |
| Q2 | `ensure_runtime_dirs()` al boot | `core/paths.py` | — | crea dirs | G14 |
| Q3 | `resolve_spotify_secret` con backward-compat legacy | `core/paths.py` | — | — | G14 |
| Q4 | Logger central rotación 2MB×5 | `core/logger.py:configure_logging` | — | `logs/livechaos.log` | G14 |
| Q5 | `as_callback` adapter para código viejo | `core/logger.py` | — | — | G14 |
| Q6 | config_store partición 4 archivos | `core/config_store.py` | — | `config + gifts + games + profiles` | G14 |
| Q7 | `_write_json_atomic` con fsync + rename | `core/config_store.py` | — | — | G14 |
| Q8 | `migrate_from_monolithic` automática | `core/config_store.py` | — | — | G14 |
| Q9 | Auto-save timer 5min | `MainWindow._autosave_timer` | — | — | G14 |
| Q10 | `_unsaved_changes` flag | `MainWindow` | — | — | G14 |
| Q11 | 7 atajos de teclado | `MainWindow._setup_shortcuts` | global | — | G14 |
| Q12 | F1 ayuda con QMessageBox | `MainWindow._show_shortcuts_help` | dialog | — | G14 |
| Q13 | closeEvent ordenado: 11 timers + cachés + TTS + worker + overlays | `MainWindow.closeEvent` | — | — | G14 |
| Q14 | PyInstaller frozen detection (BUNDLE_DIR vs BASE_DIR) | `gui/constants.py` | — | — | G14 |
| Q15 | Auto-copy bundle data al cwd al boot (PyInstaller) | `gui/constants.py` | — | — | G14 |

---

## Resumen de cobertura

| Sección | Features | Fase G |
|---------|---------:|--------|
| A — Identidad visual | 11 | G1 |
| B — Sistema de imágenes | 13 | G2 |
| C — Galería de Donaciones | 17 | G3 |
| D — Conexión con juegos | 24 | G4 |
| E — Catálogo de entidades | 20 | G5 |
| F — Editor de reglas | 36 | G6 |
| G — Sistema social | 35 | G7 |
| H — IA real | 20 | G8 |
| I — Voces TTS | 22 | G9 |
| J — Stream Profiles + sonidos + minigames | 27 | G10 |
| K — Simulador + log | 21 | G11 |
| L — Backup manager | 11 | G12 |
| M — Overlays manager | 21 | G13 |
| N — Conexión TikTok | 16 | G14 |
| O — Spotify | 23 | G14 |
| P — Fortuna (cross-fase) | 11 | G7/G9 |
| Q — Infraestructura runtime | 15 | G14 |

**Total**: **343 features explícitas** mapeadas a fase G.

---

## Sistemas NO contemplados en el borrador G1-G14

Tras G0.3-G0.8 NO surgieron sistemas COMPLETAMENTE NUEVOS, pero sí **expansiones**:

### Expansión de G7 (Sistema social)
- **35 comandos** confirmados (más detallados que el borrador).
- **Auto-rachas con timer 1h** + admin activate.
- **Taps system completo** con historial diario y rankings periodo.
- **Auto-add new commands** con `known_commands` tracking.

### Expansión de G8 (IA)
- **`SOYKORU_CONTEXT` configurable** (no hardcoded en el port).
- **Auto-fallback** con `_FREE_FALLBACK_ORDER`.
- **`MODELS` y `_COST_RATES`** completos por proveedor.

### Expansión de G14 (final, infraestructura compleja)
- **Spotify completo** (1652 líneas) con anti-rate-limit progresivo.
- **TikTok detection de cambios de API** con 19 keywords.
- **Particionado de config** con migración automática.

### Expansión de G2 (Sistema de imágenes)
- **`tEXt` metadata injection** en PNG.
- **Tinting destructivo** para fallback monocromático.
- **3 niveles de fallback**: PNG real → default por categoría → letter generated.

### Items que cruzan fases (no son sistemas completos)
- **Fortuna** se reparte entre G7 (UI sidebar + match) y G9 (canal TTS exclusivo).
- **Auto-track keyboard shortcuts** + close event en G14.

---

## Validación final

✅ **Cero features huérfanas** — TODAS las features detectadas en G0.3-G0.8
están asignadas a una fase G.

✅ **Sin sistemas surprise** — el borrador G1-G14 fue suficientemente
inclusivo. Solo se EXPANDEN secciones; NO se agregan G15+.

✅ **Cross-references válidas** — cada `Origen Python` apunta a un archivo
auditado en G0.3 / G0.4 / G0.5 / G0.6.

✅ **Persistencia explícita** — cada feature que escribe a disco indica el
archivo JSON en `data/`.

---

## Implicación para G0.10

El plan G final puede mantener las **14 fases** del borrador. Los
documentos G1-G14 se expanden en su sección con los IDs de feature
específicos que les corresponden de esta matriz.
