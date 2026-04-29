# MARU Original — Audit de core/ (G0.6)

> Producido en G0.6 · 2026-04-27.
> Total auditado: ~10.000 líneas de Python (lógica de negocio).

## Documentos

| # | Módulo | Líneas | Doc |
|---|--------|-------:|-----|
| 1 | `tiktok_client.py` | 584 | [`MARU_CORE_tiktok_client.md`](MARU_CORE_tiktok_client.md) |
| 2 | `rule_engine.py` | 627 | [`MARU_CORE_rule_engine.md`](MARU_CORE_rule_engine.md) |
| 3 | `games.py` | 696 | [`MARU_CORE_games.md`](MARU_CORE_games.md) |
| 4 | `tts_engine.py` | 840 | [`MARU_CORE_tts_engine.md`](MARU_CORE_tts_engine.md) |
| 5 | `ia_engine.py` | 675 | [`MARU_CORE_ia_engine.md`](MARU_CORE_ia_engine.md) |
| 6 | `social_system.py` + `social/*` | 588+2188 | [`MARU_CORE_social_system.md`](MARU_CORE_social_system.md) |
| 7 | `spotify_client.py` | 1652 | [`MARU_CORE_spotify_client.md`](MARU_CORE_spotify_client.md) ⭐ |
| 8 | `overlays.py` | 270 | [`MARU_CORE_overlays.md`](MARU_CORE_overlays.md) |
| 9 | `minigames.py` + `minigame_stats.py` + `spanish_words.py` | 648+53+1243 | [`MARU_CORE_minigames.md`](MARU_CORE_minigames.md) |
| 10 | `paths.py` + `logger.py` + `config_store.py` + `version_checker.py` | 88+93+148+105 | [`MARU_CORE_infra.md`](MARU_CORE_infra.md) |

⭐ El más grande del proyecto entero (1652 líneas).

## Hallazgos críticos de G0.6

### TikTok client
- **Detección de cambios de API**: 19 keywords + tipos `betterproto/protobuf`
  + `AttributeError` con tiktok/proto + `KeyError` con eventos.
- **Backoff exponencial**: `min(2 * 2^(attempt-2), 30)` con max 8 reintentos.
- **Auto-reconexión** automática tras DisconnectEvent.
- **Calibración de likes**: 1ra vez setea `_total_likes`, después usa delta.
  Cap entre 0–500 para evitar saltos absurdos.
- **Streak con `group_id`**: emite `(repeat - last)` events cuando llega
  un gift en racha.

### Rule engine
- **Trigger types confirmados**: gift, follow, share, command, subscribe,
  member, like, like_milestone (8 — uno más de lo que decía la memoria,
  porque `member` es alias de subscribe).
- **Action types con compatibilidad legacy** (4 modernos × 4 legacy mapping).
- **Match exact gift** (`gift == trigger`) evita "cap" activar "capybara".
- **Like counter por (rule_id, user)**, milestone con `_reached_milestones[rule_id]` set.
- **Multi-action con random_action** + ejecución ATÓMICA (cada acción
  capturada, no aborta).
- **find_command fuzzy** con 4 estrategias (exact name, exact cmd,
  contiene, palabras significativas 3+ chars).

### Games
- **`EX = ThreadPoolExecutor(max_workers=50)`** compartido por todos.
- **Fire-and-forget** — retornan `True` antes de que la request HTTP
  llegue al server.
- **MinecraftRCON** implementación pura del protocolo (no lib externa).
- **Templating de payload**: `{entity}, {amount}, {user}, {username},
  {command}, {value}` con sanitización de user (`alphanum + _- `).

### TTS engine
- **3 canales independientes**: chat / social / fortune con channels
  pygame separados. Pueden sonar SIMULTÁNEAMENTE.
- **74 voces** verificadas — confirmado.
- **Cache MD5** de audio MP3 en `tts_cache/`.
- **Endpoint público**: `tiktok-tts.weilnet.workers.dev` (sin auth).
- **Retries con backoff** + reset de session en errores.
- **Fortuna split** por `". "` para chunks largos.

### IA engine
- **4 proveedores** confirmados: Claude, Groq, Gemini, OpenAI.
- **`MODELS` por proveedor** con descripción.
- **`_FREE_FALLBACK_ORDER = ["groq", "gemini"]`** — fallback automático
  si la cuota se agota.
- **Prompts dramáticos** para `tarot/suerte/horoscopo` con detección
  por keywords.
- **`SOYKORU_CONTEXT` hardcoded** — debería ser configurable en G8.
- **Cooldown por user** + truncado 100–800 chars + emoji removal.

### Social system
- **35 comandos** definidos en `COMMANDS_INFO` con icon + name + desc + category + type.
- **8 categorías**: sistema, duelo, interaccion, relacion, respuesta,
  utilidad, musica, ia.
- **6 mixins** en `core/social/`: Combat, Interactions, Utilities,
  StreaksRankings, MusicIA, Admin.
- **Auto-add new commands**: si agregamos comandos nuevos, se activan
  automáticamente vía `known_commands` tracking.
- **Auto-racha** con timer de 1h en MainWindow (`process_auto_rachas`).
- **Tarot data** en `_tarot_data.py` (586 líneas, data-only).
- **Narraciones en JSON** editable.
- **Silencio sin TTS** si user no registrado (anti-saturación).

### Spotify client (el más grande)
- **Anti-rate-limit MUY conservador**: 3s/call, 8/30s, cap progresivo
  60→120→300s.
- **Cache 30s normal / 120s recovery** (10 min post rate-limit).
- **Search cache 15 min** evita re-buscar mismas canciones.
- **PlayFan**: cuota diaria por user (default 2/día) + reset diario
  + context save/restore para no romper la playlist del streamer.
- **Multi-cuenta** con `accounts.json` y switch instant.
- **`_SpotipyFilter`** silencia logs ruidosos de spotipy.
- **Token cache file** persiste OAuth refresh entre sesiones.
- **Auto-reconnect al boot** sin abrir navegador.

### Overlays
- **2 overlays actuales**: `taps, streak`.
- **Backend en Cloudflare Workers** desplegado: `maru-overlays.soykoru07.workers.dev`.
- **Frontend en Cloudflare Pages**: `overlays.korugames.lat`.
- **Anonymous user_id** generado del hostname con SHA256 (NO usa username del SO).
- **Migración automática** de IDs viejos que exponían el username.
- **Throttled error log**: 3 errores → silencio.
- **Para agregar overlay nuevo**: solo `OVERLAY_REGISTRY` + assets HTML/JS/CSS.
- **`<id>_config` event** para live update sin recargar.

### Minigames
- **3 minijuegos**: WordSearch (estándar), WordSearchLite, WordBomb.
- **19 categorías de palabras** confirmadas.
- **WordBomb bonus life**: completar abecedario A-Z.
- **`spanish_words.py`** (1243 líneas) — diccionario completo para validar.
- **Stats persistentes** en `minigame_stats.json`.

### Infra
- **Particionado de config en 4 archivos** (`config.json + gifts.json +
  games.json + profiles.json`) para no reescribir 102KB cada cambio.
- **`os.fsync` + atomic rename** evita corrupción.
- **Migración automática** del config.json legacy monolítico al boot.
- **Logger central** con rotación 2MB × 5 archivos.
- **`KNOWN_GOOD_VERSIONS`** de TikTokLive para rollback rápido.

## Total `core/`: ~10000 líneas de lógica de negocio

Distribución:
- TikTok / RuleEngine / Games: **1907 líneas** (orquestación principal).
- TTS / IA: **1515 líneas** (audio + IA).
- Social system: **2776 líneas** (sistema social completo).
- Spotify: **1652 líneas** (anti-rate-limit complex).
- Minigames: **1944 líneas** (lógica + diccionario).
- Overlays: **270 líneas**.
- Infra (paths/logger/config_store/version_checker): **434 líneas**.

## Implicaciones para el port

1. **Sidecar Python mantiene `core/` completo**, prácticamente sin cambios.
2. **Bridge JSON-RPC**: el renderer de Electron pide acciones al sidecar
   y recibe events.
3. **Cambios necesarios mínimos**:
   - Reemplazar `pyqtSignal` por callbacks/yield/queues estándar.
   - Reemplazar `QThread` por `threading.Thread` o `asyncio.Task`.
   - Spotify OAuth callback puerto 8888 → considerar configurable.
4. **Ningún módulo de core/ se reescribe** — todos se preservan.
5. **Sí se reescribe**: la GUI completa (PyQt → React).
