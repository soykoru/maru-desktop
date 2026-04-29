# MARU Original — `core/tts_engine.py` (840 líneas)

> **3 canales TTS independientes** que pueden sonar simultáneamente.
> 74 voces verificadas vía API TikTok TTS.

## Constantes

```python
ENDPOINT = "https://tiktok-tts.weilnet.workers.dev/api/generation"

CHANNEL_CHAT = 0       # Comentarios del stream
CHANNEL_SOCIAL = 1     # Sistema social / duelos
CHANNEL_FORTUNE = 2    # ⭐ EXCLUSIVO para fortunas (instantáneo)

# Aliases para compat con código viejo:
PRIORITY_URGENT = 0
PRIORITY_DUEL = 1
PRIORITY_SOCIAL = 2
PRIORITY_FORTUNE = 3
PRIORITY_NORMAL = 5
PRIORITY_LOW = 10

_MAX_QUEUE = 30        # Máximo items por cola (chat/social/fortune)
```

## `VOICES` — 74 voces hardcoded

Categorías:
- ⭐ **Populares** (5): `en_us_002`, `en_us_006`, `en_male_narration`,
  `en_us_ghostface`, `es_mx_002`.
- 🎭 **Disney/Star Wars** (7): C-3PO, Stitch, Stormtrooper, Rocket Raccoon,
  Chewbacca, Ghost Host, Madame Leota.
- 🎃 **Festividades** (9): Grinch, Pirata, Mago, Santa, Cupido, Abuelita,
  Betty Zombie, Trevor, Christmas Singer.
- 🇺🇸 **US English** (16): warm female, professor, scientist, etc.
- 🇬🇧 **UK** (5): butler, rich girl, neighbor.
- 🇦🇺 **AU** (2).
- 🇪🇸 **ES** (1).
- 🇫🇷 **FR** (2), 🇩🇪 **DE** (2), 🇮🇹 **IT** (1).
- 🇧🇷 **BR** (4), 🇯🇵 **JP** (4), 🇰🇷 **KR** (3), 🇨🇳 **ZH** (1), 🇮🇩 **ID** (1).
- 🎵 **Cantantes** (10): Deep Jingle, Halloween Song, Classical Singer,
  Salut D'amour, Glorious Voice, Funny Singing, Wonderful World, Lobby
  Music, Sunshine Soon, Warmy Breeze, Twinkle.

## `@dataclass TTSItem`
```python
sequence: int     # FIFO order
audio: bytes
volume: float = 0.8
```

## `TTSEngine`

### Atributos del estado
- `volume = 0.8`, `volume_social = 0.85`, `volume_fortune = 0.85`.
- `enabled, enabled_chat, enabled_social, enabled_fortune` (bool).
- `default_voice = "es_mx_002"`.
- `user_voices: dict[username_norm, voice_id]`.
- `cache_dir = data/tts_cache/`.
- `audio_ok: bool` — si pygame.mixer está OK.
- `pygame, _channel_chat, _channel_social, _channel_fortune` — refs.

### 3 colas independientes (heaps por sequence)
- `_chat_queue, _social_queue, _fortune_queue` — `[]` con heapq.
- `_chat_seq, _social_seq, _fortune_seq` — contadores FIFO.
- 6 locks: `_chat_lock, _social_lock, _fortune_lock, _social_gen_lock,
  _session_lock, _stop`.
- 3 events: `_chat_event, _social_event, _fortune_event` (threading.Event).

### Inicialización (`__init__`)
1. `self.cache_dir.mkdir()`.
2. `clear_cache()` — limpia cache antiguo al boot.
3. Inicializa pygame mixer.
4. Reserva 3 channels de pygame.mixer (uno por canal).
5. Lanza 3 worker threads daemon: `_process_chat_queue`,
   `_process_social_queue`, `_process_fortune_queue`.
6. `_gen_pool = ThreadPoolExecutor` para generar audio en paralelo.
7. `_session = requests.Session()`.

## API pública

### `speak(text, voice=None, user=None, priority=5) → bool`
- Canal **CHAT**.
- NO bloquea — submit a `_gen_pool`.
- Truncado a 150 chars.
- Si `enabled_chat=False` o `audio_ok=False`: skip.
- `final_voice = user_voices[user]` si existe; sino `voice or default_voice`.

### `speak_social(text, voice=None, volume=None) → bool`
- Canal **SOCIAL**. NO bloquea.
- Truncado a 400 chars.
- Si > 140 chars: split por `". "` y encola múltiples chunks
  (con `_social_gen_lock` para que un mensaje completo se encole antes
  de que otro empiece — evita mezclar).

### `speak_fortune(text, voice=None, volume=None) → bool`
- Canal **FORTUNA**. NO espera al chat ni al social — independiente.
- Las fortunas entre sí SÍ se encolan (no se cortan).
- Truncado a 400 chars.

### `speak_duel(text, voice=None, volume=None) → bool`
- Canal SOCIAL con boost de volumen (`+0.1`, cap 1.0).

### `speak_now(text, voice=None) → bool`
- Reproduce **SÍNCRONO** en canal CHAT (espera a que termine).
- Para pruebas / botones de "Probar".

### Aliases
- `speak_priority(text, voice, priority, volume)` → `speak_social`.
- `speak_now_with_volume(text, voice, volume, priority)` → `speak_social`.

## Generación de audio (`_gen`)

```python
key = md5(f"{text}_{voice}").hexdigest()
cache = self.cache_dir / f"{key}.mp3"
if cache.exists(): return cache.read_bytes()
```

POST a `ENDPOINT` con `{text, voice}`, decode base64 → guarda en cache.

**Retries**: 3 attempts con backoff `0.5 * (attempt + 1)`. Cierra y
reabre `_session` entre intentos en errores de conexión.

Truncado a 150 chars en `_gen`.

## Workers de cola

### `_process_chat_queue` / `_process_social_queue` / `_process_fortune_queue`
```python
while not self._stop:
    item = heappop(_<channel>_queue)  if not empty
    if item:
        _play_on_<channel>_channel(item.audio, item.volume)
    else:
        event.wait(0.5)  # espera a que push setee event
```

### `_play_on_<channel>_channel(audio, volume)`
1. Crea `pygame.mixer.Sound(io.BytesIO(audio))`.
2. `set_volume(volume)`.
3. `_channel_<X>.play(sound)`.
4. **Espera busy** con `pygame.time.wait(25)` loop.

## Username normalization (`_normalize_username`)
```python
return username.strip().lower().replace("@", "").replace(" ", "")
```

## Voces por usuario

```python
set_user_voice(user, voice)
remove_user_voice(user)
get_user_voice(user) → str  # default_voice si no existe
```

`_get_voice_for_user(user, voice=None)`:
- Si `user_voices[normalized]`: retorna esa.
- Sino: retorna `voice or default_voice`.

## Control

### `stop()`
1. `_stop = True`.
2. Stop los 3 channels.
3. `pygame.mixer.quit()`.
4. `_gen_pool.shutdown(wait=False, cancel_futures=True)`.
5. `_session.close()`.
6. Clear las 3 colas.

### `clear_cache()`
Borra todos los `.mp3` del cache_dir al boot.

### `clear_queue()` / `clear_chat_queue()` / `clear_social_queue()` / `clear_fortune_queue()`

### `is_busy() / is_chat_busy() / is_social_busy() / is_duel_active()`

### `get_queue_sizes() → dict`
```python
{"chat": N, "social": N, "fortune": N}
```

## Notas para el port

- **Cache MD5 de audio MP3**: replicar en sidecar Python (mantener
  `tts_cache/`).
- **3 channels pygame**: en JS equivalente sería 3 `<audio>` elements
  o Web Audio AudioContext con 3 destinos paralelos.
- **El endpoint TikTok TTS es PÚBLICO sin auth** — `tiktok-tts.weilnet.workers.dev`.
- **Truncados**: 150 chars chat, 400 chars social/fortune.
- **Split por `". "` en social** para chunks largos — replicar.
- **`_social_gen_lock`** garantiza atomicidad por mensaje completo.
- **TODO el audio es lazy**: se genera al encolar, no al hacer `speak()`.
- **Fortuna es EXCLUSIVO** — corre en su propio worker thread, nunca
  espera a chat/social.
