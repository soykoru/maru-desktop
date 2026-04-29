# MARU Original — gui/views/ (5 mixins, 2129 líneas)

> Cada mixin agrupa métodos cohesivos extraídos del MainWindow original.
> Los mixins NO definen `__init__` — asumen que MainWindow ya inicializó
> los atributos requeridos.

---

## Mixin 1 · `AudioMixin` (425 líneas) · `audio.py`

> Sistema de sonidos + TTS + fortunas + audio social.

### Atributos requeridos en MainWindow
- `tts (TTSEngine)`, `sounds (dict)`, `sound_volume (int 0-100)`,
  `config (dict)`, `custom_gifts (dict)`.
- Widgets: `tiktok_user, fortune_voice, fortune_volume, fortune_enabled,
  fortune_gift, voices_global_radio, voices_profile_radio, voice_sel,
  tts_test_input, vol_label, fortune_vol_label, notification`.

### Métodos clave

#### Sistema de sonidos (pygame con cola)

```python
_init_sound_system()       # Inicializa pygame.mixer (44100 Hz, 32 canales, buffer 256)
_play_event_sound(etype, data)  # Resuelve el path según evento (gift, follow, share, subscribe)
_queue_sound(path)         # Añade a deque(maxlen=100), thread-safe con _sound_lock
_start_sound_worker()      # Lanza thread daemon que procesa la cola UNO POR UNO
_play_sound_and_wait(path) # Play + cache + sleep(duration + 0.05) para evitar overlap
```

**Patrón clave**: cola con worker thread daemon que reproduce sonidos
secuencialmente. Cada sonido espera al anterior + 50ms gap.

**Caché LRU**: max 50 sonidos. Cuando se llena, elimina la mitad más antigua.

**Resolución de path por etype**:
- `gift` → busca en `sounds["gifts"]` matching `gift_name` lowercase.
- `follow` → `sounds["follow"]`.
- `share` → `sounds["share"]`.
- `subscribe / member` → `sounds["superfan"]`.

#### TTS

```python
on_tts_toggle(s)           # Toggle enabled_chat + enabled
on_voice_change(idx)       # Setea tts.default_voice del combo
_on_volume_change(value)   # Actualiza vol_label + tts.volume
_on_fortune_volume_change(value)  # Solo label de fortuna (no toca tts.volume)
test_tts()                 # tts.speak_now(texto, voice)
manage_voices()            # Abre VoicesDialog y guarda en perfil o globales
```

#### Voces globales vs perfil
```python
_on_voice_type_changed(checked)
```
- Si `voices_global_radio` activo: usa `config["global_voices"]`.
- Si `voices_profile_radio` activo: usa `profile_voices[current_game]`.
- Persiste `config["use_global_voices"]` y log el cambio.

#### Callbacks sociales

```python
_social_speak(text, volume)        # Canal social, voz config["social_voice"]
_social_duel_speak(text, volume)   # Canal social con boost
_social_fortune_speak(text, volume) # Canal fortuna exclusivo
_social_log(text)                  # log(text, LogCategory.SOCIAL)
```

> **3 canales TTS independientes**: chat / social / fortune. Pueden
> sonar simultáneamente.

#### Sistema de fortuna

```python
_load_fortunes() → dict             # Cachea data/fortunes.json (clase, no instancia)
_load_fortune_gifts()               # Pobla combo con custom_gifts ordenados por coins
_get_random_fortune() → str         # Random uniforme entre 17 categorías
_get_fortune_intro(name) → str      # Random template con name
_clean_name_for_tts(username)       # Solo letras (regex)
_speak_fortune(username)            # Genera intro + fortune + tts.speak_fortune
_test_fortune()                     # Prueba con username del streamer
_check_fortune_trigger(gift_id, username)  # Match exacto normalizado contra el gift configurado
```

### Categorías de fortuna (17)
```python
["good", "bad", "neutral", "specific", "philosophical",
 "love", "money", "health", "work", "gaming",
 "social", "creative", "mystery", "humor",
 "stream", "luck", "wisdom"]
```

Random UNIFORME → todos los mensajes tienen la misma probabilidad
(no hay categorías "más probables" que otras).

### Match de fortune trigger
1. Normaliza ambos: `lower().strip()`, `_-` → `space`, double-spaces → single.
2. Compara `gift_norm == config_norm` (exact match).
3. Si no coincide: busca el `configured_gift` en `custom_gifts`,
   normaliza su `name` y compara contra `gift_norm`.

---

## Mixin 2 · `ImagesMixin` (298 líneas) · `images.py`

> Iconos de entidades + auto-descarga de imágenes de regalos TikTok.

### Atributos requeridos
- `custom_gifts, _pending_gift_downloads (set), _gifts_need_save,
  entity_images, config, custom_games_config, _image_index, _icon_path_cache,
  _unsaved_changes`.

### Métodos clave

#### Resolución inicial de PNG de gifts

```python
_resolve_gift_images()
```
- Recorre `data/donaciones/`, construye `img_map` con normalizaciones
  (lowercase, `_` y space variants).
- Para cada gift en `custom_gifts`:
  - Si ya tiene `icon_path` válido y no es `Rose_black_white`: skip.
  - Match por `gid` (varias formas).
  - Match por `name` (varias formas).
  - Si no encuentra nada y no tiene path: usa `Rose_black_white.png` default.
- Si hubo cambios: setea `_gifts_need_save = True` (para guardar al boot).

#### Folders + index de imágenes por juego

```python
_init_game_image_folders()
```
1. Crea folders para los 3 predefinidos: `valheim/terraria/minecraft` ×
   `entities/items/events`.
2. Crea folders para juegos custom según sus categorías declaradas
   (`data_key` de cada categoría).
3. Llama `_build_image_index()`.

```python
_build_image_index()
```
- Escanea `data/game_images/` una sola vez al boot.
- Construye `_image_index[gid][cat] = {filename_stem: path}` con keys
  duplicados (case-original y lowercase) para lookup O(1).
- Soporta `.png, .jpg, .jpeg, .webp`.

#### Lookup de icono por entry

```python
_get_entity_icon(game_id, category, entry) → str
```

Cache key `(game_id, category, entry)`. Lookup order:
1. `entity_images[gid][cat][cmd]` o `[display]` (config explícita).
2. `_image_index` con varias formas del nombre:
   `cmd, display, cmd.replace(" ", "_"), display.replace(" ", "_"),
    safe_cmd, safe_cmd.lower(), cmd.lower(), display.lower()`.
3. Fallback: `get_default_for_category(...)` (icono genérico de la categoría).

#### Auto-descarga de imágenes de regalos detectados en vivo

```python
_on_gift_image_detected(gift_id, gift_name, image_url, coins)
```
1. Normaliza `gift_name`.
2. Busca si ya existe en `custom_gifts` (por gid o por name normalizado).
3. Si existe y ya tiene PNG válido: skip (solo reactiva si está disabled).
4. Si no existe o falta PNG:
   - Marca `_pending_gift_downloads.add(gift_name_lower)` para no duplicar.
   - `requests.get(image_url, timeout=10)`.
   - Convierte a PNG via PIL (`Image.open(BytesIO).convert("RGBA")`).
   - **Inyecta metadata** `tEXt` chunks: `Gift-Name`, `Gift-Coins`.
   - Guarda en `data/donaciones/<safe_name>.png`.
5. Actualiza/crea entry en `custom_gifts`.
6. `_save_gifts_only()` (persiste solo `gifts.json`, sin tocar el resto).

#### `_save_gifts_only()`
Lee `gifts.json` existente, actualiza solo la key `custom_gifts`, escribe
con `_write_json_atomic`.

#### `_inject_png_metadata(png_data, metadata) → bytes` (staticmethod)
- Encuentra posición de `IEND`.
- Para cada `(key, value)`: construye chunk `tEXt` con `latin-1`
  encoding + CRC32.
- Inserta chunks ANTES de IEND.

---

## Mixin 3 · `SimulatorMixin` (263 líneas) · `simulator.py`

> Sistema de simulación de eventos TikTok.

### Métodos clave

```python
_init_simulator_vars()         # Setea sim_event_type=None, etc.
open_simulator_dialog()        # Crea SimulatorDialog y lo abre con _wm_exec
_populate_sim_gifts()          # Pobla combo de simulator (con icon PNG escalado a 20x20)
_load_sim_gifts()              # Alias compat
_toggle_sim_gift_sort()        # Alterna asc/desc del combo
on_sim_event_change(idx)       # Show/hide widgets según evento
simulate_single_event()        # Construye data y llama _execute_simulated_event
simulate_burst(count)          # N eventos con QTimer.singleShot(i*200ms)
quick_simulate(etype, value)   # Para presets
_execute_simulated_event(etype, data)  # MISMA lógica que on_event real
```

### `_execute_simulated_event` — flujo idéntico a `on_event` real

1. Log `🎭 [SIM] <emoji> <descripción>` según etype.
2. `_play_event_sound(etype, data)`.
3. `overlay_client.send_event(etype, data)`.
4. `rule_engine.process_event(current_game, etype, data)` + log resultados.
5. Si `etype == "gift"`: `_check_fortune_trigger(gift_id, user)`.
6. Si `etype == "comment"`:
   - `_process_minigame_command` → si True, return.
   - Si empieza con `!`: ejecuta `rule_engine` con `command` data + `social.process_command`.
   - Si no es comando: `tts.speak(text, None, user)`.

### Burst con stagger 200ms
```python
for i in range(count):
    QTimer.singleShot(i * 200, self.simulate_single_event)
```
> Replicar en port: stagger debe ser exacto para no romper rate limits del rule_engine.

---

## Mixin 4 · `StreamProfilesMixin` (669 líneas) · `stream_profiles.py`

> Guardar/cargar perfiles de stream completos como snapshots JSON.

### Métodos públicos

```python
open_profiles_dialog()         # Crea StreamProfilesDialog y lo abre
save_stream_profile()          # Pide nombre con QInputDialog y guarda JSON
load_stream_profile()          # Carga el seleccionado con confirmación
delete_stream_profile()        # Borra archivo
```

### Schema del JSON `stream_profiles/<id>.json`

```json
{
  "name": "Stream Valheim 26-04",
  "profile_id": "stream_valheim_26_04",
  "game": "valheim",
  "created": "2026-04-26T18:30:00",
  "imported_at": "<iso>"?,

  "tiktok_username": "soykoru",
  "custom_gifts": { ... },
  "sounds": { "follow": "...", "share": "...", "superfan": "...",
              "<gift_id>": "...", "library": [...] },
  "voices": { "<user>": "<voice_id>", ... },

  "tts_enabled": true,
  "tts_volume": 80,
  "tts_voice": "es_mx_002",

  "theme": "midnight",

  "rules": [ ... ],
  "entities": [ ... ],
  "items": [ ... ],
  "events": [ ... ]
}
```

### `_load_profile_by_id` — pasos exactos

1. Backup automático: `backup_manager.create_backup("pre_load")`.
2. Lee JSON.
3. **Bloquea signals** de los widgets antes de cambiar (`game_sel,
   tts_on, vol, voice_sel, theme_sel`) para evitar handlers en cascada.
4. Cambia `current_game`.
5. Setea `tiktok_user.text(), custom_gifts, sounds, voices`.
6. `tts.user_voices.clear()` + `set_user_voice` por cada uno.
7. Setea `tts.enabled_chat, tts.volume, tts.default_voice`.
8. Si `theme != current_theme`: setea property + `apply_theme()`.
9. Reemplaza reglas: `p.rules.clear()` + `Rule.from_dict(d)` por cada.
10. Setea `p.entities, p.items, p.events`.
11. `p.save()` + `refresh_all()` + `save_config()`.
12. Log + QMessageBox.information con summary.

### Métodos auxiliares
```python
_populate_profiles_list, _filter_profiles_list, _on_profile_selected,
_duplicate_profile, _rename_profile, _export_profile, _import_profile,
_save_and_refresh, _load_and_close, _delete_and_refresh,
_get_stream_profiles_dir, _refresh_stream_profiles
```

---

## Mixin 5 · `CategoryTabsMixin` (450 líneas) · `category_tabs.py`

> Pestañas dinámicas por categoría declarada en games.json + ejecución
> de acciones custom.

### Métodos clave

```python
_create_default_category_tabs()  # 3 tabs default (entities/items/events)
_create_category_tab(cat)        # Crea una tab nueva con widget + lista + botones
_remove_category_tab(cat_id)
_update_category_tabs(categories)  # Diff: añade nuevas, remueve obsoletas
_manage_category_data(cat)       # Abre DataDialog con la categoría
_test_category_item(cat)         # Prueba el seleccionado
_test_generic_category_item(cat) # Para categorías custom con endpoint
send_to_game_with_category(cat, entity, amount, user, game_id)  # ⭐
_execute_custom_game_action(game_id, action_type, command, amount, user)  # ⭐
manage_valuables(category_config)  # Alias a manage_items
manage_custom_category(cat)
test_selected_valuable()
_refresh_category_list(cat_id, entries)
```

### `send_to_game_with_category` — el ENVÍO real al juego custom

1. Resolver `target_game_id` (param o `current_game`).
2. Obtener `game = self.games.get(target_game_id)`.
3. **Extraer entity name**: si tiene `" - "` (formato R.E.P.O. `Tipo - Nombre`),
   tomar la última parte después del `-`.
4. Tomar `endpoint` y `payload_template` de `cat`.
5. **Reemplazar variables** en el payload:
   - `{entity}` → entity_name
   - `{amount}` → str(amount)
   - `{user}`, `{username}` → user
   - Si tiene `{command}`: extraer `cmd:val` con split por `:`.
   - `{value}` → val.
6. `json.loads(payload_str)` o fallback a dict simple.
7. Construir `url = f"http://{host}:{port}{endpoint}"`.
8. **POST async via `core.games.EX.submit(_send_async)`** (mismo
   ThreadPoolExecutor que el resto de juegos).
9. timeout=2s.
10. Retorna `(True, "✅ <entity> enviado")` SIN esperar la respuesta
    (fire-and-forget).

### `_execute_custom_game_action` — callback del RuleEngine

Mapeo de `action_type` legacy a tipos de categoría:
```python
{
  "spawn":          ["entity", "entities", "spawn"],
  "give_item":      ["item", "items", "give_item"],
  "trigger_event":  ["event", "events", "trigger_event", "command", "commands"],
  "spawn_valuable": ["valuable", "valuables", "spawn_valuable"],
}
```

Búsqueda de categoría en 3 niveles:
1. **ID exacto** (`cat.id == action_type`) — prioridad máxima.
2. **Variantes mapeadas** (cat.type o cat.id in variants).
3. **Por tipo genérico** (cat.type in ["entity", "spawn"], etc.).

Si encuentra: llama `send_to_game_with_category(cat, command, amount, user, game_id)`.
Si no: log warning y retorna `(False, "Categoría X no encontrada")`.

---

## Patrón común a todos los mixins

- **NO `__init__`** — usan atributos asumidos.
- **NO importan main_window** (evita ciclos).
- Acceden a `self.X` libremente.
- Pueden llamar a otros mixins instalados (e.g. `SimulatorMixin` llama
  `_play_event_sound` de AudioMixin).
- Constantes propias por mixin si las tienen (ej: `_PLAYER_COLORS`,
  `_HEART`, etc).

---

## Notas para el port

1. **El sistema de sonidos con cola y worker daemon** debe replicarse
   con un patrón equivalente en Electron — Web Audio API + `<audio>` o
   un mainProcess que dispatch comandos al renderer.
2. **El cache LRU de pixmaps (max 50)** se traduce a un Map con eviction
   FIFO en React.
3. **`_resolve_gift_images()`** se ejecuta UNA VEZ al boot — replicar
   en main process para que el sidecar no tenga que escanear donaciones
   en cada arranque.
4. **Auto-descarga de gifts** es un patrón importante: cuando TikTok
   detecta un gift nuevo en vivo, descarga su PNG y lo persiste con
   metadata. Esto debe vivir en el sidecar Python (mantiene 1:1).
5. **3 canales TTS independientes** — replicar como 3 audio elements
   con sus propias colas para que puedan sonar simultáneamente.
6. **`send_to_game_with_category` con templating de payload**: usar la
   misma lógica de string-replace en el sidecar Python (no en el
   renderer) — sigue siendo Python a Python.
7. **`_load_profile_by_id` con block-signals** — patrón importante:
   antes de cambiar widgets programáticamente, bloquear sus signals para
   no triggerear los handlers. En React equivale a `setState` con flags
   o refs sincrónicos.
