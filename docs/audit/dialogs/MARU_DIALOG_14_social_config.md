# Diálogo 14 — `social_config.py` · SocialConfigDialog (2464 líneas)

> **El segundo más grande del proyecto**. Configuración completa del
> sistema social: 6 tabs (General · Comandos · Usuarios · Taps Globales ·
> Estadísticas · Spotify · IA).

## Constructor

```python
SocialConfigDialog(parent, social_system, tts_voices: dict)
```

- `social` = `SocialSystem` del MainWindow.
- `tts_voices` = `TTSEngine.VOICES` (74).
- Tamaño: minSize 1050x750, resize 1100x800.
- Stylesheet: `gui_constants.CURRENT_STYLE + SOCIAL_STYLE` (un QSS extra
  con tabs frosted glass, tablas modernas, scrollbar 8px).
- Signals para Spotify thread-safety:
  - `_spotify_auth_signal(bool, str)` — autenticación finalizada.
  - `_spotify_ui_data_signal(dict)` — now playing + queue.
  - `_spotify_devices_signal(list)` — devices disponibles.
  - `_spotify_account_signal(dict)` — info cuenta post-auth.
- TabBar con `setUsesScrollButtons(False)` y `setExpanding(True)`.
- Footer fijo con botón verde gradient `💾 Guardar Configuración` +
  botón `Cerrar`.

## TAB 1 · `⚙️ General`

### Activación
- `enabled_check` (QCheckBox) — `Sistema Social ACTIVO` (bold 14px).
- `require_register_check` — `📝 Requerir !register antes de usar comandos`.

### Tiempos (FormLayout)
- `cooldown_spin` (QSpinBox 1–300, suffix `" segundos"`).
- `timeout_spin` (QSpinBox 10–600, suffix `" segundos"`).

### Audio
- `volume_slider` (0–100) horizontal con label `%` (live update).
- `voice_combo`:
  - 1ra opción: `🎙️ Voz por defecto del sistema` con data `""`.
  - Las 74 voces TTS.
  - Botón `🔈 Probar` → `_test_voice` que llama
    `parent_win.tts.speak_social("¡Esta es una prueba del sistema social!", voice, vol)`
    (canal **social**, distinto del chat).

## TAB 2 · `📜 Comandos`

- Header info gris en card.
- Grid de checkboxes agrupados por categoría (de `social.CATEGORIES`).
  Cada categoría tiene icono, nombre, y N comandos (`!cmd`).
  Display: `<icon> !<cmd>` con tooltip = descripción.
- Estructura de UI: 4 columnas por fila, header de categoría ocupa todo
  el ancho (`addWidget(label, row, 0, 1, 4)`).
- Botones de acción: `✅ Seleccionar Todos` y `❌ Deseleccionar Todos`.

> Los comandos vienen de `social.get_commands_by_category()` —
> auditar `core/social_system.py` para la lista exacta.

## TAB 3 · `👥 Usuarios`

### Búsqueda
- `user_search` (QLineEdit) — placeholder `Buscar usuario...`. Debounce
  via `_filter_users(text)`.
- Botón `🔄` para refresh.

### Tabla `users_table` (9 columnas, edit en celdas)
- Cols: `Usuario | Reg | Racha | Récord | Casado/a | Novio/a |
  Mejor Amigo | Rival | Victorias`.
- Col 0 (Usuario): no editable.
- Col 1 (Reg): no editable, muestra `✅` o `❌`.
- Col 2 (Racha): **EDITABLE** — escribir número actualiza
  `social.admin_set_racha(username, dias)`. Si tiene racha automática,
  display `⚡<dias> (<restantes>)`. Edición acepta el formato y limpia.
- Col 3 (Récord): no editable.
- Cols 4-7 (Casado, Novio, Mejor Amigo, Rival): editables.
  Si escribís `-`, vacío, `ninguno`, `none` → llama a
  `admin_remove_marriage` o `admin_remove_relationship(username, "novios"|"amigo"|"rival")`.
- Col 8 (Victorias): no editable (`duelos_ganados`).

`_is_populating` flag para no triggerear `cellChanged` durante la carga
masiva.

### Detalles del usuario seleccionado
- `user_details_label` (HTML) muestra:
  - `👤 <username>`.
  - `✅ Registrado hace X días` o `❌ No registrado`.
  - `🔥 Racha: <dias> días | Récord: <record> días`.
  - Si tiene racha automática activa: `⚡ Racha Automática: Activa
    (<restantes>/<totales> días restantes)`.
  - `💍 Casado con / 💕 Novio/a de / 🤝 Mejor Amigo / 😤 Rival`
    con días desde.
  - `📊 Duelos: ⚔️ Ganados: X | Perdidos: Y`.

### Acciones sobre usuario (botones)
- `📝 Registrar` / `🚫 Des-registrar`.
- `🔥 Reset Racha`.
- `💔 Reset Relaciones`.
- `⚡ Racha Automática` (gradient naranja) → abre subdiálogo:
  - Selector días 1–365 (default 7).
  - Botón `✅ Activar` → `social.admin_activate_auto_racha(username, dias)`.
  - Si ya está activa: botón `❌ Desactivar` → `admin_deactivate_auto_racha`.
  - Botón `Cerrar`.
- `🗑️ Eliminar` (gradient rojo) — `admin_delete_user`.

### Agregar usuario manualmente
- `add_user_input` + botón `Registrar Manualmente` →
  `social.admin_register_user(username)`.

## TAB · `❤️ Taps Globales`

- `taps_period` (QComboBox) con 3 opciones:
  - `🌐 Total (Siempre)` → `"total"`.
  - `📅 Semanal (7 días)` → `"semanal"`.
  - `📆 Mensual (30 días)` → `"mensual"`.
- Botón `🔄 Actualizar`.
- `taps_stats_label` (HTML) — banner con gradient rojo→amarillo:
  - `❤️ <total_taps> taps totales | 👥 <total_users> usuarios | 📊 Mostrando: <periodo>`.
- `taps_table` (4 cols): `# | Usuario | Taps | Última actividad`.
  - Top 3 usan medallas `🥇 🥈 🥉` y color (oro/plata/bronce).
- Botón `🧹 Limpiar inactivos (>7 días, excepto top 3)` → confirma y
  llama `social.cleanup_inactive_taps()`.

## TAB 4 · `📊 Estadísticas`

`stats_label` (HTML) muestra:
- `Total usuarios`, `Usuarios registrados`.
- `Total duelos`, `Total interacciones`.
- `Matrimonios totales` (activos), `Divorcios`, `Noviazgos activos`,
  `Amistades activas`, `Rivalidades activas`.
- Si hay top racha: `🏆 Mayor racha: <user> con <dias> días`.

Botón `🔄 Actualizar Estadísticas`.

### Zona de Peligro (group con border rojo)
- `🗑️ ELIMINAR TODOS LOS DATOS` con doble confirm:
  - 1ra: lista todo lo que se va a borrar.
  - 2da: pide escribir `DELETE`.
  - Si Yes en ambos → `social.admin_reset_all()`.

## TAB 5 · `🎵 Spotify`

### Conexión
- `spotify_enabled_check` — `Integración Spotify ACTIVA`.

### Cuentas Guardadas (frame con border verde Spotify `#1DB954`)
- `spotify_account_combo` con primera opción `➕ Nueva cuenta...`.
- Botones:
  - `📂 Cargar` → `_spotify_load_account` (desconecta la actual,
    carga credenciales de la cuenta seleccionada).
  - `💾 Guardar` → `_spotify_save_account` (guarda credenciales
    actuales como cuenta nombrada).
  - `🗑️` → `_spotify_delete_account`.
- Hint: *"Guarda varias cuentas y cambia rápidamente entre ellas"*.

### Credenciales (FormLayout)
- `spotify_client_id` (QLineEdit, `EchoMode.Password`).
- `spotify_client_secret` (QLineEdit, `EchoMode.Password`).

### Botones conexión
- `🔌 Conectar Spotify` (gradient verde Spotify, padding 10px 20px)
  → `_spotify_connect`.
- `❌ Desconectar` → `_spotify_disconnect`.
- `spotify_status_label`: `⚪ No conectado` / `⏳ Rate limit — espera ...` /
  `🟢 Conectado como <name>`.

### Guía de configuración
- Banner con `Redirect URI: http://127.0.0.1:8888/callback` (read-only,
  copiable con botón `📋 Copiar`).
- Botón colapsable `▶ Ver pasos para configurar una nueva cuenta`:
  - 10 pasos en HTML (Dashboard → Create App → Web API → Settings →
    Client ID / Secret → User Management → INVALID_CLIENT troubleshooting).
  - Click toggle a `▼ Ocultar pasos`.

### Dispositivo de Reproducción
- `spotify_device_combo` — primera opción `🔊 Automático (dispositivo activo)` (data `""`).
- Botón `🔄 Actualizar` → `_spotify_refresh_devices`.

### Configuración de Cola
- `spotify_max_queue_spin` (QSpinBox 1–50, suffix `" canciones"`, default 5).

### Voz del Bot para Música
- `spotify_tts_check` — `Activar lectura de comandos de música`.
- Hint: *"Si activado: bot lee en voz alta. Si no: comandos en silencio"*.

### Comandos de Música (5 checkboxes)
- `play`, `skip`, `cola`, `pause`, `playfan`.
- Cada uno con descripción larga inline.

### Usuarios Prioritarios & PlayFan
- `spotify_prio_table` (3 cols): `Usuario | Usos !playfan / día | <quitar>`.
- Datos desde `priority_users_data` (formato moderno) con backward compat
  a `priority_users` simple (default 2 usos).
- Inputs para agregar:
  - `spotify_prio_name_input` (placeholder `Nombre de usuario...`).
  - `spotify_prio_uses_spin` (QSpinBox 1–50, default 2, suffix `" usos/día"`).
  - Botón `➕ Agregar` (gradient verde).

### Ahora Suena
- `spotify_now_playing_label` (banner con gradient verde Spotify):
  - Sin reproducción: `🎵 Sin reproducción activa`.
  - Reproduciendo: `🎵 <name> — <artist>` + `⏱️ <progress>/<duration>` +
    `| Pedida por: <user>`.
  - Pausado: añade `(Pausado)` y cambia icono a `⏸️`.

### Cola de Reproducción
- `spotify_queue_table` (4 cols): `# | Canción | Pedida por | <quitar>`.
- Items prioritarios marcados con `⭐`.
- Botones: `🔄 Actualizar Cola` / `🗑️ Vaciar Cola`.
- Cada fila tiene botón `❌` para quitar de la cola.

### Timer y threading
- `_spotify_ui_timer` (cada **45s** — conservador para dev mode).
- `_spotify_ui_fetching` flag para evitar threads duplicados.
- `_spotify_request_ui_update` lanza thread daemon que llama:
  `sp.get_now_playing()`, `sp.current_track`, `sp.get_queue_list()`,
  `sp.account_name`. Emite `_spotify_ui_data_signal` (Qt thread-safe).
- Si `sp._is_rate_limited()` → no hace API calls, muestra banner con
  display de rate limit.

### Auto-cleanup en `done(result)`
- Detiene `_spotify_ui_timer` antes de cerrar para no consumir API.

## TAB 7 · `🤖 IA`

### Activación
- `ia_enabled_check` — `Activar comando !ia`.
- Help HTML: explica los 4 proveedores (Gemini gratis / Groq gratis /
  OpenAI / Claude).

### Configuración API
- `ia_provider_combo` con **4 proveedores**:
  - `🟣 Claude/Anthropic (Recomendado)` → `"claude"`.
  - `⚡ Groq (Gratis)` → `"groq"`.
  - `🟢 Google Gemini (Gratis)` → `"gemini"`.
  - `🔵 OpenAI (De pago)` → `"openai"`.
- `_ia_api_keys` dict — guarda **una key por proveedor** (cambiar de
  proveedor preserva la key del anterior).
- `ia_api_key_input` (QLineEdit, `EchoMode.Password`).
- `ia_api_help` (label HTML con link external — distintos textos por
  proveedor con URL del dashboard).
- `ia_model_combo` carga `IAEngine.MODELS[provider]` — lista de
  `(model_id, display_name)` por proveedor.
- `ia_model_info` (label) — descripción corta del proveedor.

### Configuración de Respuestas
- `ia_max_length_spin` (QSpinBox 100–800, default 400, suffix `" caracteres"`).
- `ia_cooldown_spin` (QSpinBox 3–120, default 10, suffix `" segundos"`).
- `ia_prompt_edit` (QTextEdit max 80px) — system prompt custom.
  Default: `"Eres un asistente inteligente y divertido en un stream de
  TikTok Live. Responde preguntas de forma clara, informativa y
  entretenida en español. Da respuestas útiles y completas pero concisas
  (3-4 oraciones máximo). Si te preguntan algo factual, responde con
  datos reales y correctos. Sé amigable y natural."`.

### Botón `🧪 Probar IA` (gradient morado)
- `_ia_test()`: `_ia_apply_config()` para sincronizar engine, luego
  `social.ia_engine.ask("TestUser", question)` en thread daemon.
- Resultado via `QMetaObject.invokeMethod` (`_ia_show_test_result`).
- `_ia_show_test_result(result)` (slot `@pyqtSlot(str)`) muestra el
  resultado con QMessageBox.

## Save (`_save_config()`)

Aplica:
1. `social.set_config(enabled, require_register, cooldown, timeout,
   volume, voice, enabled_commands)`.
2. Update `parent_win.config["social_*"]` (6 claves).
3. `_spotify_save_config_only()` que guarda toda la sección spotify
   (enabled, client_id, client_secret, device_id, max_queue,
   priority_users + priority_users_data, tts_enabled, enabled_commands).
4. `_ia_save_config()` que guarda `ia` con todas sus claves
   (`ia_enabled, ia_provider, ia_api_key, ia_api_keys, ia_model,
   ia_max_length, ia_cooldown, ia_system_prompt`).
5. Si `social.spotify` existe: aplica `device_id`, `max_queue`,
   `priority_users`, `playfan_uses`, `enabled`, `enabled_commands`.
6. `parent_win.save_config()` y `accept()`.

## Notas para el port

- **TTS canal SOCIAL** es independiente del chat — clave para no mezclar.
- **Edit-en-celda** de la tabla de usuarios: en React equivale a inputs
  inline en cada fila editable. Mantener exactamente las columnas que
  son editables.
- **Tabs** del original son **6 visibles** (en realidad 7 con IA): cada
  tab podría ser un ruta o pestaña en React.
- El **subdiálogo de Auto-Racha** es un modal pequeño aparte (250x400).
- **Spotify dev mode rate limits**: el patrón "fetch en thread + emit por
  signal" es crítico para no bloquear UI. En Electron equivalente:
  función async en main process + IPC al renderer.
- **`_ia_api_keys`** preserva keys por proveedor — replicar.
