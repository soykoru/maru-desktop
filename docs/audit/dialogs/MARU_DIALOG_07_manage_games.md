# Diálogo 07 — `manage_games_dialog.py` · ManageGamesDialog + EditPredefinedDialog (427 líneas)

## ManageGamesDialog

> Hub para gestionar **juegos predefinidos** (3) + **perfiles personalizados**.

### Constructor

```python
ManageGamesDialog(parent, custom_games: dict)
```

- minSize 650x600.

### Layout

#### Header
- Title `🎮 Perfiles de Juegos` (18 bold ACCENT).
- Hint: `"Cada perfil tiene sus propias reglas, entidades e items."`.

#### `📦 Perfiles Predefinidos`
Solo permite editar host/port/RCON. NO se pueden eliminar ni añadir
categorías.

- Label `🐉 Valheim  •  🌳 Terraria  •  ⛏️ Minecraft` (verde).
- 3 botones `✏️ Valheim`, `✏️ Terraria`, `✏️ Minecraft` que llaman
  `edit_predefined(<id>)` → abre `EditPredefinedDialog`.

#### `🎯 Perfiles Personalizados`
- `list` (QListWidget, iconSize 24x24, minHeight 150).
- Cada item: `<icon> <name> (<conn> puerto <port>)` con data
  `Qt.UserRole = gid`.

#### Botones acción
- `📋 Nuevo Perfil (basado en otro)` (azul) → `new_profile`.
- `➕ Añadir Juego (API/RCON)` → `add_game`.
- `✏️ Editar` / `🗑️ Eliminar`.

#### Help
- 4 bullets explicando: Nuevo Perfil, Añadir Juego, reglas por perfil,
  sonidos y voces globales o por perfil.

### Métodos clave

#### `new_profile()`
1. Construye lista `existing` con los 3 predefinidos + custom.
2. Abre `NewProfileDialog` (Diálogo 10).
3. Si Accept → `create_profile_from(result)`.

#### `create_profile_from(result)`
- Si `base_profile != "empty"`: `shutil.copy` del `data_<base>.json` al
  `data_<new_id>.json`.
- Si vacío: escribe estructura vacía
  `{"entities": [], "items": [], "events": [], "valuables": []}`.
- Crea `rules_<new_id>.json` con `{"rules": []}`.
- Copia categorías del juego base (deepcopy) o usa defaults.
- Construye `profile_config` completo:
  ```python
  {
    "id", "name", "icon": "🎮", "host": "localhost", "port": 5000,
    "connection_type": "http",
    "categories": [...],
    "spawn_endpoint", "item_endpoint", "event_endpoint",
    "spawn_payload", "item_payload", "event_payload",
    "has_entities", "has_items", "has_events",
    "share_sounds", "share_voices",
    "based_on": <base_id>
  }
  ```
- Lo añade a `self.custom_games[pid]`.

#### `add_game()` — abre `CustomGameDialog` y guarda.
Bloquea IDs `valheim/terraria/minecraft` (predefinidos).

#### `edit_game()` — abre `CustomGameDialog` con la config existente.

#### `delete_game()`
- QMessageBox.question con explicación de qué se borra:
  - Configuración del juego.
  - `data_<gid>.json`.
  - `rules_<gid>.json`.
- Si Yes: `Path.unlink()` ambos archivos + remove del dict.

#### `edit_predefined(game_id)`
- Diccionario `game_names = {valheim: 🐉 Valheim, ...}`.
- Abre `EditPredefinedDialog(self, game_id, game_name, parent_win)`.

#### `get_games() → dict`
Devuelve `self.custom_games`.

---

## EditPredefinedDialog (sub-clase)

> Subdiálogo SIMPLE para editar host/port/password de un juego
> predefinido.

### Constructor

```python
EditPredefinedDialog(parent, game_id: str, game_name: str, main_win)
```

- minSize 400x250.
- `self.game = main_win.games.get(game_id)` (instancia de
  ValheimGame / TerrariaGame / MinecraftGame).

### Layout

- Title `<game_name>` (18 bold ACCENT).
- `🔌 Configuración de Conexión`:
  - `host` (QLineEdit, default = `game.host`).
  - `port` (QSpinBox 1–65535, default = `game.port`).
  - **Solo si Minecraft**: `password` (QLineEdit, EchoMode.Password).
- `🔗 Probar Conexión` (botón) → `test_connection()`.
- `status` label.
- Botones `Cancelar` / `💾 Guardar` (verde).

### Auto-test debounce
- `_auto_test_timer` (singleShot 800ms) que dispara test al cambiar
  host/port (solo HTTP — Minecraft requiere click manual para no
  consumir RAM).
- HTTP: `_on_connection_params_changed` reinicia el timer.
- Minecraft: muestra label hint en lugar de auto-test.

### `test_connection()`
- Setea `game.host/port/password`.
- `_conn_worker = ConnectionWorker(game)` (background thread).
- Resultado vía `_on_connection_result(ok, msg)`:
  - Color verde claro o rojo según ok.

### `save_config()`
- Setea atributos en `game`.
- `main_win.save_config()`.
- QMessageBox info `"Configuración guardada correctamente"` y `accept()`.

## Notas para el port

- **3 juegos predefinidos** son inmutables en estructura (categorías,
  endpoints fijos en código). Solo host/port/password son editables.
- **Auto-test debounce 800ms** para HTTP — replicar.
- **Minecraft sin auto-test** porque RCON consume RAM al abrir socket.
- **Crear perfil basado en otro** copia el JSON de data y crea rules
  vacías. La carpeta de imágenes (`game_images/<gid>`) NO se copia
  automáticamente — el usuario tiene que recargar imágenes.
- **`based_on`** se persiste en el config para tracking.
