# MARU Original — `core/tiktok_client.py` (584 líneas) · TikTokWorker

> Conexión robusta a TikTok Live con auto-reconexión + detección de
> errores de API.

## Clase: `TikTokWorker(QThread)`

### Signals (8)
```python
connected = pyqtSignal(str)              # username conectado
disconnected = pyqtSignal()
event_received = pyqtSignal(str, dict)   # (etype, data)
log_message = pyqtSignal(str)
error = pyqtSignal(str)
api_error = pyqtSignal(str)              # cambio de API detectado
stats_updated = pyqtSignal(dict)         # likes total
gift_image_detected = pyqtSignal(str, str, str, int)  # gift_id, name, url, coins
```

### Constantes
- `CONNECTION_TIMEOUT = 15` — segundos para verificar `is_live`.
- `MAX_RETRIES = 8` — intentos por ciclo.
- `RETRY_DELAY_BASE = 2` — backoff base.
- `RETRY_DELAY_MAX = 30` — cap del delay.
- `AUTO_RECONNECT_DELAY = 5` — delay antes de auto-reconectar.
- `_USER_ATTRS` — orden de atributos para extraer username:
  `('unique_id', 'uniqueId', 'nickname', 'nick_name', 'display_id', 'displayId', 'username')`.
- `_INVALID_NAMES = frozenset(['none', 'anon', 'anonymous', 'user', '', 'undefined', 'null'])`.
- `setPriority(QThread.Priority.TimeCriticalPriority)` para no perder eventos.

### `API_CHANGE_ERRORS` (frozenset de 19 keywords)
Detecta errores que indican que TikTok cambió su API:
```
protobuf, proto, decode, serialize, websocket protocol, unexpected message,
unknown field, invalid format, attribute, deprecat, schema, parsing,
version, upgrade, obsolete, method not found, endpoint, unsupported,
breaking change
```
También dispara: `betterproto`/`protobuf` en error type, `AttributeError`
con palabras tiktok/proto, `KeyError` con keys de eventos (gift, user,
event, room, like, comment, follow, share, proto).

### `run()` — flujo de conexión

1. **Windows fix**: `asyncio.WindowsSelectorEventLoopPolicy()`.
2. Loop `while running and should_reconnect`:
   - `for attempt in 1..MAX_RETRIES`:
     - Si attempt > 1: backoff exponencial `min(2 * 2^(attempt-2), 30)`.
     - `_run_client_optimized()`.
     - Si retorna sin excepción: connection terminada normalmente,
       reconnect_count++, sleep AUTO_RECONNECT_DELAY, break.
     - **Excepciones tratadas**:
       - **API change**: `api_error` + `should_reconnect=False` + break.
       - **Offline / "not live"**: error + `should_reconnect=False` + break.
       - **Rate limit / blocked / captcha**: error específico + stop.
       - **User not found**: stop.
       - **Otros**: continuar reintentando.

### `_run_client_optimized()` — la conexión real

1. Importa `TikTokLive` (`pip install TikTokLive==6.6.5`).
2. Crea `TikTokLiveClient(unique_id=f"@{username}")`.
3. **Verifica `is_live` con timeout 15s**. Si `False` → raise. Si
   `None` (timeout/error) → intentar igual.
4. **Registra 6 handlers**:
   - `ConnectEvent` → emit `connected`, log.
   - `DisconnectEvent` → log "Auto-reconexión activa" si aplica.
   - `GiftEvent` → procesa streak con `group_id`, emit `gift` y
     `gift_image_detected` (con URL del icono).
   - `LikeEvent` → calibración inicial + delta de likes.
   - `CommentEvent` → emit `comment`; si empieza con `!`, emit `command`.
   - `FollowEvent` → emit `follow`.
   - `ShareEvent` → emit `share`.
5. `client.run()` (método oficial de TikTokLive).

### Gift streak (algoritmo crítico)
- `_streaks: OrderedDict[group_id → repeat_count]` (max 50).
- Sin `group_id`: emite UNA vez (gift único).
- Con `group_id`: si `repeat > last`, emite `(repeat - last)` veces
  `gift` events, actualiza `last`.

### LIKES — calibración + delta
- 1ra vez: setea `_total_likes = total_from_event` y returns sin emit
  ("calibración").
- Después: si `total_from_event > _total_likes`, calcula `new_likes`
  (cap entre 0–500 para evitar saltos absurdos).
- Emite 3 signals: `like`, `like_milestone` (con total), `stats_updated`.

### Username extraction (`_get_username_fast`)
Orden:
1. `event.user_info` o `event.user` o `event.from_user`.
2. Probar `username, unique_id, uniqueId, display_id` (en orden).
3. Si nada: `nick_name` o `nickname`.
4. Skip si `clean in INVALID_NAMES` o starts with `'viewer'`.
5. Fallback: `viewer_<id(event) % 10000>`.

### `_extract_gift_image(gift)` — URL del PNG del regalo
Probar attributes en orden:
- `gift.image / gift.icon / gift.preview_image` (string `http*` o objeto
  con `m_urls/urls/url_list/m_uri/uri/url`).
- `gift.image_url / gift.img_url / gift.gift_image`.

### `stop()` — cierre limpio
- `_running = False`, `_should_reconnect = False`.
- `client.disconnect()` con timeout 3s.
- `quit()` + `wait(2000)`.

## Notas para el port
- En el sidecar Python: usar TikTokLive idéntico (no hay equivalente JS robusto).
- Signals → mensajes JSON-RPC al renderer.
- El **algoritmo de streak con `group_id`** y la **calibración de likes**
  son CRÍTICOS — replicar idénticos.
