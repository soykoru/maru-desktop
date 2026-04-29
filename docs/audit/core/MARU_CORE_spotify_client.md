# MARU Original — `core/spotify_client.py` (1652 líneas)

> **El archivo más grande de core/**. Cliente Spotify con anti-rate-limit
> robusto para sobrevivir el dev mode (límite ~10-15 calls / 30s).

## `SpotifyClient`

### Constantes

```python
SCOPES = "user-modify-playback-state user-read-playback-state user-read-currently-playing user-read-private"
REDIRECT_URI = "http://127.0.0.1:8888/callback"
```

### Throttling — MUY conservador (dev mode)

```python
_API_MIN_INTERVAL = 3.0       # 3s entre API calls
_API_MAX_PER_WINDOW = 8       # Máx 8 calls / ventana
_API_WINDOW_SECONDS = 30      # Ventana = 30s
_PLAYBACK_CACHE_TTL = 30.0    # Cache normal 30s
_RECOVERY_CACHE_TTL = 120.0   # En recovery: 2min
_RECOVERY_DURATION = 600      # Recovery dura 10min post-rate-limit
_RATE_LIMIT_MAX_WAIT = 300    # Cap absoluto: 5min
_RATE_LIMIT_CAPS = (60, 120, 300)  # Cap progresivo 1er/2do/3er+ rate limit
_PLAY_GRACE_PERIOD = 5.0      # No verificar playback x 5s post start_playback
_SEARCH_CACHE_TTL = 900       # Cache de búsquedas: 15 min
```

### Logger filter custom (`_SpotipyFilter`)
Silencia errores ruidosos de spotipy:
- `429 HTTP Error / returned`.
- `Max Retries / MaxRetryError`.

Aplicado a `spotipy.client` y `urllib3.util.retry`.

### Atributos
- **Config pública**: `client_id, client_secret, device_id, enabled,
  max_queue=5, priority_users (set), enabled_commands (set por defecto
  `{play, skip, cola, pause, playfan}`)`.
- **Account info**: `account_name, account_email`.
- **Estado**: `_sp (spotipy.Spotify), _auth (SpotifyOAuth), queue (list),
  current_track (dict)`.
- **Locks**: `_lock` (queue), `_connect_lock`, `_playback_lock`,
  `_api_lock`, `_rate_limit_lock`.
- **Cache**: `_playback_cache, _playback_cache_time, _search_cache (dict),
  _api_call_log (deque maxlen=100)`.
- **Rate limit**: `_rate_limited_until, _rate_limit_backoff,
  _consecutive_rate_limits, _last_rate_limit_end`.
- **Playfan**: `playfan_uses (dict por user), _playfan_used (dict),
  _playfan_date (date)`.
- **Contexto**: `_saved_context (dict), _context_needs_restore (bool)`.

### Persistencia
- `_RATE_LIMIT_FILE = secrets/spotify/rate_limit`.
- `_ACCOUNT_FILE = secrets/spotify/account` (cuenta seleccionada).
- `_ACCOUNTS_FILE = secrets/spotify/accounts.json` (lista de cuentas).
- `cache_path = secrets/spotify/cache` (token OAuth).

## Autenticación

### `authenticate() → (bool, msg)`
- Lock `_connect_lock` con timeout 5s.
- Setea `_connecting = True`.
- Llama `_authenticate_inner()`.

### `_authenticate_inner()`
1. Validar `client_id + client_secret`.
2. Crea `SpotifyOAuth(client_id, client_secret, redirect_uri, scope, cache_path, open_browser=False)`.
3. **Token cacheado**: si existe y válido, init spotipy.
4. **OAuth completo**: si está rate-limited, return error con tiempo.
5. Abre `auth_url` en navegador y arranca server local en :8888.
6. Server captura `?code=...`, intercambia por token.
7. Guarda token en cache file.
8. Init spotipy.

### `try_auto_connect() → bool`
- No abre navegador.
- Solo intenta usar token cacheado.
- Llamado desde MainWindow al boot (en thread daemon).

### `_init_spotipy_client(spotipy_module, from_cache=False)`
- Inicializa `_sp = spotipy.Spotify(...)`.
- `_patch_session()` — configura session HTTP.
- `_lazy_fetch_account_name()` — fetch async del nombre de cuenta.
- Setea `_connected = True`.

### `disconnect()`
- Para `_auth_server` si está corriendo.
- Resetea state, NO borra cache file.

### `switch_account(client_id, client_secret)`
- Disconnect actual.
- Setea nuevas credentials.
- Borra cache de token.
- Authenticate nuevo.

## Gestión de cuentas guardadas

### `_save_account_info()` / `_load_account_info()`
Persiste `{client_id, client_secret, account_name}` en `account` file.

### Las 5 acciones del `SocialConfigDialog`:
- `_spotify_save_account` (guarda en `accounts.json`).
- `_spotify_load_account` (carga de `accounts.json` → setea creds → reconnect).
- `_spotify_delete_account`.
- `_spotify_refresh_accounts_combo`.

## API rate limit handling

### `_throttle_api_call(wait=False) → bool`
1. **Lock `_api_lock`**.
2. **Verificar rate limit**: `_is_rate_limited()` → si sí, returns False.
3. **Verificar ventana**: cuenta calls en últimos `_API_WINDOW_SECONDS`,
   si >= `_API_MAX_PER_WINDOW`:
   - Si `wait`: sleep hasta que la ventana se libere.
   - Sino: returns False.
4. **Verificar interval**: `time - _last_api_call < _API_MIN_INTERVAL`:
   - Si `wait`: sleep el delta.
   - Sino: returns False.
5. Update `_last_api_call`, append a `_api_call_log`.
6. Returns True.

### `_detect_rate_limit(error)` → bool
- Detecta `429` en error.
- Si es `SpotifyException` con headers, lee `Retry-After`.
- Default backoff progresivo:
  - 1er rate limit: 60s.
  - 2do consecutivo: 120s.
  - 3er+: 300s.
- Setea `_rate_limited_until = time + backoff`.
- Cap en `_RATE_LIMIT_MAX_WAIT = 300s`.
- Persiste con `_save_rate_limit()`.

### `_is_rate_limited() → bool`
Lock `_rate_limit_lock`. Compara `time < _rate_limited_until`.
Side-effect: si terminó el rate limit, marca tiempo de fin para entrar
en "recovery mode" (cache TTL 120s vs 30s).

### `get_rate_limit_remaining() → int` / `get_rate_limit_display() → str`
Para mostrar en UI: `"45s"` o `"2m 30s"`.

### `force_clear_rate_limit()`
Botón de pánico para limpiar rate limit manualmente.

## Búsqueda

### `search_track(query) → dict | None`
- **Cache**: `query_lower` → `(result, timestamp)`. TTL 15 min.
- Si `_is_rate_limited()`: return cached o None.
- Llama `_search_spotify(query)`.

### `_search_spotify(query)`
- `_throttle_api_call(wait=True)`.
- `_sp.search(q=query, type="track", limit=1, market="from_token")`.
- Extrae primer track.

## Cola de reproducción

### Estructura `queue`
Lista de:
```python
{
  "track": {"name", "artist", "uri", "duration_ms", ...},
  "user": "<user>",
  "priority": bool,        # True si !playfan
  "added_at": float
}
```

### `play_request(user, query) → (bool, msg)`
1. `enabled` + `is_command_enabled("play")`.
2. **Verificar `max_queue`** — si lleno, error.
3. `search_track(query)` (cached).
4. **Insertar en queue**:
   - **User priority** (priority_users): cola RANDOM (insert en posición random).
   - User normal: append al final.
5. `_add_to_native_queue(uri)` — manda a Spotify (preserva playlist).
6. Return `(True, "Agregada: <name> — <artist>")`.

### `playfan_request(user, query) → (bool, msg)`
1. Verificar `user in priority_users` (lower).
2. **Cuota diaria**: `playfan_uses[user]` (default 2). Si excedió: error.
3. `search_track(query)`.
4. **Salvar contexto** (`_save_spotify_context`).
5. `_start_playback(uri)` — empieza inmediato.
6. `_playfan_used[user] += 1`.
7. `_context_needs_restore = True` (para restaurar después de la canción).

### `skip_current() → (bool, msg)`
- `_throttle_api_call`.
- `_sp.next_track()`.
- Invalida cache de playback.

### `pause()` / `resume()` / `toggle_playback()`
- Pause: `_sp.pause_playback()`.
- Resume: `_sp.start_playback()`.
- Toggle: lee playback, si `is_playing` pausa, sino resume.

### `clear_queue()` / `remove_from_queue(index)` / `get_queue_list()`

## Now playing

### `get_now_playing() → dict | None`
- `_throttle_api_call`.
- `_sp.current_playback()`.
- Returns:
  ```python
  {"name", "artist", "duration_ms", "progress_ms", "is_playing", "uri"}
  ```

### `_get_playback() → dict | None` (cached)
- TTL `_PLAYBACK_CACHE_TTL` (30s normal, 120s recovery).
- Llama `current_playback`.

### `check_and_advance() → dict | None`
Llamado por timer cada 30s (`_spotify_timer` del MainWindow):
1. Si en grace period (`time - _last_play_time < 5s`): skip.
2. Lee playback. Si terminó la canción del bot:
   - Avanza al siguiente de `queue` o restaura context.
3. Si la canción actual no es de la queue: clean up.

## Context management (para playfan)

### `_save_spotify_context(playback)`
Guarda `{context_uri, position_in_context, position_ms}` antes de
interrumpir con playfan.

### `_restore_spotify_context()`
Reanuda el playlist/album/song desde donde estaba.

## PlayFan daily reset

### `_reset_playfan_if_new_day()`
Si `_playfan_date != today()`: clear `_playfan_used` y update fecha.

### `get_playfan_remaining(user) → int`
`max(0, playfan_uses.get(user, 0) - _playfan_used.get(user, 0))`.

## Devices

### `get_devices() → list`
`_sp.devices()`. Returns list of `{id, name, type, is_active}`.

### `device_id` se aplica en cada call a `_start_playback / _add_to_native_queue`.

## Account info

### `get_account_info() → dict`
- `display_name, email, country, product (premium/free)`.
- Cached `_lazy_fetch_account_name()`.

## Notas para el port

- **MANTENER en sidecar Python** — `spotipy` es el SDK oficial y robusto.
  No hay equivalente JS al nivel de anti-rate-limit que tiene este código.
- **Anti-rate-limit es CRÍTICO** — Spotify dev mode tiene rate limits
  agresivos no documentados. Los caps progresivos (60→120→300s) y la
  ventana rolling de 30s con max 8 calls evitan bans.
- **Token cache file**: persiste OAuth refresh token entre sesiones.
- **Auto-reconnect** al boot via `try_auto_connect()` (no abre navegador).
- **PlayFan con cola random** para priority users — replicar
  exactamente.
- **Context save/restore** para que `!playfan` no rompa la playlist
  del streamer.
- **Backend OAuth callback** abre server local en :8888 — requerirá
  ajuste para Electron (puede usar `oauth-electron` o similar).
- **Multi-cuenta** con `accounts.json` para cambiar rápido.
- **`_RATE_LIMIT_CAPS`**: el back-off progresivo se persiste en disco
  para que sobreviva al reinicio.
