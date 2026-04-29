# MARU Original — `gui/main_window.py` (3345 líneas)

> Audit completo de la ventana principal y orquestador de toda la app.
> Fuente: `LiveChaosEngine_Refactored/gui/main_window.py`.
> Cubre línea 1 a 3345.

---

## 1. Entry point y arranque de la app

### 1.1 `main.py` (4 líneas)
```python
from gui import main
if __name__ == "__main__":
    main()
```

### 1.2 `gui/__init__.py:main()` — orquesta el splash + ventana

Pasos exactos al arrancar:

1. **Importar `QtWebEngineWidgets` ANTES de QApplication** — bug Qt 6 con
   OpenGL/Chromium. Evita parpadeo cuando el `OverlaysManager` (que usa
   `QWebEngineView`) se construye después.
2. `QApplication.setAttribute(AA_ShareOpenGLContexts, True)` — necesario
   para compartir contextos GL entre la main window y los webviews.
3. `QApplication.setHighDpiScaleFactorRoundingPolicy(PassThrough)` —
   render limpio en monitores 1.25x/1.5x.
4. `app.setStyle("Fusion")` + dark `QPalette` (`#0d0d14`) base antes de
   crear ventanas, para que el splash ya nazca oscuro.
5. Crear `AnimatedSplashScreen` y arrancarlo.
6. Cuando el splash termina (`splash.finished`):
   - Construir `MainWindow()` con **opacidad 0** (oculta).
   - Llamar `main_window._warmup_overlays_manager()` para pre-construir
     el `OverlaysManager` detrás del splash. Absorbe el flicker de
     inicialización de Chromium mientras el splash sigue visible.
   - `main_window.showMaximized()` (todavía con opacidad 0).
   - `processEvents()` 2 veces.
   - Después de 50ms: setOpacity(1) + `splash.fade_out()`.

> **G1 nota**: este arranque hay que portarlo con cuidado. En Electron
> la equivalencia es: ventana principal con `show: false` + `splash` BrowserWindow
> + `setOpacity(0)` → cargar todo → `setOpacity(1)` con fade. El
> "warmup" del WebView no aplica igual (Electron ya tiene Chromium nativo),
> pero sí hay que pre-cargar los iframes de overlays.

---

## 2. Clase `MainWindow`

### 2.1 Herencia (multi-mixin)

```python
class MainWindow(
    QMainWindow,
    AudioMixin,         # gui/views/audio.py — 425 líneas
    ImagesMixin,        # gui/views/images.py — 298 líneas
    SimulatorMixin,     # gui/views/simulator.py — 263 líneas
    StreamProfilesMixin, # gui/views/stream_profiles.py — 669 líneas
    CategoryTabsMixin,  # gui/views/category_tabs.py — 450 líneas
):
```

> Auditar los mixins en G0.5 — varios métodos llamados desde main_window
> viven en ellos (ej: `_play_event_sound`, `_load_fortune_gifts`,
> `_test_fortune`, `_check_fortune_trigger`, `_create_default_category_tabs`,
> `_update_category_tabs`, `_refresh_category_list`, `_init_simulator_vars`,
> `on_sim_event_change`, `_get_entity_icon`, `_init_game_image_folders`,
> `_resolve_gift_images`, `_save_gifts_only`, `open_simulator_dialog`,
> `open_profiles_dialog`, `_social_speak`, `_social_log`,
> `_social_duel_speak`, `_social_fortune_speak`,
> `_execute_custom_game_action`).

### 2.2 Property `current_theme` con auditor

Property especial: **cada cambio de tema se loguea con traceback corto**
en `logs/livechaos.log` con el formato:

```
THEME-CHANGE: <old> → <new> origen: caller1:line1 → caller2:line2 → caller3:line3
```

Esto existe para diagnosticar el bug "el tema cambia solo al arrancar".
La lógica de detección: comparar `_current_theme_value` con el nuevo
valor; si difieren, log + actualizar.

> **G1 nota**: en el nuevo MARU borramos los temas Aurora y Cyberpunk —
> el setter loggeable se mantiene pero por ahora solo aceptaría
> `"midnight"`. La auditoría del valor sigue siendo útil.

### 2.3 `__init__` — pasos exactos

1. **Título** y **minSize 1200x800** → luego se reduce a 1000x700.
2. **Icono de ventana**: probar en orden `BASE_DIR/icon.ico`,
   `BASE_DIR/icon.png`, `BUNDLE_DIR/icon.ico`, `BUNDLE_DIR/icon.png`,
   `Path("icon.ico")`, `Path("icon.png")`, y como fallback `logo.png`.
3. **Cachés vacíos**: `_cache`, `_last_refresh`, `_refresh_cooldown=0.1`,
   `_icon_path_cache`, `_image_index`.
4. **Cargar config** vía `core.config_store.load_config` con migración
   automática del config monolítico al esquema particionado
   (`config.json`, `gifts.json`, `games.json`, `profiles.json`).
5. **Tema**: leer `theme` del config; si no es uno válido de `THEMES`,
   caer a `DEFAULT_THEME = "midnight"`. Setear `_current_theme_value`
   directo (storage interno) y `gui_constants.CURRENT_STYLE`.
6. **TTS Engine** (`core.tts_engine.TTSEngine(DATA_DIR / "tts_cache")`):
   - `volume = config.tts_volume / 100.0`
   - `enabled_chat = config.tts_enabled` (default True)
   - `enabled = enabled_chat` (compat retro)
   - `default_voice = config.default_voice` (default `"es_mx_002"`)
7. **SocialSystem**: pasar 4 callbacks (speak normal, log, duel speak,
   fortune speak). Configurar con:
   - `enabled` (default True)
   - `require_register` (default True)
   - `cooldown` (default 10s)
   - `timeout` (default 90s para responder duelos)
   - `volume` (config.social_volume/100, default 0.8)
   - `voice` (config.social_voice, default "")
8. **IA Engine**: si hay `config.ia`, configurar con
   `enabled, provider, api_key, model, max_length, cooldown,
   system_prompt, api_keys` (este último es un dict por proveedor).
9. **Spotify se inicializa al final** (necesita log_text construido).
10. **`sound_volume`** (default 80).
11. **Juegos predefinidos** (3): Valheim, Terraria, Minecraft.
    Defaults: Valheim/Terraria → host `localhost`, port 5000.
    Minecraft → host `localhost`, port 25575 (RCON), password "".
12. **`load_custom_games()`**: agrega los juegos custom desde
    `config.custom_games` al dict `self.games` y a `GAME_FEATURES`.
13. **RuleEngine**: `RuleEngine(DATA_DIR, self.games, self.tts)`.
    Setear `custom_action_callback = self._execute_custom_game_action`
    y `custom_games_config = self.custom_games_config`.
14. **`current_game`** (default `"valheim"`).
15. **`custom_gifts`** (global, no por perfil): cargar desde config.
    `_resolve_gift_images()` (en mixin).
16. **`entity_images`** desde config + `ensure_trigger_icons` (descarga
    los 7 iconos de trigger si faltan) + `_init_game_image_folders`
    (mixin).
17. **`profile_sounds`** y **`profile_voices`** (por perfil, dicts por
    `current_game`).
18. Cargar `sounds` y `voices` del perfil actual.
19. **TikTok worker**: `tiktok_worker = None`, `tiktok_connected = False`.
20. **Minigames state**: `_active_minigame`, `_minigame_window`,
    `_minigames_enabled` (default False).
21. **Construir UI** (`setup_ui()`).
22. **Aplicar tema** (`apply_theme()`).
23. `on_sim_event_change(0)` (mixin) — inicializa visibilidad simulador.
24. `setUpdatesEnabled(False) + refresh_all() + setUpdatesEnabled(True)` —
    refresh inicial sin parpadeo.
25. Si `_gifts_need_save`: `QTimer.singleShot(500, self._save_gifts_only)`.
26. **Log de bienvenida**: `🚀 LiveChaos Engine v8.5 - Simulador + Perfiles`.
27. **Log de voces cargadas** (si `len(tts.user_voices) > 0`).
28. **Auto-save timer**: cada 5 minutos (300_000 ms), llama `_autosave`
    si `_unsaved_changes` está True.
29. **BackupManager** sobre `DATA_DIR`. **Sin auto-timer**: backups son
    manuales (botón) + antes de cargar perfil + antes de importar reglas.
30. **Auto-racha timer**: cada **1 hora** (3_600_000 ms) llama
    `_process_auto_rachas`. Procesa al iniciar también (5s después).
31. **Taps cleanup timer**: cada **6 horas** (21_600_000 ms) llama
    `_cleanup_taps_auto`. Limpieza inicial 10s después de arrancar.
32. **`RuleValidator(DATA_DIR)`**.
33. **`_init_spotify()`** — más abajo.
34. **`OverlayClient()`** + callback `streak_overlay_callback` que
    manda evento `"streak"` con `{user, days}` al backend.
35. `_overlays_manager = None` (se warmup-ea desde `main()`).

### 2.4 `_warmup_overlays_manager()`

Pre-construye `OverlaysManager` OCULTO (con flags `Window | MinimizeButton |
MaximizeButton | CloseButton`, modalidad `NonModal`). NO llama show().
Si falla, log warning pero no bloquea — `manage_overlays()` lo construye
on-demand como fallback.

### 2.5 `load_config()` / `save_config()`

- **Load**: `config_store.migrate_from_monolithic()` → `load_config()`.
  La migración es automática al primer arranque (separa `config.json`
  monolítico en `config.json + gifts.json + games.json + profiles.json`).
- **Save**: persiste el dict completo. Es defensivo:
  valida que el `theme` esté en `THEMES`; si no, loguea WARNING y usa
  `DEFAULT_THEME`. **Antes de guardar** llama
  `save_profile_sounds()` y `save_profile_voices()`.

  Las claves que persiste explícitamente:
  - `tts_volume`, `sound_volume`, `tts_enabled`, `default_voice`
  - `current_game`, `tiktok_username`
  - `custom_gifts`, `entity_images`, `profile_sounds`, `profile_voices`
  - `custom_games`, `games` (config básica de los predefinidos)
  - `theme` (validado)
  - `fortune_enabled`, `fortune_gift`, `fortune_voice`, `fortune_volume`
  - `social_enabled`, `social_cooldown`, `social_timeout`,
    `social_volume`, `social_voice`, `social_require_register`

### 2.6 `load_profile_voices()` / `save_profile_voices()`

Las voces TTS personalizadas tienen **2 modos**:
- **Por perfil**: `profile_voices[current_game]` se aplica solo cuando
  ese juego está activo.
- **Globales**: `global_voices` se comparten entre perfiles (cuando
  `use_global_voices=True`).

Toggle desde 2 radios en el sidebar (`voices_profile_radio` /
`voices_global_radio`). Por defecto: **por perfil** (`use_global_voices=False`).

`save_profile_voices()` solo persiste si **no** está en modo global.

### 2.7 `load_custom_games()`

Itera `custom_games_config`, salta IDs que ya existen en `self.games`
(no sobrescribir predefinidos), instancia `CustomGame(gid, gconfig)` y
actualiza `GAME_FEATURES[gid]` con `{entities, items, events}` según
flags `has_entities/has_items/has_events`.

---

## 3. UI — Layout principal

### 3.1 `setup_ui()`

```
QWidget central
└── QHBoxLayout
    ├── _build_left_panel(main)   ── sidebar 310px fijo (scroll)
    ├── _build_center_panel(main) ── tabs (stretch=1)
    └── _build_right_panel(main, central) ── log 380px fijo
```

`spacing=10`, `contentsMargins=10`.

### 3.2 `_build_left_panel(main)` — sidebar izquierdo (líneas 439–886)

**`QScrollArea`** con `setWidgetResizable(True)`, sin scrollbar horizontal,
vertical AsNeeded, frame None. Estilo del scrollbar: barra muy fina
(6px), color `rgba(100,100,150,0.5)`, sin botones de flecha.

Contenedor interior con `WA_TranslucentBackground`, ancho fijo 310px
(`setFixedWidth(310)`, `MinimumWidth=280`, `MaximumWidth=320`).
Layout vertical, spacing 8, contentsMargins (0, 0, 5, 0).

**Bloques (de arriba a abajo):**

#### a) Logo MaruLive
- Si existe `logo.png` (en `BASE_DIR`, `BUNDLE_DIR` o cwd): mostrar
  pixmap escalado a 100px de ancho con `SmoothTransformation`.
- Si no existe: texto `"MaruLive"` 18px bold con color
  `gui_constants.ACCENT`.
- Subtítulo `"Chaos Engine v8.5"` (9px, `#888`, centrado).

#### b) GroupBox `"🎵 TikTok Live"`
- `tiktok_status` (QLabel) — estado: `"⚫ Desconectado"` / `"🟡 Conectando..."` /
  `"🟢 @<username>"`. 13px bold.
- `likes_label` (QLabel) — `"❤️ Likes: 0"`. 11px, color `#ff6b6b`.
- `activity_indicator` y `last_activity` (ocultos, solo lógica).
- `tiktok_user` (QLineEdit) — placeholder `"👤 Tu usuario de TikTok (sin @)"`.
- `tiktok_btn` (QPushButton) — texto `"🔌 Conectar"` con gradiente rojo
  (`gui_constants.ACCENT_RED → ACCENT_RED_DARK`), bold 13px,
  padding 10px, radius `gui_constants.BTN_RADIUS`. Tooltip `"Conectar/Desconectar (Ctrl+T)"`.
- `_activity_timer` (QTimer) — pulso cada 5s.

#### c) GroupBox `"🎮 Perfil de Juego"`
- `game_sel` (QComboBox) con items:
  - `"⚔️ Valheim"` data=`"valheim"`
  - `"🌍 Terraria"` data=`"terraria"`
  - `"⛏️ Minecraft"` data=`"minecraft"`
  - + custom games con su icon y name.
- `game_status` (QLabel) — `"⚫ Sin probar"` por default.
- `game_info` (QLabel) — descripción del juego (puerto, features). Wrap, 10px, `#888`.
- Botones en fila: `🔗 Probar` (F5 → `test_connection`), `⚙️ Config` (`config_game`).
- Botón `➕ Añadir Juego` (`manage_custom_games`).

#### d) GroupBox `"🔊 Texto a Voz"`
- `tts_on` (QCheckBox) — `"Leer comentarios del chat"`. Conectado a `on_tts_toggle`.
- `voice_sel` (QComboBox) — TODAS las voces de `TTSEngine.VOICES` (74 voces).
  Default seleccionado: `tts.default_voice`.
- `vol` (QSlider 0–100) horizontal con `vol_label` mostrando `%`.
  Conectado a `_on_volume_change`.
- `tts_test_input` (QLineEdit) — texto de prueba inicial:
  `"Hola, esta es una prueba"`.
- 2 botones: `Probar` (`test_tts`) y `👤 Voces` (`manage_voices`).
- 2 radios `📁 Por perfil` / `🌐 Globales` para tipo de voces custom.

#### e) GroupBox `"🔮 Fortuna"`
- `fortune_enabled` (QCheckBox).
- `fortune_gift` (QComboBox) — selector de regalo que dispara la fortuna.
  Cargado por `_load_fortune_gifts()` (mixin Audio).
- `fortune_voice` (QComboBox con TODAS las 74 voces). Default:
  `"en_female_madam_leota"` (voz mística).
- `fortune_volume` (QSlider 0–100) con label `%`. Default 80.
- Botón `🔮 Probar Fortuna` (`_test_fortune`).
- Hint: `"💡 Lee la suerte del viewer que envíe el regalo"`.

#### f) GroupBox `"💬 Sistema Social"`
- `social_enabled` (QCheckBox `"Activar"`) — toggle global del módulo.
  Conectado a `_on_social_enabled_change`.
- Botón `⚙️ Configurar` (`_open_social_config`) — abre `SocialConfigDialog`.
- Botón `🎲 Minijuegos` (`_open_minigames`) — abre `MinigamesDialog`.

#### g) GroupBox `"⚙️ Configuración"`
- `theme_sel` (QComboBox) con todos los temas. **Auto-fallback** si el
  tema guardado no aparece en la lista.
- Botones (todos en este orden):
  - `🎁 Regalos` → `manage_gifts`
  - `🔔 Sonidos` → `manage_sounds`
  - `🎭 Simulador` → `open_simulator_dialog` (Ctrl+Shift+S)
  - `💾 Perfiles` → `open_profiles_dialog`
  - `🔄 Respaldos` → `open_backup_manager`
  - `🔧 TikTok API` → `_check_tiktok_api`
  - `🎬 Overlays` → `manage_overlays`

Final: `addStretch(1)` para empujar todo arriba.

### 3.3 `_build_center_panel(main)` — panel central (líneas 888–972)

`QTabWidget` con tabs:

#### Tab `"📋 Reglas"` (siempre presente, primera)
- `rules_search` (QLineEdit) — placeholder `"🔍 Buscar regla..."`.
- Toolbar con 6 botones: `➕ Nueva`, `📋 Duplicar`, `✏️ Editar`,
  `🗑️ Eliminar`, `⏯️ On/Off`, `🧪 Probar`.
- 3 botones más compactos: `📥 Import`, `📤 Export`, `✅ Valid`.
- `rules_list` (QListWidget) con drag&drop interno (`InternalMove`).
  Reordenar guarda el orden con `_on_rules_reordered`.
  Doble-click → `edit_rule`.
  Estilo: borde inferior por item, item seleccionado con
  `border-left: 3px solid ACCENT_BLUE`.
- Cada item se renderiza con `_build_rule_widget(rule, gift_data)`:
  - Imagen del trigger (gift PNG si trigger=gift, o icono de tipo).
    Click cambia gift/entity.
  - Flecha visual `→`.
  - Imagen de la primera acción (entity/item/event/valuable).
  - Texto: nombre de regla en bold 13px (`🟢` o `⚫`), detalle en 11px
    color `#b2bec3` con texto del trigger + acciones.
  - Si es gift y tiene `coins`: label `"<n> 💎"` en `#f9ca24` bold.

#### Tabs dinámicas de categorías
- `category_tabs` dict `{category_id: {"widget", "list", "btn"}}`.
- `_create_default_category_tabs()` (mixin) crea las 3 por defecto:
  Entidades / Items / Eventos.
- `_update_category_tabs(categories)` ajusta según `games.json` del juego
  actual (juegos custom pueden tener categorías custom como `valuables`).

### 3.4 `_build_right_panel(main, central)` — panel derecho (líneas 974–1141)

Ancho fijo `380px`. spacing 8.

#### a) GroupBox `"📊 Estadísticas de Sesión"` (compacto, 50–70px alto)
6 labels:
- `🎁 0` Regalos (color `#ffd93d`)
- `👤 0` Follows (color `#3498db`)
- `📤 0` Shares (color `#2ecc71`)
- `❤️ 0` Likes (color `#e74c3c`)
- `💬 0` Comentarios (color `#74b9ff`)
- `🎮 0` Reglas (color `#6bcb77`)

Updated cada 1s por `_stats_timer` → `_update_stats_display()`.

#### b) `SystemHealthWidget()`
Status de TikTok / Game / TTS. Update cada **30s** (`_health_timer`).

#### c) GroupBox `"📜 Log en Tiempo Real"`
- Filtros como **2 filas de pills** dentro de un frame con borde redondeado:
  - Fila 1: 💬Chat, 🎁Gifts, 👥Social, 🎮Juego
  - Fila 2: 🎵Music, 🔊TTS, ⚙Sist, ⛔Error
- Cada pill: `QPushButton.setCheckable(True)`, `setChecked(True)`,
  estilo redondeado con borde y color del filtro. Cuando checked: bg lleno
  con `#1a1a2e` text; cuando unchecked: transparente.
- `log_text = EnhancedLogWidget()` (`gui/widgets/log_widget.py`,
  362 líneas — auditar en G0.5).
- Toolbar inferior: `Limpiar`, `Exportar`, `Reset Stats`, `Todos`,
  `⏱` checkbox para mostrar/ocultar timestamps.
- Filtros con **debounce de 100ms** para no recalcular en cada click.

### 3.5 `_setup_post_ui(central)`

- `NotificationWidget(central)` — toasts flotantes.
- `_stats_timer` (1s) — update_stats_display.
- `_activity_timer.start(5000)` — pulso de actividad.
- Log inicial: `🚀 LiveChaos Engine v8.5 iniciado` + `🎮 Juego activo: <Name>`.
- `_setup_shortcuts()`.

### 3.6 `_setup_shortcuts()`

| Shortcut | Action |
|---|---|
| `Ctrl+S` | `save_config` |
| `F5` | `test_connection` |
| `Ctrl+T` | `toggle_tiktok` |
| `Ctrl+Shift+S` | `open_simulator_dialog` |
| `Ctrl+R` | `refresh_all` |
| `Ctrl+L` | `_clear_log` |
| `F1` | `_show_shortcuts_help` |

`F1` muestra QMessageBox con la lista formateada.

---

## 4. Conexión TikTok

### 4.1 `toggle_tiktok()`
- Si conectado: stop worker, set status `"⚫ Desconectado"`, log.
- Si no: leer username (sin `@`), abrir `TikTokWorker(u)`, conectar
  signals (`connected`, `disconnected`, `event_received`, `log_message`,
  `error`, `api_error`, `stats_updated`, `gift_image_detected`),
  `worker.start()`. UI: `tiktok_btn.setEnabled(False)`,
  status `"🟡 Conectando..."` color `gui_constants.ACCENT`.

### 4.2 `on_connected(u)`
- Status `"🟢 @<u>"` color `#2ecc71`.
- Botón vuelve a `"🔌 Desconectar"` y `setEnabled(True)`.
- `likes_label` reset a 0.
- `rule_engine.reset_like_counters()`.
- `log_text.reset_stats()` + `_update_stats_display()`.
- Mandar `overlay_client.send_event("reset", {})` (defensive try).
- Notification toast `"✅ ¡Conectado a @<u>!"` 3s success.
- Log + `save_config()` + `health_widget.update_status("tiktok", OK, ...)`.

### 4.3 `on_disconnected()`
Reset UI + toast `"⚫ Desconectado"` + health UNKNOWN.

### 4.4 `on_event(etype, data)` — handler central de eventos TikTok
**Procesamiento exacto:**
1. `_update_activity(etype, data)` — actualiza indicador visual.
2. `_play_event_sound(etype, data)` (mixin Audio) — sonido instantáneo
   en background thread.
3. `rule_engine.process_event(current_game, etype, data)` → log de cada
   resultado con `LogCategory.RULE`.
4. Si `etype == "like"`: `social.record_tap(user, count)`.
5. `overlay_client.send_event(etype, data)` (defensive try — nunca rompe
   el flujo).
6. Si `etype == "gift"`: `_check_fortune_trigger(gift_id, user)` (mixin Audio).
7. Si `etype == "comment"`:
   - `_process_minigame_command(user, txt)` — si retorna True, return.
   - Si empieza con `!`: tomar primera palabra como comando, llamar
     `rule_engine.process_event(current_game, "command", cmd_data)`,
     log resultados, `social.process_command(user, txt)`.
   - Si no es comando y `tts.enabled_chat`: `tts.speak(txt, None, user)`.

### 4.5 `on_api_error(message)` — modal de upgrade TikTokLive
Diálogo modal 500x350 con:
- Título: `"⚠️ POSIBLE CAMBIO EN LA API DE TIKTOK"`.
- Texto explicativo (causas + soluciones — `pip install --upgrade TikTokLive`).
- Botones `📋 Copiar comando` (copia al portapapeles) y `Cerrar`.

### 4.6 `_update_activity` / `_dim_activity` / `_pulse_activity`
- `_update_activity`: cambia color a verde, escribe `🕒 <icon> @<user> - ahora`,
  programa `_dim_activity` en 2s.
- `_dim_activity`: vuelve a `#666`.
- `_pulse_activity` (cada 5s): si conectado y >30s sin eventos, muestra
  `"🕒 Esperando eventos..."`.

---

## 5. Reglas (CRUD + import/export/validate)

### 5.1 `add_rule()` / `edit_rule()`
Abre `RuleDialog(self, current_game, profile, TTSEngine.VOICES, rule|None, custom_gifts)`.
Acepta → `profile.add_rule()` o `profile.update_rule(rid, data)`. Refresh.

### 5.2 `duplicate_rule()`
Genera nuevo `id = uuid.uuid4().hex[:8]` y nombre `"<original> (copia)"`.

### 5.3 `del_rule()` / `toggle_rule()`
Confirm dialog para delete. Toggle no pide confirm.

### 5.4 `import_rules()`
Modal custom con:
- Info: nombre archivo, juego origen, # reglas.
- Radio: `➕ Añadir` (default) | `🔄 Reemplazar todas`.
- Checkbox `✅ Validar reglas antes de importar` (default True).
- Si hay errores: confirma "¿Importar de todas formas?".
- Antes de importar: `backup_manager.create_backup("pre_import")`.
- Genera nuevo `id` por regla con `uuid.uuid4().hex[:8]`.

### 5.5 `export_rules()`
Genera JSON con:
```json
{
  "version": "1.0",
  "game_id": "<game>",
  "exported_at": "<iso>",
  "rules_count": N,
  "rules": [...]
}
```
Default name: `rules_<game>_<YYYYMMDD>.json`.

### 5.6 `validate_all_rules()`
`rule_validator.validate_rules_batch(rules, game, custom_gifts)` →
modal 600x500 con resumen (errors/warnings/info) + lista de problemas.

### 5.7 `test_selected_rule()`
**Lógica completa**:
- Verificar `game.test_connection()` antes.
- Si Minecraft con `commands` directos y sin `actions`: usar `test_command`.
  Detectar errores Minecraft: `"Unknown" in msg or "error" in msg.lower() or
  "incorrect" in msg.lower() or "<--[HERE" in msg`.
- Para reglas con `actions`: iterar TODAS las acciones.
- Mapear `action_type` a método: `entity/spawn → spawn`,
  `item/give_item → give_item`, `event/trigger_event → trigger_event`,
  `valuable → spawn_valuable`.
- Si juego es custom: `_execute_custom_game_action`.
- Si todas OK: QMessageBox info; si parcial: QMessageBox warning.

### 5.8 `_quick_change_gift(rule_id)` y `_quick_change_entity(rule_id)`
Selectores rápidos accesibles desde el item de la lista de reglas.

`_quick_change_entity` abre `EntitySelectorDialog` con:
- TODAS las categorías visibles del juego (`entities`, `items`, `events`,
  `valuables` si tiene).
- `multi_select=True`: si seleccionan 1, sobrescribe acción 0; si seleccionan
  N, **reemplaza todas las acciones de la regla** con N nuevas.

### 5.9 `_on_rules_reordered()` (drag&drop)
Lee orden desde la lista visual, reordena `profile.rules`, guarda profile.

---

## 6. Cambio de juego

### 6.1 `on_game_change(idx)`
1. `save_profile_sounds()` + `save_profile_voices()` (del juego anterior).
2. Update `current_game = game_sel.currentData()`.
3. Cargar `sounds` y `voices` del nuevo perfil.
4. Reset `game_status` a `"⚫ Sin probar"`.
5. `update_game_ui()` (refresca pestañas según features/categorías).
6. `setUpdatesEnabled(False) + refresh_all() + setUpdatesEnabled(True)`.
7. `save_config()`.
8. Log `"🎮 Perfil cambiado a <game>"`.

### 6.2 `update_game_ui()`
Actualiza texto descriptivo de info por juego:
- `valheim`: `"Puerto 5000 (spawn.py)\n✅ Entidades  ✅ Items  ❌ Eventos"`.
- `terraria`: `"Puerto 5000 (mod)\n✅ Entidades  ✅ Items  ✅ Comandos"`.
- `minecraft`: `"RCON puerto 25575\n✅ Todo via comandos RCON"`.
- Custom: `"Puerto <port>\n✅ <Cat1>  ✅ <Cat2>"`.

Y llama `_update_category_tabs(categories)` para reconstruir las pestañas
dinámicas.

### 6.3 `test_connection()`
Status `"🔄 Probando..."` color ACCENT. Lanza `ConnectionWorker(game)` (en
`gui/controllers/connection.py` — auditar en G0.5).
Callback `_on_main_connection_result(ok, msg)`:
- `game_status` con color verde claro o rojo.
- Cachea `_last_game_status` para `_update_health_status`.
- Update `health_widget`.

### 6.4 `config_game()` — abre CustomGameDialog para editar el juego activo
- Construye config base según el juego activo (defaults para predefinidos).
- Para juegos predefinidos: `dlg.game_id.setEnabled(False)`.
- Al aceptar:
  - Update `g.host`, `g.port`, `g.connection_type`, `g.password` (si aplica).
  - Para custom: actualiza también todos los endpoints/payloads/rcon_cmds.
  - Persiste en `config.game_configs[gid]`.
  - Si era custom: actualiza también `custom_games_config`.
  - Crea folders de imágenes para las nuevas categorías
    (`ensure_game_folders(DATA_DIR, gid, cat_keys)`).
  - `QTimer.singleShot(100, _update_category_tabs)` y
    `QTimer.singleShot(200, refresh_all)`.
  - `test_connection()` automático.

### 6.5 `manage_custom_games()`
Abre `ManageGamesDialog`. Diff entre old y new:
- Añadidos: instanciar `CustomGame`, agregar a `GAME_FEATURES` y al combo.
- Actualizados: re-instanciar + actualizar texto del combo.
- Eliminados: remover del combo, del dict `games`, de `GAME_FEATURES`.
- Sync `rule_engine.custom_games_config`.
- Si el juego activo fue modificado: `update_game_ui` + `refresh_all`.

---

## 7. Spotify

### 7.1 `_init_spotify()`
- Solo si `config.spotify.enabled and client_id`.
- `SpotifyClient(cache_path=DATA_DIR/.spotify_cache, log=...)`.
- Configure: `client_id, client_secret, device_id, max_queue (default 5),
  priority_users`.
- Set `enabled=True` y bind a `social.spotify`.
- `social.spotify_tts = config.spotify.tts_enabled` (default True).
- `playfan_uses` cargado desde `priority_users_data`.
- `enabled_commands` (default `{play, skip, cola, pause, playfan}`).
- **Auto-conectar en thread daemon** con `try_auto_connect()` (no abre
  navegador si hay token cacheado).
- `_spotify_timer` cada **30s** → `_spotify_check_playback`.
- Si falla import de `spotipy`: log warning y `social.spotify = None`.

### 7.2 `_spotify_check_playback()`
- Skip si rate-limited.
- Skip si no hay queue/current_track/_context_needs_restore.
- Lanza `sp.check_and_advance()` en thread daemon.

---

## 8. Sistema social

### 8.1 `_on_social_enabled_change(state)`
`social.set_config(enabled=bool(state))` + persist `config.social_enabled` +
`save_config`.

### 8.2 `_open_social_config()`
Abre `SocialConfigDialog(self, social, TTSEngine.VOICES)`. Al aceptar,
sincroniza el checkbox del sidebar.

### 8.3 `_process_auto_rachas()` (cada hora)
`social.process_auto_rachas()` → log con count si hay resultados.

### 8.4 `_cleanup_taps_auto()` (cada 6h)
`social.cleanup_inactive_taps()` + `cleanup_old_history()`.

### 8.5 Callback streak → overlay
```python
def _on_racha_marked(user_norm, days):
    self.overlay_client.send_event("streak", {"user": user_norm, "days": int(days)})
self.social.streak_overlay_callback = _on_racha_marked
```

---

## 9. Minijuegos

### 9.1 `_open_minigames()`
Abre `MinigamesDialog`. Conecta 3 signals → 3 handlers:
- `game_started → _on_minigame_started` → `WordSearchWindow(game)` 470x800.
- `bomb_started → _on_bomb_started` → `WordBombWindow(game)` 470x800.
- `lite_started → _on_lite_started` → `WordSearchLiteWindow(game)`.

### 9.2 `_process_minigame_command(user, text)` — handler de chat
- Para `WordSearchGame`:
  - `!game`: si no registrado y `social.require_register=True`, log y skip.
    Si registrado: `add_player(user)` → `on_player_joined`.
  - Coordenadas tipo `"A1 B2"`: validar formato (2–3 chars, alfanumérico),
    `process_input` → `on_line_result`. Si `hit` y `finished`: log ranking.
- Para `WordBombGame`:
  - `!game` (antes de start): `add_player(user, avatar=pick_avatar())` →
    `on_player_joined`.
  - Mientras activo: si es turno del usuario y no empieza con `!`,
    `submit_word` → `on_word_result` o `on_word_rejected`.
  - Si `bonus_life`: log "completó el abecedario — vida extra".

### 9.3 `_on_minigame_closed()`
Reset del juego activo (si existe), close window, log.

---

## 10. TikTok API check (`_check_tiktok_api`)

`core.version_checker.check_update()` → diálogo con:
- Estado `not_installed`: warning con instrucción de pip.
- Estado `check_failed`: warning con error.
- Si hay update disponible:
  - Modal con 3 botones: `Actualizar a <latest>`, `Reinstalar v6.6.5 (segura)`,
    `Cancelar`.
  - `update_tiktok_live(version)` → log + info modal pidiendo reinicio.

`KNOWN_GOOD_VERSIONS` se importa pero no se usa en este flujo (probablemente
en `version_checker`).

---

## 11. Log y stats

### 11.1 `log(msg, category=None)`
Delega a `log_text.log(msg, category)`. Defensivo (chequea `hasattr`).

### 11.2 `_clear_log()`, `_export_log()`, `_reset_stats()`

- Clear: `log_text.clear()`, reset internal `_log_count`, `_all_messages`.
- Export: QFileDialog → guarda con timestamp en nombre.
- Reset stats: `log_text.reset_stats()` + `_update_stats_display`.

### 11.3 `_on_log_filter_change` con debounce 100ms
Re-aplica `set_filters(active_keys)` después de 100ms.

### 11.4 `_update_health_status` (cada 30s) — **LIGERO, sin red**
- TikTok: solo lee estado cacheado (`tiktok_connected`).
- Game: solo `_last_game_status` (no relanza test_connection).
- TTS: chequea cualquier canal habilitado (`enabled_chat | enabled_social |
  enabled_fortune`) + `audio_ok`.

---

## 12. Construcción de widgets de regla (`_build_rule_widget`)

Layout horizontal 60px alto, contentsMargins (6,4,10,4).

**Imagen del trigger** (52x52):
- Si `trigger_type=="gift"` y hay `icon_path` en `gift_data`: usar PNG.
  Fallback: `data/donaciones/Rose_black_white.png`.
- Si no es gift: usar `_trigger_icon_paths[trigger_type]` (los 7 iconos
  PNG de `data/icons_triggers/`).

**Imagen de la acción** (52x52):
- Resuelta por `_get_rule_action_icon(rule)` que mapea `action_type` a
  categoría y busca el PNG correspondiente con `_get_entity_icon` (mixin Images).
- Fallback: `get_default_for_category(DATA_DIR, current_game, category)`.

**Mapeo trigger → texto** (`_get_trigger_text`):
- `gift` → `🎁 <name|trigger_value>`
- `like` → `❤️ cada <N> likes`
- `like_milestone` → `🎯 <N> likes`
- `follow` → `➕ Seguidor`
- `share` → `📤 Compartir`
- `subscribe` → `⭐ Super Fan`
- `command` → `💬 <comando>`

**Mapeo acciones → texto** (`_get_actions_text`):
- N>1 acciones → `⚡ <N> acciones`
- 1 acción → `<value>` + `x<amount>` si amount>1.
- Sin actions modernas → fallback a campos legacy `action_value`/`amount`.

---

## 13. Cierre limpio (`closeEvent`)

1. `save_config()` defensivo.
2. **Detener TODOS los timers** (uno a uno, defensivo):
   - `_batch_timer`, `_timer`, `_auto_test_timer`, `_activity_timer`,
   - `_stats_timer`, `_autosave_timer`, `_health_timer`,
   - `_filter_debounce_timer`, `_auto_racha_timer`, `_taps_cleanup_timer`,
   - `_spotify_timer`.
3. Limpiar cachés: `rule_validator.clear_cache()`, `_profiles_cache`.
4. `_sound_worker_running = False`.
5. `tts.stop()`.
6. `tiktok_worker.stop()`.
7. Cerrar `_overlays_manager` y `deleteLater()` (libera QWebEngineView).

---

## 14. Mapa de métodos por ubicación

### En `main_window.py` (este archivo):

| Línea | Método |
|------:|--------|
| 91–108 | `current_theme` (property + setter loggeable) |
| 110–301 | `__init__` |
| 303–327 | `_warmup_overlays_manager` |
| 329–344 | `load_profile_voices` |
| 346–353 | `save_profile_sounds` / `save_profile_voices` |
| 355–365 | `load_custom_games` |
| 367–425 | `load_config` / `save_config` |
| 427–437 | `setup_ui` |
| 439–886 | `_build_left_panel` |
| 888–972 | `_build_center_panel` |
| 974–1141 | `_build_right_panel` |
| 1143–1163 | `_setup_post_ui` |
| 1165–1184 | `_setup_shortcuts` |
| 1186–1201 | `_show_shortcuts_help` |
| 1204–1244 | `update_game_ui` |
| 1246–1313 | `log` + log/filter helpers |
| 1315–1324 | `_update_stats_display` |
| 1326–1362 | `refresh_all` + `refresh_dynamic_categories` + `_load_category_data_from_file` |
| 1365–1374 | `_find_gift_data` |
| 1376–1466 | `_build_rule_widget` |
| 1468–1539 | `_get_rule_action_icon` / `_get_trigger_text` / `_get_actions_text` |
| 1541–1560 | `_quick_change_gift` |
| 1561–1643 | `_quick_change_entity` |
| 1647–1701 | `refresh_rules` / `_filter_rules` / `refresh_entities/items/events` |
| 1703–1719 | `on_game_change` |
| 1721–1797 | `toggle_tiktok` / `on_connected` / `on_disconnected` / `on_stats_updated` / `on_error` |
| 1800–1856 | `on_api_error` |
| 1858–1908 | `on_event` |
| 1910–1946 | `_update_activity` / `_dim_activity` / `_pulse_activity` |
| 1949–1961 | `apply_theme` / `on_theme_change` |
| 1964–1973 | `_process_auto_rachas` |
| 1975–2046 | `_init_spotify` / `_spotify_check_playback` |
| 2048–2056 | `_cleanup_taps_auto` |
| 2058–2070 | `_on_social_enabled_change` / `_open_social_config` |
| 2072–2123 | `_open_minigames` + handlers + `_wm_exec` |
| 2125–2197 | `_process_minigame_command` |
| 2200–2316 | `manage_gifts` / `manage_sounds` / `manage_overlays` / `manage_custom_games` |
| 2318–2497 | `test_connection` / `_on_main_connection_result` / `config_game` |
| 2499–2814 | `add_rule` / `edit_rule` / `duplicate_rule` / `export_rules` / `import_rules` / `validate_all_rules` |
| 2816–2840 | `_on_rules_reordered` / `_autosave` |
| 2842–2911 | `open_backup_manager` / `_check_tiktok_api` |
| 2913–2941 | `_update_health_status` |
| 2944–3077 | `del_rule` / `toggle_rule` / `test_selected_rule` |
| 3079–3104 | `_get_game_display_info` |
| 3106–3199 | `manage_entities` / `manage_items` / `manage_events` |
| 3201–3277 | `test_selected_entity/item/event` + `_test_selected_from_list` |
| 3283–3343 | `closeEvent` |

### Métodos referenciados pero definidos en mixins (auditar en G0.5):

| Método | Mixin |
|--------|-------|
| `_play_event_sound` | `gui/views/audio.py` |
| `_load_fortune_gifts`, `_test_fortune`, `_check_fortune_trigger`, `_on_fortune_volume_change` | `gui/views/audio.py` |
| `_social_speak`, `_social_log`, `_social_duel_speak`, `_social_fortune_speak` | `gui/views/audio.py` |
| `on_tts_toggle`, `on_voice_change`, `_on_volume_change`, `_on_voice_type_changed`, `test_tts`, `manage_voices` | `gui/views/audio.py` |
| `_resolve_gift_images`, `_save_gifts_only`, `_on_gift_image_detected` | `gui/views/images.py` |
| `_init_game_image_folders`, `_get_entity_icon` | `gui/views/images.py` |
| `_init_simulator_vars`, `on_sim_event_change`, `open_simulator_dialog` | `gui/views/simulator.py` |
| `open_profiles_dialog` | `gui/views/stream_profiles.py` |
| `_create_default_category_tabs`, `_update_category_tabs`, `_refresh_category_list` | `gui/views/category_tabs.py` |
| `_execute_custom_game_action` | `gui/views/category_tabs.py` o algún otro mixin (verificar) |

---

## 15. Signals/slots de Qt usados

### Signals propias (definidas en TikTokWorker / ConnectionWorker / minigames):
- `tiktok_worker.connected(str)` → `on_connected`
- `tiktok_worker.disconnected()` → `on_disconnected`
- `tiktok_worker.event_received(str, dict)` → `on_event`
- `tiktok_worker.log_message(str)` → `log`
- `tiktok_worker.error(str)` → `on_error`
- `tiktok_worker.api_error(str)` → `on_api_error`
- `tiktok_worker.stats_updated(dict)` → `on_stats_updated`
- `tiktok_worker.gift_image_detected(str, str)` → `_on_gift_image_detected`
- `_conn_worker.finished(bool, str)` → `_on_main_connection_result`
- `_minigame_window.closed` → `_on_minigame_closed`

### Slots de Qt usados:
- `QShortcut.activated`, `QListWidget.itemDoubleClicked`,
  `QListWidget.model().rowsMoved`, `QSlider.valueChanged`,
  `QComboBox.currentIndexChanged`, `QCheckBox.stateChanged`,
  `QPushButton.clicked`.

---

## 16. Constantes / dependencias externas referenciadas

- `gui.constants.BASE_DIR`, `BUNDLE_DIR`, `DATA_DIR`, `GIFTS`, `GAME_FEATURES`.
- `gui.constants.ACCENT`, `ACCENT_RED`, `ACCENT_RED_DARK`, `ACCENT_GREEN`,
  `ACCENT_GREEN_LIGHT`, `ACCENT_BLUE`, `BTN_RADIUS`, `BTN_RADIUS_SM`,
  `CARD_BG_HOVER`, `CARD_BORDER`, `CARD_SELECTED_BG`, `PANEL_BG`,
  `CURRENT_STYLE`.
- `gui.themes.THEMES`, `get_theme_style`, `get_theme_names`,
  `DEFAULT_THEME = "midnight"`.
- `core.config_store.load_config`, `save_config`, `migrate_from_monolithic`.
- `core.tts_engine.TTSEngine` (con sus 74 voces en `VOICES`).
- `core.tiktok_client.TikTokWorker`.
- `core.rule_engine.RuleEngine`, `Rule`, `get_display_name`, `get_command`.
- `core.games.ValheimGame`, `TerrariaGame`, `MinecraftGame`, `CustomGame`.
- `core.ia_engine.IAEngine`.
- `core.social_system.SocialSystem`.
- `core.spotify_client.SpotifyClient`.
- `core.overlays.OverlayClient`.
- `core.version_checker.check_update`, `update_tiktok_live`,
  `KNOWN_GOOD_VERSIONS`.

---

## 17. Hallazgos importantes para el port

1. **Ventana principal NO tiene tabs por sección** (Conexión / Reglas /
   Datos / etc). El layout es **3 columnas**: sidebar | tabs (reglas +
   categorías por juego) | log.
2. **Sidebar tiene 7 GroupBoxes** verticales: Logo, TikTok Live, Perfil
   de Juego, Texto a Voz, Fortuna, Sistema Social, Configuración.
3. **TTS está expuesto en sidebar** (volumen, voz, prueba), pero la
   gestión de voces personalizadas se abre en un diálogo (`voices_dialog`).
   La regla "TTS no es pestaña" SE CUMPLE — está integrado al sidebar
   como sección, no como tab top-level. Para el port: replicar EXACTO,
   no inventar página dedicada.
4. **Fortuna es su propia sección visible en sidebar** (no en TTS) —
   tiene gift trigger, voz dedicada, volumen, botón de prueba.
5. **Sistema Social en sidebar** es solo un toggle + 2 botones (Configurar /
   Minijuegos). La configuración real vive en `SocialConfigDialog`
   (2464 líneas — el segundo archivo más grande del proyecto).
6. **Reglas con multi-action son obligatorias** y el código tiene
   compatibilidad retro con `action_type/action_value/amount/commands`
   simples (legacy). El port debe soportar ambos formatos al cargar JSON
   pero solo escribir el moderno.
7. **`random_action`** se referencia en `Rule` pero no aparece en este
   archivo — está implementado en `RuleEngine.process_event` y/o en
   `RuleDialog`. Verificar en G0.4 / G0.6.
8. **Los 7 trigger types** confirmados en `_get_trigger_text`:
   `gift, like, like_milestone, follow, share, subscribe, command`.
9. **Los 4 action types**: `entity/spawn`, `item/give_item`,
   `event/trigger_event`, `valuable/spawn_valuable`.
10. **El log tiene 8 categorías** explícitas con filtros visuales:
    `comments, gifts, social, rules, spotify, tts, system, errors`.
11. **El sidebar es scrollable** — en alto puede crecer más que la pantalla.
    El port debe soportar overflow vertical en el sidebar.
12. **Drag&drop de reglas** en la lista para reordenar — preservar.
13. **Auto-save cada 5 minutos**, **rachas auto cada 1 hora**, **taps
    cleanup cada 6 horas**, **Spotify check cada 30 segundos**, **stats
    update cada 1 segundo**, **health update cada 30 segundos**, **filter
    debounce 100 ms**, **activity pulse cada 5 segundos**.
14. **Atajos de teclado**: `Ctrl+S`, `F5`, `Ctrl+T`, `Ctrl+Shift+S`,
    `Ctrl+R`, `Ctrl+L`, `F1`. Todos hay que portarlos.
15. **Notification toasts** — `success/info/warning/error` con duración
    custom. Reemplazar por toast lib en React (sonner/react-hot-toast).
16. **Selector de regalo y de entidad** son galerías visuales con tabs
    multi-categoría — críticos para reglas. Auditar diálogos en G0.4.
17. **OverlayClient envía 9 tipos de evento** mínimos: `gift, follow,
    share, like, comment, subscribe, command, streak, reset` (los 7 de
    TikTok + streak + reset).
18. **Los 7 iconos de trigger** (`data/icons_triggers/`) los descarga/
    asegura `ensure_trigger_icons` automáticamente al boot.
19. **Pre-warmup de OverlaysManager** detrás del splash — patrón a
    replicar en Electron pre-cargando los iframes de overlays antes del
    showMain.
20. **Tema "midnight" es el default**. La memoria de "borrar Aurora y
    Cyberpunk" se confirma — `THEMES` actualmente tiene los temas
    inventados y otros más, hay que reducirlo a solo `midnight` en G1.

---

## 18. Pendientes de auditar (G0.4-G0.6)

Para cerrar la imagen completa que arranca desde main_window.py necesito:

- **`gui/views/audio.py`** (425 líneas) — TODO el flujo de fortuna, sonidos
  por evento, callbacks sociales.
- **`gui/views/images.py`** (298 líneas) — descarga automática de imágenes
  de regalos, mapeo entity→PNG.
- **`gui/views/simulator.py`** (263 líneas) — simulador inline + diálogo.
- **`gui/views/stream_profiles.py`** (669 líneas) — guardar/cargar perfiles
  completos.
- **`gui/views/category_tabs.py`** (450 líneas) — pestañas dinámicas por
  categoría + ejecución de acciones custom.
- **Los 16 diálogos** (líneas totales ≈ 9.500) — donde vive la mayoría
  de la UI compleja.
- **`gui/widgets/log_widget.py`** (362 líneas) — `EnhancedLogWidget` con
  categorías, filtros, stats.

Todos quedan asignados en G0.4 y G0.5.
