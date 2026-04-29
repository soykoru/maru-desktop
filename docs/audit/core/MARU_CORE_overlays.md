# MARU Original — `core/overlays.py` (270 líneas)

> Cliente HTTP que envía eventos al backend de overlays en Cloudflare.

## Constantes

```python
DEFAULT_WEB_URL = env "MARU_OVERLAYS_WEB" or "https://overlays.korugames.lat"
DEFAULT_API_URL = env "MARU_OVERLAYS_API" or "https://maru-overlays.soykoru07.workers.dev"
DEFAULT_BACKEND_URL = DEFAULT_API_URL  # alias retrocompat

OVERLAYS_CONFIG_FILE = DATA_DIR / "overlays.json"

_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="overlays")
_REQUEST_TIMEOUT = 1.5
```

## `OVERLAY_REGISTRY` — overlays soportados (2 actuales)

```python
{
  "taps": {
    "name": "Meta de Taps",
    "icon": "❤️",
    "description": "Barra de progreso animada con meta de likes",
    "default": {
      "enabled": True, "goal": 1000, "color": "#1DB954",
      "message": "¡Lo logramos!", "reset_on_goal": True
    }
  },
  "streak": {
    "name": "Racha (!racha)",
    "icon": "🔥",
    "description": "Llama animada con días de racha. Se activa con !racha",
    "default": {
      "enabled": True, "duration": 6000, "label": "DÍAS DE RACHA"
    }
  }
  # Futuros: gifts, follows, top_likers, alerts...
}
```

> **Para agregar overlay nuevo**: registrar aquí + crear
> `assets/overlays/<id>/index.html` + `app.js` + `style.css`. Listo.

## Anonymous user_id

### `_generate_user_id()`
```python
raw = f"{platform.node()}|maru-overlays-v1"
h = hashlib.sha256(raw.encode("utf-8")).hexdigest()
return f"user-{h[:6]}"
```

NO usa `getpass.getuser()` (no expone username del SO).

### Migración automática de IDs viejos
Si el ID en `overlays.json` empieza con `<os_user>-` (ej `michael-3b44`),
lo regenera anónimo automáticamente al cargar.

## `OverlayClient`

### `__init__()`
1. `_lock = threading.Lock()`.
2. `_load_config()`.
3. `_ensure_overlay_defaults()` — añade overlays nuevos del REGISTRY que
   no estén en config.

### Persistencia atómica
```python
def _save(cfg):
    tmp = OVERLAYS_CONFIG_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(cfg, indent=2, ensure_ascii=False))
    tmp.replace(OVERLAYS_CONFIG_FILE)  # atomic rename
```

### Schema de `overlays.json`
```json
{
  "user_id": "soykoru" | "user-a8b3f2",
  "overlays": {
    "taps": { ...default merged with user changes },
    "streak": { ... }
  }
}
```

### API pública

```python
get_user_id() → str
set_user_id(new_id)             # sanitiza: alphanum + "-_", max 32 chars
get_backend_url() → str
get_overlay_config(overlay_id) → dict
get_overlay_url(overlay_id) → str   # "<web>/<id>/?u=<user_id>"
is_overlay_enabled(overlay_id) → bool
update_overlay(overlay_id, **kwargs)  # actualiza fields configurables
save_config()
```

### `send_event(event_type, data) → None`
- **Skip si NO hay overlay enabled** (para no malgastar requests).
- POST async via `_EXECUTOR.submit(_do_send, ...)`.
- Body: `{user_id, type, data}`.
- Endpoint: `<API_URL>/event`.

### `_do_send(url, payload)`
- POST con timeout 1.5s.
- Status 200/201/204 → OK, log recovery si había errores previos.
- Otro status: `_log_error_throttled`.

### `_log_error_throttled(fmt, *args)`
- Log primeros 3 errores (`_max_error_log = 3`).
- Después: log "Silenciando errores tras 3 fallos" UNA vez.
- Reset cuando hay un OK.

### `test_connection() → (bool, msg)`
- `GET <API_URL>/health` con timeout 3s.
- Returns `(True, "OK (Xms)")` o `(False, "HTTP X")` o `(False, "Sin conexión")`.

## Eventos enviados al backend

Desde MainWindow `on_event` y mixins:
- `gift, follow, share, like, comment, subscribe, command` (los 7 de TikTok).
- `streak` (con `{user, days}` desde `social.streak_overlay_callback`).
- `reset` (al conectar TikTok — resetea barra de taps a 0).
- `tap` (alias de like, usado por overlay de taps).
- `<overlay_id>_config` (para live update de settings sin recargar).
- `reload` (forzar reload del browser source).

## Notas para el port

- **Backend en Cloudflare Workers** ya está deployado en
  `maru-overlays.soykoru07.workers.dev` (URL fija).
- **Frontend en Cloudflare Pages** en `overlays.korugames.lat`.
- **Para agregar overlay nuevo**: solo tocar `OVERLAY_REGISTRY` +
  crear assets HTML/JS/CSS en `assets/overlays/<id>/`. La UI lo recoge
  automáticamente.
- **Anonymous user_id** + migración automática — replicar exactamente.
- **Throttled error log** evita spam si el backend cae.
- **Async fire-and-forget** con timeout 1.5s — NUNCA bloquea on_event.
- **Skip si no hay overlay enabled** evita gasto de requests cuando el
  user no usa overlays.
- **Sanitización de user_id**: solo `alphanum + - + _`, max 32 chars,
  lowercase. Replicar para mantener URL-safety.
