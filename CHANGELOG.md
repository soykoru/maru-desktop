# Changelog — maru-desktop

## 1.0.25 — 2026-05-01 · 🪲 Cambios revertidos al click afuera (social, custom games)

Tres bugs raíz que producían la misma sensación de "edité algo, click
afuera y se revirtió". Las tres atacadas en su origen:

### Raíz A — `_user_to_dto` reventaba con `racha` como dict

El SocialSystem core devuelve los usuarios en **dos formatos distintos**
según el método admin que los emita:
- `admin_get_all_users()` → `racha=int` (flat, transformado).
- `admin_get_user_data(user)` → `racha={"dias":N, "ultimo":..., "record":N}`
  (nested dict crudo).

El DTO en el sidecar (`backend/social.py:_user_to_dto`) hacía
`int(raw.get("racha"))`. Con la forma nested, `int({"dias":5})` lanza
`TypeError`. El RPC `social.users.get` (que se llama tras cada
`set-racha` para refrescar la UI) crasheaba → la promesa rejectaba en
el frontend → el `editingCells[key]` se borraba en `onBlur` → el cell
mostraba el `val` viejo del array `users` no actualizado → parecía que
"se revertía". Idem `record_racha`, `auto_racha`, relaciones y stats
con sus formas nested.

Fix: nuevo `_safe_int(v)` (tolerante a None/dict/str) + lectura del DTO
que entiende **ambas formas** del core (flat de `admin_get_all_users` y
nested de `admin_get_user_data`). Cubre `racha/record_racha`,
`auto_racha` (3 formas: `auto_racha` renderer, `racha_automatica` core
nested, flags flat), relaciones (`marriage`/`casado_con`/`casado`,
etc.) y stats (`duelos_ganados` flat o nested en `stats`).

### Raíz B — `Dialog` cerraba al click afuera SIN avisar

`packages/ui/src/components/Dialog.tsx` tenía `onClick={onClose}` en el
backdrop wrapper. **Cualquier** click fuera del card del dialog
disparaba `onClose` directamente, perdiendo todo el draft local del
formulario sin pedir confirmación. Idem Escape.

Fix: dos props nuevos en `Dialog`:
- `unsavedChanges?: boolean` — cuando `true`, click-afuera y Escape
  piden confirmación con `window.confirm("Tenés cambios sin guardar.
  ¿Cerrar igual y perderlos?")`. Si el user cancela, el dialog queda
  abierto con sus ediciones intactas. Default `false` (compat — los
  diálogos read-only no se ven afectados).
- `dismissOnBackdrop?: boolean` — opt-in para deshabilitar
  click-backdrop completamente (default mantiene el comportamiento
  actual). Cuando `unsavedChanges=true` y este prop NO se pasa, se
  fuerza a `false` automáticamente — la pérdida accidental de
  ediciones es muy alta para tolerarla.
- El botón X y Escape pasan por `attemptClose()` que hace el confirm.

Cableado en:
- `SocialConfigDialog` → `unsavedChanges={dirty}`.
- `CustomGameDialog` → `unsavedChanges={dirty && !busy}`. Se calcula
  comparando un snapshot inicial (al abrir) contra el state actual
  (id, name, icon, host, port, password, connectionType, categories,
  shareSounds, shareVoices, tabNames). El snapshot se reinicia al
  cambiar el `editing` o reabrir el dialog.

### Raíz C — Botón "Guardar" no se ponía amarillo

En `SocialConfigDialog` ya había indicador "● Cambios sin guardar"
pero el botón Save quedaba siempre azul. En `CustomGameDialog` no
había indicador alguno. Ambos diálogos ahora:
- Muestran "● Cambios sin guardar" en `text-warning` en el footer
  cuando hay diff.
- El botón Save se pinta de **amarillo** (`!bg-warning !text-bg`) y
  queda disabled cuando NO hay cambios (no tiene sentido guardar lo
  mismo).

### Archivos tocados

- `apps/sidecar/maru_sidecar/backend/social.py` — `_safe_int` +
  `_user_to_dto` reescrito para soportar ambas formas del core.
- `packages/ui/src/components/Dialog.tsx` — props
  `unsavedChanges` + `dismissOnBackdrop` + `attemptClose()` con
  confirm.
- `apps/desktop/src/renderer/components/dialogs/social/SocialConfigDialog.tsx`
  — `unsavedChanges={dirty}` + Save amarillo.
- `apps/desktop/src/renderer/components/dialogs/games/CustomGameDialog.tsx`
  — snapshot inicial + cálculo de `dirty` + indicador en footer +
  Save amarillo.

### Verificación esperada

- En tab Usuarios del Social: editar racha de alguien → se queda
  guardada al click-afuera del input (no se revierte).
- En SocialConfigDialog: editar algo + click fuera del dialog →
  pregunta "¿Cerrar igual y perderlos?". Cancelar mantiene el draft.
- En CustomGameDialog: editar nombre de categoría + click fuera →
  pregunta antes de cerrar. Botón Save se pone amarillo + indicador
  "● Cambios sin guardar".
- Diálogos read-only sin draft (Logs, Datos en preview, etc.) → no
  cambian su comportamiento (no pasan `unsavedChanges`).

## 1.0.24 — 2026-05-01 · 👑 PlayFan se sincroniza solo con los Super Fans del live

### Cambio de modelo

La lista de "Usuarios prioritarios (PlayFan)" deja de ser editada
manualmente. Ahora **se sincroniza en vivo** con los Super Fans reales
del live de TikTok (flag `is_super_fan` que viene en cada
comment-enriched). El usuario solo edita cuántos `!playfan` puede hacer
cada uno por día — la pertenencia a la lista la maneja el sidecar.

### Detección automática

- Cuando llega un comment con `is_super_fan=True` → el user se agrega
  a la lista (o se refresca su `lastSeenMs` si ya estaba) y se le
  asigna automáticamente el `playfan_default_uses` configurado (5 por
  defecto).
- Cuando llega un comment con `is_super_fan=False` (ya no es Super Fan
  porque venció la suscripción) → el user se quita inmediatamente de
  la lista de PlayFan.
- La lista se persiste en `data/spotify.json` (`super_fans` map con
  firstSeenMs / lastSeenMs / displayName) y se mantiene entre
  sesiones.

### Sidecar

- `apps/sidecar/maru_sidecar/backend/spotify.py`:
  - `notify_super_fan(username, is_super_fan, display_name)` —
    hook idempotente. Persiste solo si hay cambios reales (no escribe
    el JSON con cada comment de un super fan activo: throttle 5min
    para refresh de `lastSeenMs`).
  - `super_fans_list({})` → devuelve `[{username, displayName,
    firstSeenMs, lastSeenMs, uses}]` ordenado por `lastSeenMs` desc.
  - `super_fan_set_uses({username, uses})` y `priority_user_set` →
    valida que el user EXISTA en `super_fans` antes de aceptar; si
    no, devuelve mensaje claro. Actualiza `priority_users` y se
    aplica al `SpotifyClient` en vivo (`set_priority_users`) sin
    esperar al próximo `config_set`.
  - `priority_user_remove` → marcado como deprecado: devuelve
    no-op con mensaje explicando que la pertenencia es automática.
  - `playfan_default_set({uses})` → setea el `uses/día` por defecto
    para super fans nuevos.
- `apps/sidecar/maru_sidecar/backend/tiktok.py`:
  - Nueva inyección `attach_spotify(spotify)`.
  - `_cache_ranks` llama `spotify.notify_super_fan(...)` cuando el
    comment-enriched trae el flag `is_super_fan` explícito.
- `apps/sidecar/maru_sidecar/rpc/registry.py`:
  - `tiktok_svc.attach_spotify(spotify_svc)` cableado al boot.
  - 3 RPCs nuevos: `spotify.super-fans.list`,
    `spotify.super-fans.set-uses`, `spotify.playfan-default.set`.

### UI

`SpotifyConfigDialog` — sección PlayFan rediseñada:
- Sin input para agregar usuarios manualmente.
- Sin botón "X" para quitar usuarios.
- Cada super fan se ve como una row con avatar 👑, displayName,
  username, "última actividad: hace 5m" y un único input numérico
  editable: `uses/día` (auto-save on change).
- Banner azul con `Sparkles` explica el comportamiento automático.
- Field "Default para super fans nuevos" con auto-save al editar.
- Empty state cuando no hay super fans aún ("Cuando alguien
  suscriptor del live deje un comentario, va a aparecer acá").
- Botón Refresh manual + auto-poll cada 30s mientras el dialog
  está abierto.
- `useSpotify` ahora expone `superFans`, `defaultUses`,
  `refreshSuperFans`, `setSuperFanUses`, `setPlayfanDefaultUses`.

### Tipos

- `SpotifyConfig.playfan_default_uses?: number` — nuevo campo
  opcional para compat con configs antiguas.
- `SpotifySuperFan` — nuevo type compartido.

### Archivos tocados

- `apps/sidecar/maru_sidecar/backend/spotify.py`
- `apps/sidecar/maru_sidecar/backend/tiktok.py`
- `apps/sidecar/maru_sidecar/rpc/registry.py`
- `packages/shared/src/types/index.ts`
- `apps/desktop/src/renderer/lib/use-spotify.ts`
- `apps/desktop/src/renderer/components/dialogs/spotify/SpotifyConfigDialog.tsx`

## 1.0.23 — 2026-05-01 · 🪲 TTS duplicado en `!racha`/`!suerte` y demás comandos

### Bug raíz (sin parche cosmético — fix en la fuente)

Todo `!cmd` que llega del live de TikTok hablaba **2 veces** por TTS:
`!racha`, `!suerte`, `!ia`, `!love`, `!duelo`, `!ranking`, `!perfil`,
`!matrimonio`, etc. El bot de comentarios (texto libre sin `!`) no
duplicaba — esa fue la pista para encontrar la causa.

**Causa**: `core/tiktok_client.py` emite **DOS** señales `event_received`
para el mismo `!cmd` recibido del WebSocket:
1. `comment` con el texto completo (`{"text": "!racha", "user": ...}`)
2. `command` con el cmd parseado (`{"command": "racha", "user": ...}`)

Comportamiento heredado del MARU original que la GUI antigua manejaba
(probablemente filtraba con un flag in-window). El sidecar nuevo
`ChatDispatcher` se suscribe a `tiktok:event` y procesa **ambos**:
- `comment` → `_handle_comment` → matchea `_CMD_RE` → `_handle_command`
- `command` → `_dispatch_sync.elif evt_type == "command"` → `_handle_command`

Resultado: cada handler social/IA/fortuna se ejecuta 2 veces, lo que se
percibe como TTS hablando 2x. `!play` parecía inmune sólo porque el
cooldown interno de `SocialSystem._cmd_music` silencia la 2ª ejecución;
los demás comandos no tienen cooldown propio.

La dedupe text-based que ya existía en `social._tts_callback` no salvaba
el caso porque corre en threads paralelos sin lock — race condition: dos
threads leen `_last_tts_call` antes de que ninguno lo actualice y ambos
proceden a hablar.

### Fixes (3 capas de defensa, no parche cosmético)

**Capa 1 — corte en la fuente** (`chat_dispatcher.py`):
- Nuevo `_is_duplicate_cmd(user, cmd, args, window=2.5s)` — chequeo +
  set atómico (`threading.Lock`) sobre un dict `(user, cmd, args)` →
  `last_seen`. GC al pasar 200 entries.
- `_handle_command` arranca con `if self._is_duplicate_cmd(...): return`,
  cubriendo ambos paths (comment-derived y command-derived).
- Comments libres sin `!`, eventos del simulador y comandos
  legítimamente repetidos por encima de 2.5s pasan sin interferencia.

**Capa 2 — dedupe específica fortuna por gift** (`chat_dispatcher.py`):
- `_read_fortune` dedupea per-user en ventana 30s.
- Sin esto, un gift con `repeat_count=10` (streak típico) hacía leer
  10 fortunas seguidas porque el core emite N events de gift.
- 30s = espacio suficiente para que la siguiente fortuna del mismo
  user requiera un nuevo gift no inmediato.

**Capa 3 — defensa en TtsService** (`tts.py`):
- `speak()` dedupea `(channel, text[:120])` en ventana 1.5s (atómico
  con lock + GC al pasar 400 entries).
- Atrapa CUALQUIER camino paralelo que se haya colado por debajo de
  las dedupes superiores (futuros emisores, RPC manual, race
  conditions del SocialSystem). El bot literalmente no puede decir lo
  mismo en el mismo canal dos veces dentro de 1.5s.
- `tts.test()` y `_music_speak` de social NO pasan por aquí (usan
  `e.speak_now` directo) → el botón "Probar" sigue funcionando para
  pruebas repetidas.

**Capa adicional ya existente — `social._tts_callback`**:
- Sigue dedupeando por texto[:120] en ventana 1.5s, pero ahora bajo
  `_last_tts_lock` (race fix de la implementación previa).

### Verificación esperada

- `!racha`/`!duelo`/`!matrimonio`/`!perfil`/`!ranking`/`!love` en
  vivo → narración 1 vez.
- `!suerte`/`!fortuna`/`!tarot` en vivo → fortuna leída 1 vez.
- `!ia hola` en vivo → respuesta hablada 1 vez.
- Gift que dispara fortuna (con `repeat_count=10`) → fortuna 1 vez,
  no 10.
- Dos `!racha` del MISMO user >2.5s aparte → ambos disparan.
- Otro user con el mismo cmd a la vez → ambos disparan (key incluye
  user).
- Simulador comment con `!racha` → narración 1 vez.
- Simulador command cmd=`racha` → narración 1 vez.
- Texto libre del chat sin `!` → TTS chat 1 vez (no afectado).
- Botón "Probar voz" → suena cada click (usa `tts.test`/`speak_now`,
  no pasa por la dedupe).

## 1.0.22 — 2026-05-01 · 🪲 LogPanel: filtros funcionando de verdad

### Bug raíz (fix profundo, no parche)

Los pills de **Likes / Regalos / Follows / Shares / Emotes / Comandos /
Música / IA / Audio / Subs** eran *adorno*: ningún evento real se
dejaba filtrar por ellos. Solo los pills "Comentarios", "Sistema",
"Reglas" y "Errores" funcionaban. Causas:

1. `tiktok.py:_on_log_message` reenviaba TODOS los logs del worker (los
   `❤️ ...`, `🎁 ...`, `➕ ...`, `📤 ...`, `🎨 ...`) con
   `category="tiktok"` **forzado** en `LogsService.publish`. Eso
   bypaseaba el detector regex de `detect_category` que sí los hubiera
   clasificado como `like`/`gift`/`follow`/`share`/`emote`. Resultado:
   todo evento en vivo terminaba en categoría `tiktok` y solo aparecía
   bajo el pill "Sistema".
2. `tiktok.py:_on_comment_enriched` publicaba TODA línea del chat con
   `category="comment"` hardcoded — incluso cuando era un comando
   `⌨️ !cmd de @user`. El pill "Comandos" jamás filtraba comandos del
   live.
3. `LogsBridgeHandler.emit()` (root logger → LogsService) no
   asignaba categoría: dependía del `detect_category` que match-eaba
   por **keywords azarosos del mensaje** (`spotify`, `tts`, `ia`...).
   Si un log decía "queue updated" sin la palabra "spotify",
   terminaba en `system` en vez de `music`. Lo mismo con `tts`,
   `sounds`, `ia`, `social`, `emotes`, `donations`, `profiles`.
4. No había regla regex para `subscribe` (⭐) → el pill "Subs" tampoco
   funcionaba ni siquiera para el simulador.
5. El pill "Acciones" era huérfano: ningún emisor publica con
   `category="action"` en producción.

### Fixes

- `apps/sidecar/maru_sidecar/backend/tiktok.py:_on_log_message`: pasa
  `category=None` y deja que `detect_category` clasifique por
  emoji-prefix (`🎁`→gift, `❤️`→like, `➕`→follow, `📤`→share,
  `🎨`→emote).
- `apps/sidecar/maru_sidecar/backend/tiktok.py:_on_comment_enriched`:
  categoría dinámica según el contenido — `⌨️` → `command`, sino
  `comment`.
- `apps/sidecar/maru_sidecar/backend/logs.py`:
  - Agregado regex `^⭐|se suscrib|new subscriber` → `subscribe`.
  - `LogsBridgeHandler.emit` ahora asigna categoría por **nombre
    del logger Python** (`maru_sidecar.backend.spotify` → `music`,
    `.tts` → `tts`, `.sounds` → `sound`, `.ia` → `ia`,
    `.social` → `social`, `.emotes` → `emote`, `.donations` → `gift`,
    `.profiles` → `profile`, `.rules` → `rule`,
    `.chat_dispatcher` → `command`, etc.). También cubre el `core.*`
    cuando el bridge está cargado. Sin el match → cae al detector
    regex original (compat).
  - Errores y warnings (level >= ERROR / == WARNING) se categorizan
    SIEMPRE como `error`/`warn` independiente del source — el pill
    "Errores" ahora atrapa todo lo que el user necesita ver.
- Renderer: removido el pill huérfano "Acciones". El pill "Reglas"
  ahora cubre `rule` + `action` (eran funcionalmente equivalentes:
  el rule_dispatcher loguea cada ejecución con `cat="rule"`).

### Resultado

Los 15 pills del filter bar (antes 16, sin "Acciones") filtran lo
que su nombre dice. La siguiente tabla resume qué fuente alimenta
cada pill (verificado contra emisores reales, no inferido):

| Pill | Categorías | Fuente real |
|---|---|---|
| Comentarios | `comment` | tiktok.comment_enriched, simulator |
| Comandos | `command` | tiktok.comment_enriched (`!cmd`), chat_dispatcher, simulator |
| Regalos | `gift` | tiktok.log_message (`🎁`), donations, simulator |
| Emotes | `emote` | tiktok.log_message (`🎨`), emotes service |
| Follows | `follow` | tiktok.log_message (`➕`), simulator |
| Likes | `like` | tiktok.log_message (`❤️`), simulator |
| Shares | `share` | tiktok.log_message (`📤`), simulator |
| Subs | `subscribe` | simulator + cualquier `⭐` o "se suscribió" |
| Reglas | `rule`, `action` | rule_dispatcher (cada regla disparada) |
| Social | `social` | social service, minigames |
| Música | `music` | spotify service (cualquier log) |
| IA | `ia` | ia service, fortunes |
| Audio | `tts`, `sound` | tts service, sounds service |
| Sistema | `system`, `tiktok`, `profile` | conexión, profiles, defaults |
| Errores | `error`, `warn` | TODO error/warning sin importar el origen |

## 1.0.17 — 2026-04-29 · 🎨 Log profesional + fixes de duplicados restantes + Spotify charmap

### Panel de log redesignado

`apps/desktop/src/renderer/components/log/LogEntryRow.tsx` reescrito:
- Stripe vertical 2px a la izquierda con color por categoría (azul=chat,
  amarillo=gift, verde=follow/social, rojo=like/error, accent=rule/action,
  etc.). De un vistazo se ve qué tipo de evento es.
- Tinte de fondo sutil para categorías "fuertes" (gift, error, warn,
  rule/action). Las entradas de regalos ahora destacan sin gritar.
- Badge `ERR`/`WRN`/`DBG` solo cuando aplica (INFO no muestra badge,
  reduce ruido visual).
- `@username` resaltado en color accent + bold.
- Chips para prefijos de rangos `[mod]`, `[member L3]`, `[G5]` etc.
  (en vez de quedar como texto plano del mensaje).
- Hover suave con micro-incremento de opacidad en timestamp.

### Fix: racha y otros eventos sociales aparecían 2 veces

Con el listener leak resuelto en v1.0.16 quedaba un duplicado más:
`SocialSystem._cmd_racha → log("📢 RACHA TTS resultado")` pasaba por
**dos** rutas hacia el panel:
1. `_logs.publish(source="social")` (el callback explícito).
2. `log.info(text)` → root logger → `LogsBridgeHandler` → publica con
   `source="maru_sidecar.backend.social"`.

Como el dedupe usa `(level, source, message)` y los `source` difieren,
los DOS pasaban. Fix:
- `apps/sidecar/maru_sidecar/backend/social.py:_log_callback` ya no
  llama a `log.info(text)`.
- Adicionalmente, `LogsService.publish` ahora dedupea con **dos
  ventanas**: la estricta `(level, source, message)` en 2s y una más
  amplia `(level, message)` en 200ms para atrapar este patrón en
  cualquier otro componente que tenga la misma estructura.

### Fix: reglas que disparan 30 lineas idénticas

`RuleDispatcher._dispatch_sync` publicaba `log:entry` directo al
EventBus (saltando dedupe + buffer). Cuando 15 reglas matcheaban un
mismo `like` event con misma acción `max_stamina`, salían 15 lineas
idénticas en el panel.

Fix: `RuleDispatcher.attach_logs(logs_svc)` y publicaciones via
`self._logs.publish(...)` → ahora pasan por dedupe (mismo mensaje en
<2s se colapsa) y aparecen en el buffer hidratable.

### Fix: error `'charmap' codec can't encode character '\U0001f3b5'`

`apps/sidecar/maru_sidecar/__main__.py` ahora reconfigura `sys.stdout`
y `sys.stderr` a UTF-8 al booear (antes de cualquier import que pueda
escribir). En Windows con `cp1252` por default, el primer emoji 🎵 que
imprimía spotipy/SocialSystem reventaba el StreamHandler. Combinado
con `PYTHONIOENCODING=utf-8` que ya pasa el spawn de Electron, garantiza
0 errores de encoding aunque el entorno del usuario sea cp1252.

## 1.0.16 — 2026-04-29 · 🩹 Fix raíz: logs duplicados (listener leak)

### Bug eliminado: cada entry del panel aparecía 2 veces

`bootSidecar()` en `apps/desktop/src/main/index.ts` llamaba
`attachRpcClient(rpc, mainWindow)` **dos veces** (una antes y otra
después del boot del sidecar). Cada call hacía `client.on(evt, ...)`
sobre el mismo `RpcClient` (EventEmitter de Node) sin remover los
listeners anteriores → cada `log:entry`, `tiktok:event`, `gifts:updated`,
etc. se forwardeaba **2 veces** al renderer → cada entry aparecía 2x en
el panel del log.

### Fix aplicado en `apps/desktop/src/main/ipc.ts`

- `attachRpcClient` ahora retiene refs a los listeners agregados (array
  `attachedListeners: {event, fn}[]`).
- Antes de re-attachar, recorre el array y llama `activeClient.off(event, fn)`
  para remover cada listener viejo.
- `detachRpcClient` también limpia los listeners para evitar leak en
  shutdown.

### Por qué la dedupe del backend no lo cubría

`LogsService.publish()` tiene una ventana de dedupe de 2 segundos por
`(level, source, message)`. **No podía** prevenir este duplicado: la
duplicación ocurría DESPUÉS del backend, en el forwarding IPC de
main → renderer. Cada entry duplicada era una IPC message distinta —
no una republicación del backend.

### Verificación post-build

- `attachRpcClient` minificado en bundle: `function q(n,e){if(P)for(const{event:r,fn:i}of k)P.off(r,i);k=[],P=n;...}` ✓
- `app.asar` contiene `"version": "1.0.16"` ✓

## 1.0.0 — 2026-04-28 · 🎉 G14 release final (TikTok + Spotify + integración)

### Cierre del Plan G — MARU Desktop v1.0.0 listo para uso

> **14 fases en 2 días** (G0..G14, G13 skipped por decisión del usuario).
> Total: **149 RPC methods**, ~30 dialogs/componentes nuevos, paridad
> 100% al MARU original PyQt + UX premium reescrita en Electron + React.

### G14 — TikTok Live + Spotify completo + integración E2E

#### TikTok UI cableado (G14.0)
- **Sidebar TikTok GroupBox 100% funcional**:
  - Input username controlado con disable cuando conectado.
  - Botón Conectar/Desconectar dispara `tiktok.connect/disconnect`
    real con loading + estado.
  - StatusDot con color real según `tiktokStatus`
    (disconnected/connecting/connected/error).
  - Stats live: 3 contadores (likes ❤️ · viewers 👁 · diamonds 💎)
    leídos del store (push events `tiktok:stats`).
  - Banner de error rojo cuando hay `tiktokError`.
  - Enter en el input dispara connect.

#### SpotifyService ampliado (G14.1)
- **REESCRITO**: `apps/sidecar/maru_sidecar/backend/spotify.py`. De 5
  RPC methods → **19 RPC methods** con persistencia + cuentas + queue +
  devices.
- **Persistencia**: `data/spotify.json` con `{config, priority_users}`.
  Atomic write.
- **Config persistido**: enabled, max_queue (1-50), tts_enabled,
  device_id, enabled_commands (5: play/skip/cola/pause/playfan),
  priority_users `{username: daily_uses}`.
- **6 nuevos endpoints**: connect/disconnect (con credenciales OAuth),
  queue.list/clear/remove, devices.
- **4 endpoints de cuentas**: list/save/load/delete (delegado a
  `SpotifyClient.list_accounts/save/load/delete` del core).
- **2 endpoints de priority users**: set (con uses 0-50) / remove.
- **`status` extendido** con `available` (core disponible) +
  `rateLimited`.
- **Tolerante a core no disponible**: todos retornan shape válido.

#### Shared types Spotify (G14.2)
- **NUEVOS**: `SpotifyAccount`, `SpotifyDevice`, `SpotifyQueueItem`,
  `SpotifyStatus`, `SpotifyConfig`, `SpotifyCommandId`.
- **`SpotifyNowPlaying.requestedBy`** opcional (paridad MARU).
- **19 RPC methods tipados** en `SpotifyMethods` (era 5).

#### Renderer state (G14.3)
- **NUEVO**: `lib/store/spotify-slice.ts` — global con status + now +
  queue + devices + accounts + config + loadStatus.
- **NUEVO**: `lib/use-spotify.ts` — hook con `loadAll` parallel, refresh
  granular (status/now/queue/devices/accounts), poll de now-playing
  conservador 45s (paridad MARU dev mode rate-limit safe), CRUD
  cuentas/queue/priority users con confirm.

#### SpotifyConfigDialog (G14.4 — xl)
- **NUEVO**: réplica del tab Spotify del `social_config.py` MARU.
- 6 secciones: Master switch + Credenciales OAuth (con guía colapsable
  de 7 pasos para Spotify Dashboard) + Cuentas guardadas (combo + load/
  save/delete) + Devices (combo refresh) + Reproducción (now playing
  banner + controles play/skip/toggle + queue table con ⭐ priority
  badge) + Configuración (max queue + tts + 5 comandos toggleables) +
  Priority users (table + add).
- Redirect URI con botón copy al portapapeles.
- Status header dinámico: "🟢 Conectado como X" / "⏳ Rate limit" /
  "⚪ No conectado".

#### Cableado (G14.5)
- Nuevo modal id `'spotify-config'` en `ui-slice.ts`.
- Cableado en `ModalRoot`.
- Sidebar: nuevo botón "🎵 Spotify" con icon `Music` en GroupBox
  Configuración (entre IA y TikTok API).

#### Push events integración (G14.6)
- **`tiktok:event` → log entry sintético** automáticamente:
  el renderer recibe el evento, lo pushea al feed Y crea un `LogEntry`
  estructurado para el `LogPanel` (con categoría correcta:
  gift/follow/share/like/comment/command).
- **`spotify:now-playing` push event** cableado al store
  (futuro: el sidecar lo emite cuando hay cambios).
- **`spotify:status` push event** cableado para reflejar reconnect/
  disconnect en vivo.

#### Smoke + bump 1.0.0 (G14.7)
- ✅ **149 RPC methods totales** (era 135 antes de G14, +14 spotify
  nuevos).
- ✅ TikTok: 3 RPC + 4 push events ya funcionando desde G1.
- ✅ Spotify: 19 RPC + 2 push events.
- ✅ 0 errores TS en archivos G14.
- ⚠️ 6 errores TS preexistentes en `packages/ui` (heredados F0 — ver
  caveat al final).
- Sidebar subtítulo bumpeado a "Chaos Engine v1.0.0".

### Mejoras vs MARU original (acumuladas en todo el Plan G)

- **Multi-cuenta Spotify** persistido server-side.
- **Stats TikTok live** en sidebar (era hardcoded 0).
- **Push events** para todo (TikTok, log, Spotify, IA, TTS) — el
  original polleaba.
- **Tolerancia a core no disponible** en TODOS los services
  (Sidebar/Sounds/Minigames/Spotify/etc devuelven shape válido).
- **Persistencia propia del sidecar** para 8 archivos JSON
  (`gifts.json`, `voices.json`, `ia.json`, `social_data.json`,
  `sounds_*.json`, `minigames.json`, `spotify.json`, `games.json` v2).
- **Snapshot completo** en profiles incluye los 8 archivos.

### Caveats / pendientes para v1.x

1. **6 errores TS en `packages/ui`** heredados desde F0 (deps
   `lucide-react` y `@maru/shared` no declaradas como deps directas en
   el package.json del paquete UI). Plan: agregar como peer dependencies
   en `packages/ui/package.json` en una próxima patch release —
   **no afectan runtime ni build, solo `tsc --noEmit`**.
2. **G13 (overlays)** skipped por decisión del usuario. El sidecar
   mantiene `OverlaysService` registrado por si se reactiva.
3. **TikTok API check** (rollback de versiones, KNOWN_GOOD_VERSIONS) —
   queda para v1.1: el TikTokWorker del core ya tiene la lógica, falta
   exponerla por RPC dedicado.
4. **Spotify auto-reconnect al boot** del sidecar: el `try_auto_connect`
   está en `_ensure_client`, pero conviene mover a un init explícito
   que emita `spotify:status` al renderer.
5. **Hot-reload tras restore profile**: el modal lo advierte como
   "necesita reinicio". v1.1 puede agregar reload selectivo (TTS engine,
   IA config) sin restart completo.

### Bump versión: 1.0.0-beta.7 → **1.0.0** (release final, drop -beta)

---

## post G12 + G13 SKIP — 2026-04-27

### G13 SKIPPED — Overlays deshabilitado por decisión del usuario

- Removido botón "Overlays" del `Sidebar` (icon `Tv2` también quitado).
- Quitado `'overlays-manager'` del union `ActiveModal` en `ui-slice.ts`.
- Limpio `MODAL_META` en `ModalRoot.tsx` (entry G13 fuera).
- **El sidecar mantiene `OverlaysService` registrado** con sus 3 RPC
  methods (`overlays.list/update/test-event`) — total RPC sigue en
  **135**. Si en el futuro se quiere re-habilitar:
  1) Agregar `'overlays-manager'` de vuelta al union ActiveModal.
  2) Crear el `OverlaysDialog` y cablearlo en `ModalRoot`.
  3) Agregar el botón en el Sidebar.
- Sin bump de versión — es una sustracción quirúrgica, no nueva
  funcionalidad. Próxima fase: **G14** (TikTok + Spotify + integración +
  QA → v1.0.0 REAL).

---

## 1.0.0-beta.7 — 2026-04-27 · 🟢 G12 backup manager (paridad MARU + premium)

### G12 — Backup Manager con reason taxonomy + auto pre-restore

#### Sidecar — BackupService extendido (G12.0)
- **Reason taxonomy** — agregado al `BackupEntry`:
  `manual | pre_load | prerestore | pre_import | auto`. Persiste en
  `backups/index.json`. Cualquier string fuera del set es válido (UI
  fallback gris).
- **`reason='prerestore'` automático** antes de cada `restore()` —
  defensa en profundidad (paridad MARU `_REASON_MAP`). Best-effort:
  si el pre-backup falla, el restore continúa con warning.
- **`MAX_BACKUPS_PER_SCOPE` reducido a 7** (paridad MARU original; antes
  estaba en 20). Rotación FIFO automática.
- **`filesCount` + `sha256`** ahora en el DTO `to_dict` (antes solo
  internos).
- **Nuevo `backups.last(scope?)`** RPC — devuelve el último backup
  creado opcionalmente filtrado por scope. Útil para el footer del
  BackupDialog ("Último: Manual · Reglas · hace 5min").
- **`backups.restore` mejorado**: acepta `autoPreBackup: boolean` (default
  true). Devuelve `{ok, restoredScope, restoredId, preBackup: BackupEntry|null}`
  para que la UI pueda mostrar info del pre-backup creado.

#### Shared types (G12.1)
- **NUEVOS**: `BackupScope`, `BackupReason` (union literal + string
  escape).
- **`BackupEntry` extendido**: `reason?`, `filesCount?`, `sha256?`,
  `label` ahora puede ser `null`.
- **6 RPC tipados** `backups.*` (era 4) — `backups.last` agregado, los
  shapes existentes extendidos (`autoPreBackup`, `preBackup`).

#### Renderer state (G12.2)
- **NUEVO**: `lib/store/backups-slice.ts` — global con backups[] +
  status + scopeFilter + selectedId + lastBackup.
- **NUEVO**: `lib/use-backups.ts` — hook con `loadAll` (parallel list +
  last), CRUD optimista, restore con confirm + auto-pre-backup default.

#### Componentes (G12.3)
- **NUEVO**: `components/dialogs/backup/BackupDialog.tsx` (lg).
- **Toolbar**: filter scope + scope selector para crear + botón Crear +
  refresh.
- **Banner explicativo** sobre rotación FIFO max 7 y pre-restore auto.
- **Lista de cards** con icon por reason (paridad colores MARU `_REASON_MAP`):
  💾 manual (verde), 📂 pre_load (azul), 🛡️ prerestore (warning), 📥
  pre_import (accent), ⚙️ auto (gris).
  Cada card: emoji + datetime + Badge reason + Badge scope + sub line
  (filesCount + size + age) + sha256 prefix.
- **Action buttons por fila**: Restaurar (primary) + Eliminar (ghost).
- **Confirm restore** con detalle: scope, archivos, advertencia de
  pre-backup automático y necesidad de reinicio.
- **Confirm delete** con warning irreversible.
- **Footer info**: "Último: Manual · Reglas · hace 5min".

#### Cableado en ModalRoot (G12.4)
- `'backup'` modal id ya en `ui-slice.ts` desde G1 — solo wiring.
- Sidebar ya apunta al modal desde G1.

#### Smoke G12.4 (resultados)
- ✅ **135 RPC methods totales** (era 134), +1 `backups.last`.
- ✅ Lifecycle BackupService: create con `reason` + label · list ·
  list filtered by scope · `last` global y por scope · restore con
  pre-backup automático (verifica que se creó con `reason='prerestore'`)
  · restore con `autoPreBackup=false` (no crea pre) · delete · scope
  inválido rechazado.
- ✅ 0 errores TS en archivos G12 (corregidos 5 errores `noUncheckedIndexedAccess`
  con helpers `reasonMeta`/`scopeMeta` antes del cierre).
- ⚠️ 6 errores TS preexistentes en `packages/ui` (heredados F0, → G14).

### Mejoras vs MARU original

- **Reason taxonomy persistida** — el original solo mostraba `reason`
  visual pero no lo guardaba en metadata. Ahora se persiste y permite
  filtrar/auditar.
- **Auto pre-restore** — el original solo lo prometía en el modal; el
  sidecar G12 lo implementa real con cleanup parcial si falla.
- **`backups.last`** RPC dedicado para el footer info — el original
  iteraba toda la lista cada vez.
- **`autoPreBackup: false`** opt-out para tests/CI.
- **Filter scope** en la UI — el original mostraba todo mezclado.
- **SHA256 visible** en cada card — útil para auditar drift.
- **MAX_BACKUPS_PER_SCOPE** = 7 (paridad MARU recuperada; antes
  inflado a 20 por el F0 inicial).

### Bump versión: 1.0.0-beta.6 → 1.0.0-beta.7

---

## 1.0.0-beta.6 — 2026-04-27 · 🟢 G11 simulador real + log widget pro

### G11 — Simulador + Log estructurado (paridad MARU + UX premium)

#### Sidecar — LogsService refactor (G11.0)
- **REESCRITO**: `apps/sidecar/maru_sidecar/backend/logs.py` (de 31 a
  ~290 LoC). De 1 RPC method (`tail` raw) → **7 RPC methods** con
  buffer estructurado.
- **19 categorías canónicas** (paridad MARU): system, tiktok, gift,
  follow, share, like, comment, command, rule, action, social, music,
  ia, tts, sound, profile, error, warn, debug.
- **Detección automática** vía 15 reglas regex + fallback al level
  (paridad K13 — "12 reglas" del audit, agregamos 3 más para coverage).
- **Buffer circular max 500** (`collections.deque(maxlen=500)`) con
  trim automático.
- **Stats por categoría** + total — incrementadas en cada `publish`.
- **Push event `log:entry`** al EventBus → llega al renderer en tiempo
  real sin polling.
- **`hydrate-from-file`** carga las últimas N líneas del `sidecar.log`
  para tener contexto inmediato al boot.
- **Filtros server-side**: categories[], levels[], query (case-insensitive
  en message).

#### Shared types (G11.1)
- **NUEVOS**: `LogCategory` (19), `LogLevel`, `LogGroup` (8 grupos
  visuales), `LogEntry` (id, ts, level, source, category, message,
  meta), `LogStats`, `SystemHealthIndicator`.
- **+6 RPC tipados** (`logs.list/stats/clear/reset-stats/categories/
  hydrate-from-file`).

#### Renderer state (G11.2)
- **NUEVO**: `lib/store/log-slice.ts` — entries con trim 500, stats,
  filters Set<LogGroup>, search, autoScroll flag, unreadCount,
  showTimestamps.
- **NUEVO**: `lib/use-log.ts` — loadInitial (hydrate + list + stats) +
  push handler vía slice + filtros derivados (group → categories) +
  clear/export TXT/reset-stats.
- **`event-wire.ts`** cableado para `log:entry` → `pushLogEntry`. Los
  eventos del sidecar llegan en vivo al log del renderer.

#### Componentes log (G11.3)
- **NUEVOS** en `components/log/`:
  - `log-meta.ts` — emoji + color por categoría (19) + 8 grupos UI.
  - `LogEntryRow.tsx` — fila compacta con timestamp opcional + emoji
    + level + message. Hover bg.
  - `FilterPills.tsx` — 8 pills toggle con count por grupo + "todos/
    ninguno" toggle global.
  - `StatsCounters.tsx` — 6 contadores agrupados (gifts/follows/shares/
    likes/chat/acciones) en grid.
  - `SystemHealthWidget.tsx` — 4 indicadores (Sidecar/TikTok/Game/TTS)
    con `<StatusDot>` y label.

#### SimulatorDialog (G11.4 — xl)
- **NUEVO**: `components/dialogs/simulator/SimulatorDialog.tsx`.
- **6 trigger types** (paridad MARU): gift / comment / follow / share /
  subscribe / like.
- **3 secciones condicionales** (gift / comment / like) que se
  ocultan/muestran según el tipo seleccionado.
- **Galería gifts compacta** 100×92 con search + sort coins (asc/desc) +
  count visible. Usa `MaruImage` scope `donaciones`.
- **10 presets** del MARU original (Rosa, Galaxy, León, Diamante, Follow,
  Share, SuperFan, 10 Likes, !spawn, !ia hola).
- **Burst mode** con stagger **200ms** (paridad K6) — útil para test de
  carga del rule_engine.
- **Status auto-clear 2s** (paridad K9) con `aria-live`.
- Mapeo de subscribe → `simulator.comment` con marca `⭐` (sidecar no
  tenía endpoint dedicado; G14 puede agregarlo si TikTokLive lo expone).

#### LogPanel real (G11.5)
- **REESCRITO**: el placeholder G1 reemplazado con widget completo:
  - Stats counters (6) en card sup.
  - SystemHealthWidget (4 indicadores) en card.
  - **Toolbar**: 8 filter pills + search + toggle timestamps + export TXT
    + reset stats + clear log.
  - Lista con auto-scroll inteligente: detecta scroll-up del usuario y
    pausa el auto-scroll, mostrando floating "↓ N nuevos" para volver.
  - Footer: "X de Y · max 500" + estado scroll (🟢 auto / ⏸ pausado).
- Cableado SimulatorDialog en `ModalRoot` (`activeModal === 'simulator'`).
  El sidebar ya apuntaba ahí desde G1 con shortcut Ctrl+Shift+S.

#### Smoke G11.6 (resultados)
- ✅ **134 RPC methods totales** (era 128), +6 son `logs.*`.
- ✅ Lifecycle LogsService: 19 categorías reconocidas, detect_category
  con 9/9 samples OK (8/9 antes — corregido regex de follower).
  parse_log_line del formato del logger funciona. Publish + list +
  filter + clear + categories meta OK.
- ✅ 0 errores TS en archivos G11.
- ⚠️ 6 errores TS preexistentes en `packages/ui` (heredados F0, → G14).

### Mejoras vs MARU original

- **LogPanel react funcional sin virtualización** (paint OK con 500
  entries) — más simple que el `EnhancedLogWidget` PyQt con batch 50ms.
- **Filter pills toggleable individualmente + "todos/ninguno"** —
  más rápido que checkboxes del original.
- **Floating "↓ N nuevos"** cuando el usuario hace scroll-up — UX
  premium vs el "auto_scroll = False" silencioso del original.
- **Push events del sidecar** vía `log:entry` → no requiere polling
  como el original (que leía archivo cada N segundos).
- **Stats counters** sumando categorías relacionadas (chat = comment +
  command, social = follow + share + like + social).
- **Burst con stagger 200ms** (G11.4) — el MARU original disparaba
  todos en cero tiempo; el stagger permite ver cada evento llegar al
  log en tiempo real.

### Bump versión: 1.0.0-beta.5 → 1.0.0-beta.6

---

## 1.0.0-beta.5 — 2026-04-27 · 🟢 G10 stream profiles + sounds + minigames

### G10 — Stream Profiles · Sonidos · Minigames (3 sistemas en una fase)

#### Sidecar — ProfilesService mejorado (G10.0)
- **Metadata enriquecida** en `meta.json`: `gameId`, `gameName`,
  `rulesCount`, `rulesEnabled`, `giftsCount`, `customGamesCount`,
  `sizeBytes`. Calculados al guardar/duplicar/importar para que el
  dialog las muestre sin re-fetch.
- **Snapshot extendido**: ahora incluye `gifts.json`, `voices.json`,
  `ia.json`, `social_data.json`, `sounds_*.json` (antes solo
  `games/rules/data/config`).
- **`profiles.rename`** nuevo método (faltaba — antes solo había
  duplicate).

#### Sidecar — SoundsService nuevo (G10.1)
- **NUEVO**: `apps/sidecar/maru_sidecar/backend/sounds.py`.
- Persistencia por scope: `data/sounds_<scope>.json` donde scope es
  `'global'` o un `gameId`. Permite sets distintos por juego.
- Schema: `{library, gifts, events: {follow, share, superfan}, volume}`.
- Library con metadata cacheada `{path, name, sizeBytes, exists}` para
  que el renderer no haga IO por card.
- Filtra extensiones audio (.mp3/.wav/.ogg/.m4a/.flac).
- 7 RPC methods: list / library.add / library.remove / assign-gift /
  assign-event / set-volume / resolve-path.
- **NO depende de pygame** — el playback se delega al renderer (HTMLAudio
  Web Audio API) para funcionar en Electron sin extra deps.

#### Sidecar — MinigamesService nuevo (G10.2)
- **NUEVO**: `apps/sidecar/maru_sidecar/backend/minigames.py`.
- Catálogo de **3 minijuegos** (paridad MARU): `wordSearch`,
  `wordSearchLite`, `wordBomb`.
- **19 categorías de palabras** hardcoded (animales, comida, paises,
  deportes, colores, gaming, musica, minecraft, terror, naturaleza,
  espacio, mitologia, tecnologia, profesiones, cuerpo, ropa, cine,
  historia, oceano).
- Config persistida en `data/minigames.json` con clamping (wordCount
  4-12, rows/cols 8-15, turnTime 5-30, lives 1-5).
- 6 RPC: meta / config.get / config.set / state / start / stop.
- `start` intenta cargar el engine real del core via
  `core.minigames.word_search`/`word_bomb`; si no está disponible,
  marca el state como activo igual y devuelve `engineReady: false`
  (engine real se cablea en G14 con TikTokLive).

#### Shared types (G10.3)
- **NUEVOS**: `SoundEvent`, `SoundLibraryItem`, `SoundsConfig`,
  `MinigameId`, `MinigameInfo`, `WordSearchConfig`, `WordBombConfig`,
  `MinigamesConfig`, `MinigamesMeta`, `MinigameState`.
- **EXTEND**: `ProfileSnapshot` con campos enriquecidos (gameId, counts,
  sizeBytes).
- **+15 RPC tipados**: profiles (+rename), sounds (7), minigames (6).

#### Renderer state (G10.4)
- **NUEVOS slices**:
  - `lib/store/profiles-slice.ts` — global con CRUD optimista.
  - `lib/store/sounds-slice.ts` — buckets por scope.
  - `lib/store/minigames-slice.ts` — meta + config + state.
- **NUEVOS hooks**:
  - `lib/use-profiles.ts` — refresh + save + load + duplicate + rename
    + remove + export/import (JSON).
  - `lib/use-sounds.ts` — buckets + library/gifts/events CRUD +
    `playLocal` con `<Audio>` Web Audio (no requiere pygame).
  - `lib/use-minigames.ts` — meta + config patch + start/stop con state
    refresh.

#### Componentes (G10.5) — 3 dialogs
- **NUEVO** `components/dialogs/profiles/StreamProfilesDialog.tsx` (lg):
  toolbar con import + save form inline + lista de cards (icon, name,
  meta enriquecida, fecha, tamaño) + acciones por fila (Cargar /
  Duplicar / Rename inline / Export JSON / Eliminar) + confirm de delete
  + flash de status.
- **NUEVO** `components/dialogs/sounds/SoundsDialog.tsx` (xl): scope
  selector (global vs gameId) + volume slider + 3 tabs (Biblioteca /
  Regalos / Eventos) + sub-componentes inline `GiftSoundsList` y
  `EventSoundsList` con combo de sonidos + test button + remove. Usa
  `<input type="file" multiple>` para añadir archivos (file picker
  nativo Electron).
- **NUEVO** `components/dialogs/minigames/MinigamesDialog.tsx` (md):
  banner de minijuego activo con botón Stop + 3 secciones colapsables
  (Sopa, Sopa Rápida, Bomba) + form por sección con clamping (categoría
  combo, sliders) + botón Iniciar por minijuego. Mensaje claro cuando
  el engine no está disponible (G14).

#### Cableado en ModalRoot (G10.6)
- 3 modal ids ya estaban en `ui-slice.ts` (`profiles`, `sounds`,
  `minigames`) — solo wiring en `ModalRoot.tsx`. Sidebar ya apunta a
  los 3 desde G1.

#### Smoke G10.6 (resultados)
- ✅ **128 RPC methods totales**, +15 vs G9 (sounds 7 + minigames 6 +
  profiles.rename).
- ✅ Lifecycle SoundsService: list global vacío · library.add filtra
  extensiones (sound1.mp3 + sound2.wav OK, notaudio.txt rechazado) ·
  assign gift/event · set-volume con clamp 100 · persistencia disk OK.
- ✅ Lifecycle MinigamesService: meta devuelve 3 minijuegos × 19 cats ·
  config patch wordBomb persiste · start wordSearch sin core engine
  marca active=true igual y devuelve engineReady=false con warning.
- ✅ Lifecycle ProfilesService: save con metadata enriquecida (sizeBytes
  > 0, gameId si hay games.json) · rename funciona.
- ✅ 0 errores TS en archivos G10 (corregidos 4 imports faltantes
  antes del cierre).
- ⚠️ 6 errores TS preexistentes en `packages/ui` (heredados F0, → G14).

### Mejoras vs MARU original

- **Profiles con metadata enriquecida** — counts y tamaño visibles en
  cada card sin re-fetch.
- **Snapshot incluye gifts/voices/ia/social** (antes solo games/rules/
  data/config).
- **Profiles.rename** — método dedicado, antes había que reescribir el
  meta.json a mano.
- **Sounds por scope** (`global` vs `gameId`) — permite sets distintos
  por juego.
- **Library con cache de metadata** (path, name, size, exists) →
  paint sin IO.
- **Playback Web Audio nativo** — sin pygame en el renderer; funciona
  en Electron y tests sin headache.
- **Minigames state persistente** — el dialog muestra "activo" con
  botón Stop entre aperturas.
- **3 minijuegos clamping en sidecar** — nunca se puede crear una grilla
  inválida desde el dialog.

### Bump versión: 1.0.0-beta.4 → 1.0.0-beta.5

---

## 1.0.0-beta.4 — 2026-04-27 · 🟢 G9 voces TTS (74 voces × 3 canales × 3 niveles)

### G9 — Voces TTS completo (paridad MARU + persistencia + UX premium)

#### Sidecar — TtsService refactor (G9.0)
- **REESCRITO**: `apps/sidecar/maru_sidecar/backend/tts.py`. De 3 RPC
  methods (speak/stop/queue-sizes) → **12 RPC methods** con persistencia
  + 74 voces fallback + user_voices CRUD.
- **`data/voices.json`** persiste config + user_voices entre restarts
  del sidecar (atomic write `.tmp + replace`).
- **74 voces hardcoded** como fallback con familia categorizada
  (popular/characters/specials/english_us/english_uk/english_au/spanish/
  french/german/italian/portuguese/asian/singing). Cuando `core.tts_engine`
  está disponible, prefiere su `VOICES` dict para incluir las que el
  core agregue.
- **`normalize_username()`** del MARU original: `lower().replace("@", "").replace(" ", "")`.
- **3 niveles de resolución de voz** (paridad MARU):
  1. per-user (override absoluto vía `user_voices[username]`).
  2. global / por perfil (según `voice_mode`).
  3. default del engine (`default_voice`).
- **3 canales independientes** (chat/social/fortune) con flags
  `enabled_*` y volúmenes `volume_*` 0-100 (UI) → 0.0-1.0 (engine).
- **Clamping** server-side: volúmenes [0, 100], voice_mode ∈ {global,
  profile}.
- **Tolerante a core no disponible**: list_voices devuelve los 74
  fallback, config_get devuelve defaults, mutaciones de speak/test
  retornan `{ok: false, message}` con explicación.

#### Shared types (G9.1)
- **NUEVOS**: `TtsChannel`, `TtsVoiceMode`, `TtsVoice`, `TtsConfig`,
  `TtsUserVoice`, `TtsQueueSizes`, `TtsTestResult`.
- **12 RPC methods tipados** en `TtsMethods` (antes había 3).

#### Renderer state (G9.2)
- **NUEVO**: `lib/store/tts-slice.ts` — global single con voices catalog
  + families + config + userVoices + queueSizes.
- **NUEVO**: `lib/use-tts.ts` — hook con `loadAll` parallel + `saveConfig`
  optimista + `assignUserVoice`/`removeUserVoice` + `clearAllUserVoices`
  con confirm + `test`/`speak`/`stop`/`clearCache` + opcional `pollQueueMs`
  para dashboards live.

#### Componentes (G9.3) — 4 sub-componentes + dialog
- **NUEVOS** en `components/dialogs/tts/`:
  - `VoiceSelector.tsx` — combo reusable con **search inline + optgroup
    nativo por familia**. Mejora vs MARU `QComboBox` plano de 74 items.
    Soporta `allowEmpty` para "(default del sistema)".
  - `EditVoiceModal.tsx` — sub-modal sm para cambiar voz de un user.
  - `UserVoicesList.tsx` — form añadir + lista user→voz con probar/edit/
    eliminar por fila + clear all opcional.
  - `TtsConfigPanel.tsx` — master enable + 3 toggles canal + 3 sliders
    volumen + default voice + radio voice_mode + clear cache.
  - `VoicesDialog.tsx` (lg bodyFlush) — orquesta `TtsConfigPanel` + 
    `UserVoicesList` en 2 tabs.

#### Cableado (G9.4 + G9.5)
- `'voices'` cableado en `ModalRoot` (sidebar ya apuntaba ahí desde G1).
- **Sidebar TTS GroupBox**: dropdown de voz pasó de 1 hardcoded
  (`es_mx_002`) a **74 reales** desde `useTts.voices` + persiste
  `default_voice` y `enabled_chat`/`volume_chat`/`voice_mode` con
  saveConfig optimista.
- **GeneralTab del SocialConfigDialog**: usa `VoiceSelector` con las 74
  voces (antes tenía 5 hardcoded). Reemplaza el `<Select>` por el combo
  con search.

#### Smoke G9.6 (resultados)
- ✅ **114 RPC methods totales**, 12 son `tts.*` (eran 3).
- ✅ Lifecycle: list_voices devuelve 74 voces × 13 familias ·
  config_get default · config_set persiste a disco + clamp ·
  user_voices CRUD con normalización (`@SoyKoru` → `soykoru`,
  `  @MAICOL ` → `maicol`) · persistencia disk → reload service
  conserva todo · test sin core devuelve OK con voice + text del
  fallback engine.
- ✅ 0 errores TS en archivos G9.
- ⚠️ 6 errores TS preexistentes en `packages/ui` (heredados F0, → G14).

### Mejoras vs MARU original

- **VoiceSelector con search + optgroup** vs combo plano de 74 items
  difícil de scrollear.
- **Persistencia propia del sidecar** (`data/voices.json`) — sobrevive
  sin depender del MainWindow legacy.
- **Master enable + 3 toggles canal + 3 sliders volumen** unificados en
  un panel — antes el config TTS estaba disperso (sidebar + social tab).
- **Fallback hardcoded de 74 voces** asegura que el dialog funcione
  aún sin core (test envs).
- **Tolerancia a core no disponible** — todos los endpoints devuelven
  shape válido en vez de crashear.
- **Clear all user_voices** con confirm — útil para limpiar testing.

### Bump versión: 1.0.0-beta.3 → 1.0.0-beta.4

---

## 1.0.0-beta.3 — 2026-04-27 · 🟢 G8 IA real (multi-proveedor)

### G8 — IA real (paridad MARU + persistencia + SOYKORU_CONTEXT editable)

#### Sidecar — IaService refactor (G8.0)
- **REESCRITO**: `apps/sidecar/maru_sidecar/backend/ia.py`. De 4 RPC
  methods (status/ask/config_set + lazy engine) → **8 RPC methods**
  con persistencia propia.
- **`data/ia.json`** persiste config + context entre restarts del
  sidecar — antes el MainWindow viejo era el único que guardaba.
  Atomic write con `.tmp + replace`.
- **4 proveedores**: Claude (sonnet/opus), Groq (4 modelos gratis),
  Gemini (3 gratis), OpenAI (4 modelos). Mismo set que MARU.
- **Fallback hardcoded** de PROVIDERS / MODELS / COST_RATES para que
  el dialog funcione aún si `core.ia_engine` no carga (test envs).
  Cuando carga, prefiere los datos exactos del engine (incluye los
  modelos nuevos que el core agregue).
- **Keys per-provider** (`api_keys: {claude, groq, gemini, openai}`).
  Cambiar de provider:
  1) restaura la key guardada para el nuevo provider (si existía),
  2) resetea el modelo al default del nuevo provider si el actual no
     pertenece a sus MODELS.
- **Clamping** server-side: `max_response_length ∈ [100, 800]`,
  `cooldown_seconds ∈ [3, 120]`.
- **`SOYKORU_CONTEXT` configurable** desde RPC `ia.context.set` (mejora
  vs MARU que era hardcoded en código). El service lo inyecta al engine
  vía `engine.SOYKORU_CONTEXT = ...` después de cada `_apply_to_engine`.
- **`ia.test`** endpoint nuevo: dispara una pregunta de prueba con
  timing (latencia ms) + meta (tokens, cost). No persiste nada.

#### Shared types (G8.1)
- **NUEVOS**: `IaProviderId`, `IA_PROVIDER_IDS` const, `IaProviderMeta`,
  `IaModelOption`, `IaCostRate`, `IaConfig`, `IaProvidersMeta`,
  `IaAskMeta`, `IaTestResult`.
- **8 RPC methods tipados** en `IaMethods` (antes había 3).

#### Renderer state (G8.2)
- **NUEVO**: `lib/store/ia-slice.ts` — global single (un solo IAEngine):
  config + ready + context + providersMeta + lastTest.
- **NUEVO**: `lib/use-ia.ts` — hook con `loadAll` parallel (config +
  context + providersMeta) + `saveConfig`/`saveContext` + `test`/`ask`
  + helpers derivados (`modelsForCurrent`, `currentProviderMeta`,
  `currentCostRate`).

#### Componentes (G8.3) — 3 sub-componentes + dialog
- **NUEVOS** en `components/dialogs/ia/`:
  - `ProviderSection.tsx` — switch enabled + combo provider con icon +
    API key (password) + combo model + **cost preview card** USD/1M
    tokens cuando aplica (modelos de pago) + help URL clickeable.
  - `AdvancedSection.tsx` — max length (100-800) + cooldown (3-120) +
    system prompt textarea + **context editor** con botón "Restaurar
    default" + toggle para ver el default completo inline.
  - `TestPanel.tsx` — input pregunta opcional + botón Probar (Loader
    spinner mientras corre) + resultado con latencia ms y meta
    (provider/model/tokens/cost). Aria-live para screen readers.
  - `IaConfigDialog.tsx` (lg bodyFlush) — orquesta los 3 sections en
    scroll vertical + footer con badge "● Cambios sin guardar" / "✓ IA
    lista" + warning si hay dirty antes del test.

#### Cableado en ModalRoot + Sidebar (G8.4)
- Nuevo modal id `'ia-config'` agregado al union `ActiveModal` en
  `ui-slice.ts`.
- Cableado en `ModalRoot.tsx`.
- **Sidebar**: nuevo botón "🤖 IA" en el GroupBox de Configuración
  (entre Respaldos y TikTok API).

#### Smoke G8.5 (resultados)
- ✅ **105 RPC methods totales**, 8 son `ia.*` (eran 3).
- ✅ Lifecycle IaService: config_get devuelve defaults · providers_meta
  devuelve 4 providers × {2,4,3,4} modelos · context_get default ·
  config_set persiste a disco · switch provider preserva keys ·
  clamping max_length/cooldown OK · context_set + reload service →
  values reloaded · test sin core devuelve mensaje claro.
- ✅ 0 errores TS en archivos G8.
- ⚠️ 6 errores TS preexistentes en `packages/ui` (heredados F0, → G14).

### Mejoras vs MARU original

- **`SOYKORU_CONTEXT` editable** desde la UI (era hardcoded en código).
  Cada usuario puede personalizar su bio. Botón "Restaurar default"
  para volver al MARU original.
- **Keys per-provider preservadas** server-side — el sidecar mantiene
  el dict `api_keys`, no solo el cliente.
- **Cost preview** en USD/1M tokens visible antes de elegir modelo.
- **`ia.test`** dedicado (vs reusar `ia.ask`) — no consume cooldown del
  usuario y devuelve latencia + meta.
- **Persistencia propia del sidecar** — `data/ia.json` sobrevive sin
  depender del MainWindow legacy.
- **Tolerancia a core no disponible** — providers/models/costs hardcoded
  como fallback para que el UI funcione siempre.

### Bump versión: 1.0.0-beta.2 → 1.0.0-beta.3

---

## 1.0.0-beta.2 — 2026-04-27 · 🟢 G7 sistema social

### G7 — Sistema social completo (paridad MARU + 5 tabs)

#### Sidecar — SocialService refactor (G7.0)
- **REESCRITO**: `apps/sidecar/maru_sidecar/backend/social.py`.
  De 3 RPC methods → **20 RPC methods** con paridad completa al
  `social_config.py` (2464 líneas Python).
- **Tolerante a core no disponible**: si `core.social_system` falla al
  cargar (test envs, sidecar standalone), todos los métodos devuelven el
  shape DTO vacío (`DEFAULT_CONFIG`, `DEFAULT_STATS`, `FALLBACK_COMMANDS_META`)
  en vez de crashear.
- **`commands_meta`** con fallback hardcoded de **8 categorías + 35
  comandos** (paridad MARU `CATEGORIES + COMMANDS_INFO`). Cuando el core
  está disponible, lee de `s.get_commands_by_category()`.
- **17 admin endpoints**: list_users, get_user, register, unregister, delete,
  set_racha, reset_racha, reset_relaciones, remove_marriage,
  remove_relationship, activate_auto_racha, deactivate_auto_racha, +
  taps.top, taps.cleanup, stats, reset_all (con confirm `'DELETE'`).
- **DTO conversión**: `_user_to_dto` normaliza el shape interno del
  SocialSystem (que tiene keys mixtas `casado/marriage`, `racha_auto/auto_racha`)
  al schema canónico TS.

#### Shared types (G7.1)
- **NUEVOS**: `SocialUser`, `SocialAutoRacha`, `SocialConfig`, `SocialStats`,
  `SocialCommand`, `SocialCategoryMeta`, `TapsPeriod`, `TapsRankingEntry`,
  `RelationshipType`.
- **20 RPC methods tipados** en `SocialMethods` (antes había 3).

#### Renderer state (G7.2)
- **NUEVO**: `lib/store/social-slice.ts` — single global (no buckets,
  hay un solo SocialSystem) con config + users + stats + taps + commandsMeta
  + selectedUsername + search.
- **NUEVO**: `lib/use-social.ts` — hook con `loadAll` parallel + 12
  mutations + selectores derivados (visibleUsers, selectedUser).

#### Componentes (G7.3) — 5 tabs + sub-modal
- **NUEVOS** en `components/dialogs/social/`:
  - `GeneralTab.tsx` — activación + tiempos + audio (volumen + voz +
    botón "Probar" que dispara `tts.speak` channel `'social'`).
  - `CommandsTab.tsx` — grid de 8 categorías × N comandos con
    checkboxes individuales + "activar/desactivar todos por categoría"
    + "seleccionar todos / deseleccionar". Counter "X de Y activos".
  - `UsersTab.tsx` — search + tabla 9 cols con **edit en celda inline**
    (racha numérica + 4 columnas de relaciones que se borran escribiendo
    `-`/`vacío`/`none`). Acciones del usuario seleccionado: register,
    unregister, reset racha/relaciones, AutoRacha modal, eliminar.
  - `TapsTab.tsx` — period selector (total/semanal/mensual) + banner
    gradient + tabla top con medallas 🥇🥈🥉 + "Limpiar inactivos".
  - `StatsTab.tsx` — grid 3×3 con stats globales + top streak + Zona de
    Peligro con **doble confirm** (preguntar + escribir `DELETE`).
  - `AutoRachaModal.tsx` — sub-modal (sm) para activar/desactivar racha
    automática 1-365 días.

#### SocialConfigDialog (G7.4 — xl bodyFlush)
- **NUEVO**: integra los 5 tabs en un dialog grande con tab bar
  horizontal + cuerpo scrollable + footer con badge "● Cambios sin guardar".
- Save aplica patch incremental + recarga config para asegurar
  consistencia entre el draft local y el sidecar.
- Cableado en ModalRoot (`activeModal === 'social-config'`). El sidebar
  ya apuntaba a este modal desde G1.

#### Smoke G7.5 (resultados)
- ✅ **100 RPC methods totales**, 20 son `social.*` (eran 3).
- ✅ Lifecycle SocialService sin core: config_get devuelve defaults ·
  commands_meta devuelve 8 cats con 35+ cmds del fallback ·
  users/stats vacíos · validaciones rechazan inputs malos
  (period inválido, confirm sin DELETE, days fuera de rango,
  relType desconocido).
- ✅ 0 errores TS en archivos G7.
- ⚠️ 6 errores TS preexistentes en `packages/ui` (heredados F0, → G14).

### Mejoras vs MARU original

- **Tabs unificados** en un solo dialog vs 6 sub-windows del original.
- **Zona de peligro** con doble confirm + input escribible (vs 2
  QMessageBox).
- **Edit en celda inline** sin modal extra (vs `cellChanged` callback con
  modal de confirm).
- **Counter "X de Y activos"** en CommandsTab — visualmente claro qué
  está habilitado.
- **Banner gradient** en TapsTab (rojo→amarillo) — paridad estética con
  el original pero usando tokens del design system.
- **Tolerancia a core no disponible**: 100% de los endpoints devuelven
  shape válido en vez de crashear. Útil para tests y sidecar standalone.

### Bump versión: 1.0.0-beta.1 → 1.0.0-beta.2

---

## 1.0.0-beta.1 — 2026-04-27 · 🟢 G6 reglas TikTok → juego

> Pasamos de `alpha` a `beta`. El producto entra en estado funcional
> end-to-end: TikTok event → Rule trigger → Action dispatch (vía
> RuleEngine real cuando G14 cablee tiktok-client). Falta UI de
> Social/IA/TTS/Spotify/Overlays + integración real con TikTokLive.

### G6 — Reglas TikTok → juego (paridad MARU + multi-acción optimista)

#### Sidecar — RulesService refactor (G6.0)
- **REESCRITO**: `apps/sidecar/maru_sidecar/backend/rules.py`.
- `gameId` arbitrario (regex `^(?!\d+$)[a-zA-Z0-9_]{2,32}$`) — soporta
  los N customs G4 + el id real del bundle `7_days_to_die`.
- **Mismo regex aplicado en `games.py` y `data_catalog.py`** para
  consistencia (era inconsistente entre los 3 servicios; antes
  rechazaba `7_days_to_die` por exigir empezar con letra/underscore).
- **7 trigger types completos** (paridad MARU):
  `gift|command|follow|share|subscribe|like|like_milestone`.
  Antes solo había 6 simplificados.
- **Schema Rule MARU verbose** con todos los campos del original:
  `trigger_type/value` planos, `actions[]` con `action_type/value/
  amount/commands/action_type_name`, `random_action`, `cooldown`,
  `tts_enabled/message/voice`, `allowed_users` (lowercase).
- **Compat fields espejo de actions[0]**: `action_type` (mapeado a
  legacy `spawn|give_item|trigger_event|spawn_valuable`),
  `action_value`, `amount`, `commands`. Sincronizados automáticamente
  para que el RuleEngine viejo lea sin re-mapear.
- **Auto-migración del shape F0-F8** (`{trigger:{kind,...}, actions:
  [{kind,...}]}`) → MARU verbose al `upsert`. Soporta entry point
  desde el sidecar y desde imports JSON.
- **Mapeo `ACTION_TYPE_LEGACY_MAP`** exportado: cat_id → action_type
  para que el cliente sepa qué shape tomar (entity → spawn, etc).
- **Nuevo `rules.duplicate`** — clona regla con id nuevo y nombre
  `... (copia)`.
- **`rules.test` mejorado** — devuelve trace detallado: trigger, count
  acciones, preview de cada action, random/cooldown/tts/users.

#### Shared types (G6.1)
- `Rule` reemplazado por shape MARU verbose (snake_case) con compat
  fields opcionales. Renombre completo: `trigger`/`actions[].kind` →
  `trigger_type`/`action_type`. Esto rompe compatibilidad con cualquier
  código viejo que asumiera el shape simplificado.
- `STANDARD_TRIGGER_TYPES` const con los 7 valores MARU.
- `ACTION_TYPE_LEGACY_MAP` const exportado para uso del renderer.
- `RuleAction` interface explícita con los 5 campos del MARU.
- `RuleInput` (omite id + compat fields generados por sidecar).

#### Renderer state (G6.2)
- **NUEVO**: `lib/store/rules-slice.ts` — buckets por `gameId`,
  search/triggerFilter/selectedRuleId.
- **NUEVO**: `lib/use-rules.ts` — hook con CRUD optimista + toggle
  con auto-rollback + duplicate + reorder + test (trace) + auto-load
  por gameId.

#### Componentes (G6.3)
- **NUEVOS**:
  - `dialogs/rules/trigger-meta.ts` — metadata visual de los 7 triggers
    (emoji, color, hint).
  - `TriggerSection.tsx` — selector + 4 paneles condicionales (gift /
    like / milestone / command). Paridad sección 1-5 MARU.
  - `ActionsSection.tsx` — lista actions multi + form add/edit
    inline + botón galería (EntitySelectorDialog G5) + test inline +
    Switch random_action condicional. **Mejora vs MARU**: edit inline
    (sin sub-modal). Carga value combo desde `data.list` por kind.
  - `CooldownTtsSection.tsx` — combina cooldown + TTS + allowed_users
    en un solo fieldset con sub-secciones contextuales.
  - `RuleListItem.tsx` — fila de la lista en el CenterPanel: switch
    enable/disable + emoji+color de trigger + name + count acciones +
    badges (Random/TTS/Cooldown) + 4 botones hover (test/edit/dup/del).

#### RuleDialog (G6.4 — xl bodyFlush)
- **NUEVO**: integra las 3 sections en un dialog stacked verticalmente.
- **Validación inline**: nombre vacío, trigger value para gift/like/
  milestone/command, mínimo 1 acción. Botón Guardar deshabilitado y
  footer mostrando lista de errores (`· Nombre requerido · Falta valor`).
- Cableado en ModalRoot: payload `{gameId, ruleId?}`. Si `ruleId` viene,
  modo edit; si no, create.
- **`gift-selector` cableado** con callback en payload (G3 estaba listo
  pero sin entry-point — G6 lo necesita para el botón "Galería" del
  trigger gift).
- **`entity-selector` invocado desde ActionsSection** con `multiSelect:
  true` → cada selección se convierte en una `RuleAction`.

#### CenterPanel real (G6.5)
- **REESCRITO**: reemplaza el placeholder G1 con la lista de reglas
  del juego activo.
- Toolbar: dropdown de juego (sincronizado con `selectedGameId` global)
  + search local + filter por trigger con count + botón Nueva.
- Lista usa `RuleListItem` con virtualización implícita (zustand selectors).
- Footer: import/export JSON · count visible/total.
- **Confirm delete inline** (toast posicionado abs en esquina) con
  detalle del nombre.
- **Test trace toast** — al pulsar Probar muestra el trace del
  `rules.test` (trigger, acciones, cooldown, TTS, etc.) en un toast
  flotante posicionado en esquina.

#### Sidebar — dropdown de juego funcional
- El dropdown de "🎮 Perfil de Juego" (G1 era estático con 3 opciones
  hardcoded) ahora se cablea con `useGames()` y persiste en
  `selectedGameId`. Muestra todos los predefined + customs G4.
- El hint de info (`Puerto 5000 · ✅ Entidades ❌ Eventos`) ahora
  refleja el perfil real seleccionado.

#### Smoke G6.6 (resultados)
- ✅ 83 RPC methods totales, 7 son `rules.*` (eran 6, +`rules.duplicate`).
- ✅ Lifecycle RulesService: list vacío → upsert MARU verbose → upsert
  F0-F8 (migrado) → 7 triggers OK · duplicate · toggle · reorder ·
  test trace OK · gameId arbitrario `7_days_to_die` OK · `12`/`has space`
  rechazados.
- ✅ Bug regex gameId entre 3 servicios resuelto (consistencia).
- ✅ 0 errores TS en archivos G6 (corregido 1 antes del cierre).
- ⚠️ 6 errores TS preexistentes en `packages/ui` (heredados F0, → G14).

### Bump versión: 0.9.0-alpha → 1.0.0-beta.1

Marca el final de la fase **alpha** (foundation: image system + 6
diálogos críticos del MARU original portados con paridad + mejoras).
La fase **beta** se enfoca en G7-G14: social, IA, TTS, Spotify,
overlays, simulador, backups, integración real con TikTok Live.

---

## 0.9.0-alpha — 2026-04-27 · 🟢 G5 catálogo de datos

### G5 — Catálogo de Datos (entidades / items / eventos / valuables / custom)

#### Sidecar — DataService refactor (G5.0)
- **REESCRITO**: `apps/sidecar/maru_sidecar/backend/data_catalog.py`.
- Eliminado `VALID_GAMES` hardcoded → ahora `gameId` arbitrario validado
  por regex (`^[a-zA-Z_][a-zA-Z0-9_]{1,31}$`). Soporta los N customs G4.
- Eliminado `VALID_KINDS` hardcoded → ahora `kind` arbitrario (default
  estándar: entities/items/events/valuables, pero acepta cualquier id
  declarado en `GameProfile.categories[*].id`).
- **MIGRACIÓN AUTOMÁTICA al primer read** del formato MARU original
  (lista de strings `"Display:Cmd"`) al objeto canónico `{name, command,
  imagePath?, meta?}`. Con backup automático y persistencia idempotente.
- **`imagePath` resuelto vs bundle**: si una entry no tiene `imagePath`,
  el sidecar busca `game_images/<gid>/<kind>/<command>.png` y lo asigna
  automáticamente al devolverla en `data.list`/`data.all-categories`.
- **2 RPC methods nuevos** (7 totales `data.*`):
  - `data.all-categories` — devuelve `Record<categoryId, {label, entries}>`
    con TODAS las cats vivas del juego (custom o estándar) en una sola
    llamada. Lo consume `EntitySelectorDialog` para los tabs.
  - `data.tutorial` — lee `games.json[gid].categories[?id==kind].tutorial`
    para mostrar ayuda inline en el `DataDialog`.
- `data.import` ahora acepta tanto el formato canónico como el legacy
  `string[]` `"Display:Cmd"` (mezclado).

#### Shared types (G5.1)
- `DataKind` ahora es `StandardDataKind | string` — antes era union literal
  rígido `entities|items|events`.
- `STANDARD_DATA_KINDS` constante con `['entities','items','events','valuables']`.
- `DataEntry.imagePath?: string` opcional para que el renderer lo pase
  directo a `<MaruImage scope="game" path={...}>`.
- `DataCategoryBundle` para el response de `data.all-categories`.

#### Renderer state (G5.2)
- **NUEVO**: `lib/store/data-slice.ts` — buckets por `${gameId}::${kind}`,
  permite tener varios DataDialog abiertos sin invalidarse entre sí.
- **NUEVO**: `lib/use-data.ts` — hook con CRUD optimista, search local,
  import (acepta canónico o legacy strings), export como JSON, test entry
  (mapea kind → `games.spawn/give-item/trigger-event`), loadTutorial.

#### Componentes (G5.3)
- **NUEVO**: `components/dialogs/data/EntryCard.tsx` (120×120) — tile con
  MaruImage scope `game/<gid>/<cat>/<cmd>.png`, badge de cantidad
  (multi-select), borde verde "in selection" para multi.
- **NUEVO**: `EntryPreviewPanel.tsx` (140×140) — preview con name +
  command (`→ <cmd>`).
- **NUEVO**: `EntryEditForm.tsx` — form inline con `Input` o `TextArea`
  para command (multilinea para events / RCON / Minecraft). Botón "Probar"
  inline que llama al juego real y muestra el resultado.

#### DataDialog (G5.4 — xl 950×700)
- **NUEVO**: gestor visual con toolbar (search + tutorial + import + nuevo)
  + grid auto-fill 120px + side-panel preview+edit + footer con export.
- **Cableado en ModalRoot** con payload `{gameId, kind}`. ManageGamesDialog
  expone botón "📦 Datos" por cada perfil que abre el DataDialog en la
  primera categoría disponible.
- Import file picker acepta JSON con shape `[...]`, `{entries: [...]}`,
  o `{<kind>: [...]}` (formato MARU original).
- Export descarga `<gid>_<kind>.json` con shape `{kind, entries}`.

#### EntitySelectorDialog (G5.5 — xl reusable)
- **NUEVO**: picker reusable con tabs por categoría + multi-select opcional.
- **Single-mode**: doble-click o Enter acepta. Aria-pressed correcto.
- **Multi-mode**: cada click suma cantidad (badge sup-derecha del card).
  Panel lateral con `<input type="number">` por fila + botón ✕ rojo.
- Consume `data.all-categories` en una sola llamada al abrir.
- Acepta `preselected`, `initialCategory`, `title` para customización.
- **Cableado en ModalRoot**: payload acepta callbacks `onSelect` /
  `onConfirmMulti` que el caller (G6 RuleDialog futuro) usa para recibir
  la selección y cerrar el modal.

#### Smoke G5.6 (resultados)
- ✅ 82 RPC methods totales, 7 son `data.*` (eran 5).
- ✅ Lifecycle DataService: list legacy `[\"X:Y\", ...]` → migrado a
  objetos en disco automáticamente · upsert custom kind ok ·
  custom gameId ok · gameId inválido rechazado correctamente ·
  all_categories devuelve 3 standard cats.
- ✅ `imagePath` resuelto contra el bundle: `Wolf` → `game/valheim/entities/Wolf.png`.
- ✅ 0 errores TS en archivos G5 (corregidos 4 errores TS antes del cierre).
- ⚠️ 6 errores TS preexistentes en `packages/ui` (heredados F0, → G14).

---

## 0.8.0-alpha — 2026-04-27 · 🟢 G4 games & profiles

### G4 — Perfiles de juego (paridad MARU + multi-custom + UX premium)

#### Shared types (G4.0)
- **BREAKING**: `GameId` pasa de union literal `'valheim'|'terraria'|'minecraft'|'custom'`
  a `string` genérico. Antes solo se podía tener UN custom; ahora N
  perfiles personalizados con id arbitrario `[a-zA-Z_][a-zA-Z0-9_]{1,31}`.
- **NUEVOS** types:
  - `STANDARD_GAME_IDS` constante + `StandardGameId` literal.
  - `GameConnectionType = 'http' | 'rcon'`.
  - `GameCategory` — categoría declarativa (id, name, type, icon, dataKey,
    endpoint, payload, rconCmd, tutorial). Espejo de
    `core/games.py:CustomGame.categories[*]`.
  - `GameProfile` — perfil completo con connection, connectionType,
    tabNames, hasEntities/Items/Events, categories, shareSounds/Voices,
    basedOn, isStandard.
  - `CreateCustomGameInput`, `UpdateGameInput` para los RPC.

#### Sidecar — GamesService refactor (G4.0)
- **REESCRITO**: `apps/sidecar/maru_sidecar/backend/games.py` con schema
  `{schemaVersion: 2, games: {<gid>: GameProfile}}`.
- **MIGRACIÓN AUTOMÁTICA al boot** desde el schema F0-F8
  (`{<gid>: {host, port, password}}` plano, sin wrapper). Backup en
  `BACKUPS_DIR/games_pre_migration_<ts>.json`. Conserva conexiones de
  los predefinidos.
- **Boot fresh**: si no existe `games.json`, se siembra con los 3 perfiles
  predefinidos canónicos (Valheim 5000 HTTP, Terraria 5000 HTTP,
  Minecraft 25575 RCON).
- **6 RPC methods nuevos** (10 totales `games.*`):
  - `games.list` (refactor) — devuelve `GameProfile[]` ordenado:
    predefinidos primero, custom alfa.
  - `games.configure` — solo connection (atajo).
  - `games.update` — patch parcial. Para standard solo afecta
    `connection` y `tabNames`. Para custom permite todo y recalcula
    `hasEntities/Items/Events` desde categories.
  - `games.create-custom` — crear perfil custom + ensure
    `data_<gid>.json` y `rules_<gid>.json` vacíos.
  - `games.duplicate` — duplica perfil base (o vacío) con copia atómica
    de `data_<src>.json`. Para duplicado de standard, materializa las
    categorías implícitas.
  - `games.delete-custom` — borra perfil + `data_<gid>.json` +
    `rules_<gid>.json`. Devuelve `deletedFiles[]`. Bloquea borrar
    standards.
  - `games.test` — acepta `connection` opcional para test ad-hoc sin
    persistir.
- **Validación id** robusta: `^[a-zA-Z_][a-zA-Z0-9_]{1,31}$` (debe empezar
  con letra/underscore, no acepta `'12'`).

#### Renderer state (G4.1)
- **NUEVO**: `lib/store/games-slice.ts` — catálogo cacheado +
  `selectedGameId` + status/error.
- **NUEVO**: `lib/use-games.ts` — hook con `refresh`, `configure`,
  `updateGame`, `createCustom`, `duplicate`, `deleteCustom`,
  `testConnection`. Helpers derivados: `predefined`, `custom`, `byId(id)`.

#### EditPredefinedDialog (G4.2 — sm)
- **NUEVO**: subdialog para editar host/port (+ password sólo Minecraft).
- **Auto-test debounce 800ms** para HTTP (paridad MARU).
- Para RCON: NO auto-test (consume RAM al abrir socket); botón manual.
- aria-live para anunciar resultado a lectores de pantalla.

#### NewProfileDialog (G4.3 — md)
- **NUEVO**: modal mínimo para duplicar perfil (combo Vacío + existentes).
- ID normalizado en vivo (`lower + spaces→_ + strip non-alphanum`).
- Validación de duplicados visible mientras el usuario escribe.
- Switches share_sounds + share_voices con descripción inline.

#### CustomGameDialog (G4.4 — xl)
- **NUEVO**: el más complejo del Plan G hasta ahora (~430 líneas TSX).
  Réplica de `custom_game_dialog.py` (837 líneas Python originales).
- Secciones: BasicInfo, Conexión (radio HTTP/RCON), Presets (4 botones),
  CategoriesEditor, Compartir Globals.
- **`CategoriesEditor`** sub-componente: list+form en vivo. Add/remove
  categorías + edición de los 8 campos canónicos. Live-update (paridad).
- **4 Presets** del MARU original: Valheim/Terraria/7Days/Rust RCON.
  Aplican connectionType + port + categories completas en un click.
- Para STANDARD games: muestra solo `tabNames` editables (las 3 cats
  fijas no se modifican). ID deshabilitado siempre.

#### ManageGamesDialog (G4.5 — lg) + cableado
- **NUEVO**: hub con 2 secciones: Predefinidos (3 botones) + Personalizados
  (lista con icon, nombre, conexión y botones edit/delete por fila).
- Confirmación de delete con detalle de archivos a borrar.
- Help bullets explicativos.
- **Cableado en ModalRoot**: `manage-games`, `edit-predefined` (lee
  `gameId` de `modalPayload`), `custom-game` (lee `gameId` para edit
  o null para create), `new-profile`. Reemplazan los 4 placeholders G1.
- Sidebar: botón "Config" ahora abre `manage-games` (antes intentaba
  abrir `edit-predefined` sin payload — quedaba inservible).

#### Smoke G4.6 (resultados)
- ✅ 80 RPC methods totales, 10 son `games.*` (eran 6).
- ✅ Lifecycle GamesService: list 3 predefinidos seed → configure
  valheim → create_custom ark → archivos data/rules creados →
  duplicate valheim_modded → list 5 → delete ark → archivos limpiados.
- ✅ Migración F0-F8 → v2 con backup automático.
- ✅ Validación id rechaza: `'x'`, `'ar k'`, `'ark.io'`, `'12'`,
  reservados (`'valheim'`).
- ✅ 0 errores TS en archivos G4 (corregido bug en CategoriesEditor).
- ⚠️ 6 errores TS preexistentes en `packages/ui` (heredados F0, → G14).

---

## 0.7.0-alpha — 2026-04-27 · 🟢 G3 donation gallery

### G3 — Galería de donaciones (paridad MARU + mejoras)

#### Sidecar (G3.0)
- **REESCRITO**: `apps/sidecar/maru_sidecar/backend/donations.py` con el
  schema MARU real (`{custom_gifts: {<gift_id>: {name, icon, coins, icon_path,
  disabled}}}`). El schema F0-F8 inventado (`{<name>: {diamonds, command,
  imageUrl, ttsMessage, receivedCount}}`) era incompatible con el resto del
  pipeline (TikTokLive, gifts_dialog, image_index).
- **MIGRACIÓN AUTOMÁTICA al boot**, idempotente y con backup:
  1. F0-F8 schema → MARU real (heurística por presencia de `diamonds`/`imageUrl`).
  2. Paths absolutos `C:/Users/.../donaciones/Rose.png` → relativos `donaciones/Rose.png`.
  3. Resolver `icon_path` vacíos contra carpetas userdata + bundle.
  Backup pre-migración en `BACKUPS_DIR/gifts_pre_migration_<ts>.json`.
- **`receivedCount`** ahora vive en RAM (counter por sesión, reset con
  `donations.reset-counters`) en vez de persistirse — mejora vs MARU original.
- **NUEVOS métodos RPC**:
  - `donations.scan-folder` — escanea `donaciones/` (bundle + userdata),
    lee metadata `tEXt` de cada PNG (`Gift-Name`, `Gift-Coins`), devuelve
    catálogo. Réplica de `gifts_dialog.py:scan_donaciones_folder`.
  - `donations.import-from-folder` — bulk-import de PNGs huérfanos al
    `gifts.json`. Devuelve `{imported, updated, skipped}`.
- **Hook `on_gift_image_detected`** — punto de entrada para el TikTok
  worker; integra GiftDownloader (G2.5) + persistencia atómica.
- **Hook `increment_received`** — el TikTok worker llama esto al recibir
  un gift para alimentar el counter de la UI.

#### Renderer state (G3.1)
- **NUEVO**: `apps/desktop/src/renderer/lib/store/gifts-slice.ts` con el
  catálogo cacheado, search/sort/filter state y selectedGiftId.
- **NUEVO**: `apps/desktop/src/renderer/lib/use-gifts.ts` — hook con
  CRUD optimista (`upsert`/`remove` aplican local antes de RPC, refresh en
  caso de error), auto-load on mount, derivación filtrada/ordenada via
  `useMemo`. 4 órdenes: `coins-desc/coins-asc/name-asc/received-desc`.

#### Componentes UI (G3.2)
- **NUEVO**: `apps/desktop/src/renderer/components/dialogs/gifts/`:
  - `GiftCard.tsx` (110×135) — tile del grid con MaruImage + emoji
    fallback, badge de recibidos, foco accesible, doble-click confirma.
  - `GiftPreviewPanel.tsx` (180×180) — preview detallado con metadata
    completa (id, name, coins, path, recibidos).
  - `GiftEditForm.tsx` — formulario inline create/edit con validación
    (name no vacío, coins >= 0, id único en create) + delete.

#### GiftsDialog (G3.3)
- **NUEVO**: `GiftsDialog` (modal `xl` ≈950×750) — gestor visual completo:
  toolbar (search + sort + show-disabled + import-folder + recargar +
  nuevo) │ grid con auto-fill 110px+ │ side-panel preview+edit │
  footer con reset-counters.
- **`Dialog` extendido**: nuevos sizes `xl`/`2xl` + prop `bodyFlush`
  para layouts con grid + sidebar de altura fija (max 80vh, 800px).
- Cableado en `ModalRoot.tsx`: `activeModal === 'gifts'` ahora abre el
  dialog real (reemplaza el placeholder de G1).

#### GiftSelectorDialog (G3.4)
- **NUEVO**: `GiftSelectorDialog` (modal `lg` ≈750×550) — picker reusable
  para flujos donde el usuario elige UN gift (lo consumirán RuleDialog G6,
  fortuna, sounds...).
- API: `excludeIds[]` para esconder gifts ya usados, `initialId` para
  preselección, `Enter`/double-click confirma.

#### Fix bug heredado de G2 (G3.5)
- **G2 caveat resuelto**: `lookup_gift("TikTok")` ahora encuentra el
  archivo `TikTok (2).png` correctamente. Antes caía al placeholder
  porque el normalizer no manejaba sufijos de duplicado.
- **NUEVO** helper `_canonical_stem()` en `images.py` con regex que
  strip `(N)`, `[N]`, `_N`, `- copia`, `- copy`.
- **`_scan_donaciones`** indexa ahora 2 pasadas: primero stems "limpios",
  luego stems con sufijo (estos solo registran su canonical si no había
  ya un archivo limpio con ese nombre).
- **`lookup_gift`** prueba además canonical + variantes underscore↔espacio.
- Tests manuales: `Heart Me`/`heart me`/`Heart_Me` → todos resuelven a
  `Heart_Me.png`. `TikTok` → `TikTok (2).png`. `NoExiste` → placeholder.

#### Smoke G3.6
- ✅ Sidecar: 76 métodos RPC registrados, 6 son `donations.*`.
- ✅ DonationsService lifecycle completo (list → upsert → list → scan
  → increment → reset → delete).
- ✅ Migración F0-F8 → MARU funciona con backup automático y
  resolución de icon_paths contra el bundle de 413 PNGs.
- ✅ ImageIndex.lookup_gift con sufijos `(N)` resuelto.
- ⚠️ 6 errores TS preexistentes en `packages/ui` (lucide-react /
  @maru/shared deps faltantes desde F0) — known issue, planificado
  para G14 cleanup. NO los introduce G3.

---

## 0.6.0-alpha — 2026-04-27 · 🟢 G2 image system

### G2 — Sistema de imágenes (custom protocol + LRU + auto-descarga)

#### Bundle (G2.1)
- Copiados al bundle del Electron app: **413 PNG donaciones (18.7 MB)** +
  `_catalog.json` seed + **7 trigger icons** (78 KB) + **2.167 game_images
  + 33 _default_<cat>.png** (~50 MB) + **276 templates** (~8 MB).
- **Total bundle imágenes: ~88 MB** en `apps/desktop/resources/data/`.
- **EXCLUIDO**: `gifts_1541.zip` legacy (1.1 GB) y carpeta duplicada
  `7daystodie/` (sin underscore — el canónico es `7_days_to_die`).
- `electron-builder.yml` actualizado: bundle de imágenes va por
  `extraResources` (NO dentro del asar) → archivos sueltos en
  `process.resourcesPath/data/` para lectura eficiente.

#### Custom protocol `maru://` (G2.2)
- **NUEVO**: `apps/desktop/src/main/image-protocol.ts` con `protocol.handle`
  para resolver `maru://images/<scope>/<path>`.
- **5 scopes**: `donaciones`, `triggers`, `game/<gid>/<cat>`, `templates`,
  `userdata` (gifts auto-descargados runtime).
- **LRU cache server-side max 200 buffers**, archivos > 5 MB no se cachean.
- **Cache-Control headers** `public, max-age=86400, immutable` para que
  el renderer también cachee.
- **Path security**: rechaza `..`, drive letters, separators raros.
- **Throttled error log**: 5 fallos máx, después silencio.
- **Privilegios del scheme** registrados ANTES de `app.whenReady()` (crítico).
- **CSP actualizada**: `img-src` ahora incluye `maru:` además de `self`,
  `data:`, `blob:`, `https:`.
- Helpers exportados: `imageUrl()`, `bundleImagePath()`,
  `userDataImagesRoot()`, `pathToMaruUrl()`, `clearImageCache()`,
  `getImageCacheStats()`.

#### Image index pre-built al boot (G2.3)
- **NUEVO**: `apps/sidecar/maru_sidecar/backend/images.py` con `ImageIndex`
  + `ImagesService`. Espejo de `gui/views/images.py:_build_image_index`
  + `_get_entity_icon`.
- Pre-scan del bundle al primer lookup → **413 gifts** + **7 triggers** +
  **138 templates** + **35 category_defaults** + **7 games**.
- **Lookup con 11 variantes** del nombre (cmd, display, lower, underscore,
  safe_cmd, etc.) — espejo del original.
- **LRU cache O(1)** max 1000 lookups parametrizados.
- **6 RPC methods nuevos**: `images.lookup-entity`, `images.lookup-gift`,
  `images.lookup-trigger`, `images.get-default`, `images.stats`,
  `images.rebuild`.
- `runtime.py` extendido con `BUNDLE_DATA_DIR`, `BUNDLE_DONACIONES_DIR`,
  `BUNDLE_TRIGGERS_DIR`, `BUNDLE_GAME_IMAGES_DIR`, `BUNDLE_TEMPLATES_DIR`,
  `USERDATA_DONACIONES_DIR`. Detección dev/prod (PyInstaller).

#### `<MaruImage>` componente reusable (G2.4)
- **NUEVO**: `packages/ui/src/components/MaruImage.tsx`.
- API: `<MaruImage scope="donaciones" path="Rose.png" size={48} />`.
- **3 estrategias de loading**: `lazy` (default, native), `eager`,
  `intersect` (IntersectionObserver con rootMargin 200px para grids
  grandes).
- **Fallback chain**: prop `fallback` puede ser `{scope, path}` u otro
  PNG, o un emoji string como último recurso.
- **Fade-in 200ms** automático al cargar (respeta `prefers-reduced-motion`).
- **Helper `maruImageSrc()`** standalone para uso en CSS background-image
  o atributos.
- Exportado desde `@maru/ui`.

#### Auto-descarga de gifts en vivo (G2.5)
- **NUEVO**: `apps/sidecar/maru_sidecar/backend/gift_downloader.py`.
- `GiftDownloader.detected()` replica `gui/views/images.py:_on_gift_image_detected`:
  detect → check existing → lock dedup → requests.get → PIL convert RGBA →
  inject tEXt metadata → save a `userdata/donaciones/`.
- **`inject_png_metadata()`** + **`read_png_metadata()`** — chunks `tEXt`
  con `Gift-Name` + `Gift-Coins`.
- **`safe_filename()`** + **`normalize_gift_name()`** sanitización
  espejo del original (regex + replace).
- **`resolve_gift_images()`** — lookup boot mejorado: paths **RELATIVOS**
  (`donaciones/<file>`) en vez de absolutos (`C:/Users/...`) → portabilidad
  entre máquinas.
- **`migrate_absolute_paths_to_relative()`** — migración auto al boot
  para `gifts.json` viejo con paths del MARU original.
- **`backup_gifts_json_before_migration()`** — backup automático en
  `BACKUPS_DIR/gifts_pre_migration_<ts>.json` antes de migrar.

#### Letter PNG fallback + tinting (G2.6)
- **NUEVO**: `apps/sidecar/maru_sidecar/backend/letter_png.py`.
- **`LETTER_FALLBACK`** dict — 13 categorías (espejo de
  `gui/widgets/default_images.py`).
- **`draw_letter_png()`** — genera PNG 128x128 con PIL puro: rounded square
  16% + gradient overlay + border 3px + letra centrada bold.
- **`get_or_create_letter_png()`** — cache por hash en
  `CACHE_DIR/letters/<sha1>.png`.
- **`tint_png_destructive()`** — tinta PNG monocromático con `Image.composite`
  (PIL puro, sin Qt).

#### Premium polish añadido sobre paridad MARU
- **Paths relativos en `gifts.json`** → portabilidad y backups limpios.
- **LRU cache 2 layers** (main process + sidecar Python).
- **Cache-Control immutable** para que el renderer no re-pida.
- **Throttled error log** anti-spam.
- **Path traversal protection** explícito.
- **Backup automático antes de migración**.
- **Letter PNG cache O(1)** en disk con key SHA1.
- **`<MaruImage>` 3 strategies** de loading.

#### Smoke test G2 ✅
```
ImagesService stats:
  built: True
  gifts: 413
  triggers: 7
  templates: 138
  games: 7_days_to_die, hytale, minecraft, repo, ror2, terraria, valheim
  category_defaults: 35

✅ lookup_gift("Rose") → donaciones/Rose.png
✅ lookup_trigger("gift") → triggers/trigger_gift.png
✅ lookup_entity("valheim","entities","🐗 Jabalí:Boar") → game/valheim/entities/Boar.png
✅ lookup_entity("terraria","items","NonExistent") → fallback _default_items.png
✅ Pillow + requests instalados
✅ 0 errores TS nuevos por G2
```

#### Stats G2
- 7 archivos nuevos.
- 88 MB de bundle de imágenes.
- 6 RPC methods nuevos bajo `images.*`.
- 413 gifts + 2.167 game_images + 7 triggers + 276 templates indexados.

#### Caveats G2 (para refinar en G3)
- Lookup `gift_id="TikTok"` cae a placeholder porque el archivo en disco
  se llama `TikTok (2).png` (con espacio + paréntesis del catálogo
  original). El normalizador actual no maneja sufijos `(N)`. Documentado
  para G3 al construir la galería visual.

---

## 0.5.0-alpha — 2026-04-27 · 🟢 G0 audit complete + G1 visual foundation

### Notice — revert from premature 1.0.0

The previous v1.0.0 release was **prematurely tagged**. The
infrastructure (sidecar, JSON-RPC, autoupdater, packaging, backups)
was solid, but the UI lacked critical features from the original
MARU Live (415 gift gallery, multi-action rules, full social system
with 35 commands, 3-channel TTS with 74 voices, etc.).

The **real v1.0.0** will follow the **Plan G** roadmap (G1–G14)
which ports each MARU system to **100% parity** with the original.

See: [`docs/audit/MARU_PLAN_G_FINAL.md`](docs/audit/MARU_PLAN_G_FINAL.md).

### G0 — Audit complete (this release)

11 sub-phases of exhaustive audit of `LiveChaosEngine_Refactored/`:

- **75 Python files** (~26.500 lines) audited.
- **16 dialogs** documented in `docs/audit/dialogs/`.
- **5 mixins + 14 widgets + 1 controller** in `docs/audit/views/`.
- **10 core modules** (~10.000 lines) in `docs/audit/core/`.
- **15 JSON schemas** with real soykoru config stats.
- **~2.873 images** cataloged + cross-checked vs JSONs (0 missing).
- **343 features** mapped to Phase G in `MARU_FEATURE_MATRIX.md`.
- **14 phases** detailed in `MARU_PLAN_G_FINAL.md`.
- **Pre-G1 cleanup checklist** in `MARU_CLEANUP_BEFORE_G1.md`.

### G1 — Visual foundation + ventana única (Opción A)

#### Pre-G1 cleanup (eliminadas las invenciones de F0-F8)
- ❌ Themes Aurora + Cyberpunk borrados (`globals.css`, `ui-slice.ts`,
  `ThemeSelect.tsx`). **Tema único `midnight`** según Plan G.
- ❌ `routes/Welcome.tsx` con hero gradient borrado.
- ❌ `routes/Tts.tsx` (página dedicada) borrado — TTS solo vive en
  sidebar GroupBox + `voices_dialog` modal.
- ❌ `routes/Donations.tsx` mock borrado — la versión real
  (`GiftsDialog`) llega como modal en G3.
- ❌ Simulator inline en `Connection` borrado — será modal en G11.
- ❌ Las **14 routes** del HashRouter borradas. MARU original es una
  ventana única con 3 columnas + diálogos modales.
- ❌ `react-router-dom` removido de deps (no se usa).
- 📦 Componentes mock borrados: `AppShell, Sidebar (viejo), PageHeader,
  StatCard, StatusBar, SystemMetricsCard, UpdateBanner, Simulator`.

#### Versiones revertidas
- `package.json` (root): `1.0.0` → `0.5.0-alpha`.
- `apps/desktop/package.json`: `1.0.0` → `0.5.0-alpha`.
- `apps/sidecar/package.json`: `1.0.0` → `0.5.0-alpha`.

#### Design tokens · paleta MARU exacta (G1.1)
- `packages/ui/styles/globals.css` reescrito con **34 tokens
  exactos** del audit visual (`gui/constants.py` + `themes.py:midnight`).
- Background gradient diagonal `#1a1a2e → #16213e` (idéntico al original).
- 7 accents oficiales: `#f39c12 / #74b9ff / #27ae60 / #2ecc71 / #e74c3c
  / #c0392b / #9b59b6`.
- Midnight QSS palette completa (`mn-button #4a69bd`, `mn-cyan #7ed6df`,
  etc.) para paridad visual con QGroupBox/QPushButton/QLineEdit/etc.
- **Premium polish**: 5-tier elevation shadows, focus rings consistentes,
  glass blur tokens, motion tokens (fast/base/slow), z-index scale,
  scrollbar fina 6px estilo MARU.
- **Reduced motion** support para accesibilidad.
- 7 utility classes: `.maru-card`, `.maru-panel`, `.maru-groupbox`,
  `.maru-btn-primary/accent/danger/secondary`, `.maru-input`,
  `.maru-glass`, `.maru-modal-backdrop`.
- `tailwind.preset.cjs` extendido con todos los tokens nuevos
  (accent variants, mn palette, elevation shadows, z-index scale, etc.).

#### Ventana única · MainLayout (G1.2)
- Nuevo `MainLayout.tsx` con 3 columnas fijas idénticas al original:
  - Sidebar 310px scrollable izquierda.
  - Center stretch (placeholder G6).
  - LogPanel 380px derecha (placeholder G11).
- Reemplaza al HashRouter + AppShell inventados.

#### Sidebar · 7 GroupBoxes (G1.3)
- Nuevo `Sidebar.tsx` con 7 secciones que replican `_build_left_panel`:
  1. Logo MaruLive (100x100) + subtítulo "Chaos Engine v0.5.0-α".
  2. 🎵 TikTok Live (status, likes, user input, conectar btn).
  3. 🎮 Perfil de Juego (selector + Probar + Config + Añadir).
  4. 🔊 Texto a Voz (toggle, voice combo, volumen, prueba, voces, radios).
  5. 🔮 Fortuna (toggle, gift, voice, volumen, prueba).
  6. 💬 Sistema Social (toggle, configurar, minijuegos).
  7. ⚙️ Configuración (Regalos, Sonidos, Simulador, Perfiles, Respaldos,
     TikTok API, Overlays).
- Botones tienen `aria-keyshortcuts` (Ctrl+T, F5, Ctrl+Shift+S, etc.)
  preparados para G14.
- Iconos lucide-react para acciones; emojis Unicode en GroupBox titles
  (parte de la identidad MARU).
- Tooltips premium en cada botón con su atajo y descripción.

#### Splash screen 380x280 (G1.4)
- Nuevo `apps/desktop/src/main/splash.ts` con `SplashWindow` class.
- BrowserWindow frameless transparent alwaysOnTop, container interior
  `#0d0d14` border-radius 16px.
- Logo 100x100 + título "MaruLive" 28px weight 600 letter-spacing 2.
- Progress bar 3px gradient `#e74c3c → #9b59b6`, 1.5%/25ms (~1.7s).
- Glow ambiental sutil tras el logo (premium polish).
- Patrón "splash → ready-to-show → fade-out + reveal mainWindow":
  - Main window arranca con `show:false` y `setOpacity(0)`.
  - Splash hace fade-out 250ms cuando renderer + splash están listos.

#### UI primitives + ModalRoot (G1.5)
- Nuevo `<GroupBox>` primitive en `@maru/ui` (réplica QGroupBox con
  título superpuesto al borde, look QSS).
- `<Button>` rediseñado con 4 variants premium:
  - `primary` (gradient naranja accent + glow).
  - `secondary` (gradient azul Midnight QSS).
  - `ghost` (transparente con borde sutil).
  - `danger` (gradient rojo).
- `<ModalRoot>` con stack global de modales (single open at a time).
  Coloca placeholder por modal hasta que su fase G lo implemente
  (G3-G13). Cada placeholder muestra fase target + archivo origen.

#### Logo + icon en bundle (G1.6)
- `logo.png` (1.09 MB) y `icon.ico` (70 KB) copiados a
  `apps/desktop/resources/`.
- `electron-builder.yml` actualizado: `win.icon`, `mac.icon`,
  `linux.icon`. `resources/**/*` incluido en bundle.
- Main window: `BrowserWindow` recibe `icon` resuelto desde resources.
- BackgroundColor de la ventana cambiado de `#0a0b16` (genérico) a
  `#1a1a2e` (matchea bg-base del tema midnight, evita flash blanco).

### Known issues (heredados de F0-F8, fix en G14)
- `packages/ui` no declara `lucide-react` y `@maru/shared` como deps
  (los usa vía workspace resolution). Provoca 6 errores TS al
  typecheck. **Ningún archivo G1 tiene errores TypeScript.**
- `packages/ui/Input.tsx` tiene `prefix: ReactNode` incorrectamente
  tipado (HTMLAttributes lo declara como `string`).

### Stats G0+G1
- ~30 documentos de audit (~7.500 líneas).
- 7 archivos nuevos / reescritos en G1: `globals.css`, `tailwind.preset.cjs`,
  `App.tsx`, `MainLayout.tsx`, `Sidebar.tsx`, `CenterPanel.tsx`,
  `LogPanel.tsx`, `ModalRoot.tsx`, `splash.ts`, `Button.tsx`,
  `GroupBox.tsx`, `ui-slice.ts`.
- 17 archivos eliminados (cleanup pre-G1).
- 3 paquetes con versión revertida.

---

## 1.0.0 — 2026-04-27 · ⚠️ release prematuro (revertido a 0.5.0-alpha)

> **Esta versión fue revertida** porque la infraestructura era sólida
> pero la UI no portaba todo lo que hace MARU original. Se mantiene la
> entrada original abajo como contexto histórico, pero el desarrollo
> sigue con Plan G desde 0.5.0-alpha.

### Fase 8 — Cierre · MARU Desktop v1.0.0

### Fase 8 — Cierre · MARU Desktop v1.0.0

**Asistente de migración**
- `backend/migrations.py` con `migrations.status` (dry-run) y `migrations.apply`
  (atómico). Detecta el original automáticamente, valida JSON, hace backup
  full antes de pisar nada.
- 5 tests del migrator (detección, dry-run, apply, archivo corrupto, paths
  explícitos).

**Pantalla Welcome**
- `routes/Welcome.tsx` aparece al primer arranque con `localStorage.maru.welcomeSeen`.
- Lista archivos del original con tamaños y badges.
- Botón único "Importar N archivos" → backup + copia atómica + report.
- Card lateral "Lo nuevo" con 7 features destacadas.

**Dashboard mejorado**
- Polling unificado de `system.health` + `system.metrics` cada 5s.
- 4 mini-tiles de métricas (RAM/CPU/Threads/Bus) en la card Sistema.

**Bump v1.0.0**
- Versiones consistentes en todo el repo: monorepo / desktop / sidecar /
  `__init__.py` / `pyproject.toml`.
- Sidebar muestra "v1.0.0".

**Documentación final**
- `docs/PHASE_8.md` — detalle técnico del cierre.
- `docs/PARITY.md` — paridad funcional MARU original ↔ Desktop.
- `docs/USAGE.md` — manual del streamer (layout, flujo diario, atajos,
  troubleshooting, datos persistidos, variables de entorno).

**Verificación**
- 40/40 tests Python pasan.
- `pnpm quickcheck` verde.

## 0.7.0 — 2026-04-27

### Fase 7 — Empaquetado + primera prueba

**Sidecar empaquetable**
- `apps/sidecar/sidecar.spec` — PyInstaller `--onedir` con 22 hidden imports
  + 10 excludes. Sin UPX para evitar falsos positivos en AV.
- `apps/sidecar/build.py` con clean + run + verify + smoke test del binario.
- `requirements-dev.txt` agrega `pyinstaller>=6.10` y `psutil>=5.9`.

**Pulido cross-cutting**
- `.env.example` con 11 variables documentadas.
- `scripts/quickcheck.mjs` — health check completo (paths + packages + tests
  + handshake real del sidecar). Sin deps externas.
- README rehecho con tabla de scripts, estado por fase y links.
- Scripts root: `pnpm test`, `pnpm test:sidecar`, `pnpm quickcheck`.
- Version del monorepo: `0.7.0`.

**Documentación**
- `docs/FIRST_RUN.md` — guía paso a paso de primera prueba (8 pasos
  numerados + troubleshooting de 7 síntomas).
- `docs/PHASE_7.md` con detalle técnico de empaquetado y decisiones.

**Verificación**
- `pnpm quickcheck` pasa todos los checks.
- 35/35 tests Python verdes.

## 0.6.0 — 2026-04-27

### Fase 6 — Optimización RAM/CPU + observabilidad

**Renderer**
- Lazy routes con `React.lazy` + `Suspense` para 9 de las 11 rutas (mantenidas
  eager: Dashboard y Connection). Bundle inicial estimado ~340 KB vs ~520 KB.
- Manual chunks (react-vendor / router / icons / state / cn / vendor).
- `drop: ['console', 'debugger']` y `legalComments: 'none'` en producción.
- `target: 'es2022'` sin polyfills.
- Selector de Dashboard memoizado para evitar re-renders falsos en cada
  evento de TikTok.
- Hook `usePollingInterval` con auto-pausa cuando la ventana no es visible.
  Aplicado a Dashboard, Spotify, Logs y System metrics → cero IPC con la
  app minimizada.

**Sidecar**
- ThreadPool de games-io: 4 → 2 workers.
- EventBus maxsize: 1024 → 512.
- Nuevo `backend/metrics.py` con `system.metrics`: RAM/CPU/threads/bus +
  uptime. Usa `psutil` si está, fallback a APIs nativas (Linux/Mac/Win).
- Profiling opt-in con `MARU_TRACEMALLOC=1` → top 5 allocations en la UI.

**UI**
- Nueva tab **Settings → Sistema** con `SystemMetricsCard`: 4 métricas live
  + uptime + top allocations cuando tracemalloc está activo + badges
  psutil/fallback.

**Tests**: 35/35 pasan (+3 para MetricsService).

## 0.5.0 — 2026-04-27

### Fase 5 — Auto-update + telemetría + hardening

**Auto-update**
- `AutoUpdater` con `electron-updater` + GitHub Releases.
- Check al arrancar + cada 6h, download en background, install diferido.
- 8 phases tipadas (`idle/disabled/checking/available/not-available/
  downloading/ready/error`).
- Banner global en AppShell + sección dedicada en Settings → Avanzado.
- Botón "Buscar ahora" + switch para desactivar + card cuando hay update lista.

**Hardening producción**
- DevTools bloqueadas (F12, Ctrl+Shift+I/J, Ctrl+U, Ctrl+R).
- `will-navigate` cancela navegación externa → openExternal.
- `setWindowOpenHandler` deny absoluto.
- Permisos webContents negados por default.
- Activable en dev con `MARU_FORCE_HARDENING=1`.

**Telemetría opt-in**
- `@sentry/electron` como dep **opcional** (carga dinámica).
- Activación desde Settings → Privacidad con persistencia local.
- Sanitización: nunca envía contexto TikTok/Spotify ni datos del usuario.
- Hooks en `uncaughtException` y `unhandledRejection`.

**Release pipeline**
- `scripts/release.mjs` con bump → build sidecar → build electron → publish.
- Validaciones de árbol git limpio + GH_TOKEN.
- `pnpm release <patch|minor|major|x.y.z>` desde root.
- Documentación completa en `docs/RELEASE.md`.

**Configuración**
- `apps/desktop/electron-builder.yml` con NSIS (Win), DMG (Mac), AppImage (Linux).
- `extraResources` empaqueta sidecar PyInstaller (F7).

## 0.4.0 — 2026-04-27

### Fase 4 — Migración pestaña por pestaña

**Sidecar**
- Adapters reales para `rules`, `data`, `games`, `social`, `spotify`, `ia`,
  `tts`, `overlays`, `profiles`, `logs`. Stubs eliminados.
- Persistencia atómica (`.tmp` + `os.replace`) + backup automático antes
  de mutar archivos existentes.
- Validación estricta de shape en `rules.upsert` y `data.upsert`.
- `logger.py` ahora escribe a `runtime/logs/sidecar.log` con rotación
  (5 MB × 5 archivos).
- Nuevos métodos RPC: `rules.reorder`, `data.*` (5), `profiles.*` (7),
  `logs.tail`.

**Renderer**
- Página **Reglas** con editor inline, multi-acción, modo aleatorio,
  reorder con flechas, test dry-run.
- Página **Datos** con tabs por juego × kind, búsqueda debounced server-side,
  edit inline, import/export JSON.
- Páginas **Social**, **Spotify** (now-playing + controles), **IA**
  (probador inline), **Overlays** (galería con copy/test).
- Página **Stream Profiles** con save/load/duplicate/export/import.
- Página **Logs** con tail cada 2s + filtro por contenido y nivel.
- Sidebar actualizado con Profiles + Logs.

**Tests**: 32/32 pasan (+18 vs F1).

## 0.3.0 — 2026-04-27

### Fase 2 — Design system + UX foundations

**Tokens y temas**
- 3 temas operativos: Midnight (default), Aurora (claro premium), Cyberpunk (neon).
- Tokens semánticos completos: surfaces, text, accent, success/warning/danger/info,
  borders, shadows, radii, motion (3 duraciones + ease maru).
- Transición suave entre temas y respeto a `prefers-reduced-motion`.

**Primitivas UI ampliadas en @maru/ui**
- 16 componentes: Button, Card, Input/Label/TextArea, Select, Switch, Tabs,
  Tooltip, Badge, Skeleton, Empty, Spinner, IconButton, Kbd, Dialog, Toaster.
- Sistema de toasts global con store singleton + portal y API ergonómica
  (`toast.success/.error/.warning/.info`). Errores persistentes por default.

**Selector de tema y persistencia**
- `ThemeSelect` reusable, aplicado en Settings → Apariencia.
- Persistencia en `localStorage` key `maru.theme`.

**Microinteracciones**
- Animaciones Tailwind: fade-in, slide-up/down, scale-in, shimmer, pulse-soft.

**Páginas refrescadas**
- Dashboard con badge "EN VIVO", Empty state y Skeleton.
- Conexión con Input pulido, badges variante por tipo de evento, toasts.
- Settings nueva con tabs (Apariencia / Notificaciones / Avanzado / Privacidad).

**Mockups navegables**
- Site estático en `docs/design/` con 12 pantallas + catálogo de componentes.
- Switch de tema en cada vista, persistente.

## 0.2.0 — 2026-04-27

### Fase 1 — Contrato RPC completo + AppShell visual

**Sidecar**
- Contrato RPC ampliado: 40+ métodos en 10 dominios, 8 push events tipados
  en `@maru/shared`.
- `core_bridge.py` — reusa `LiveChaosEngine_Refactored/core/` sin tocarlo;
  parchea `core.paths` para que use rutas runtime nuevas.
- `runtime.py` — paths separados del original (`apps/sidecar/runtime_data/`
  en dev, `%APPDATA%/MARU Live` en prod). Override con `MARU_RUNTIME_DIR`.
- `event_bus.py` — bus thread→asyncio con FIFO+drop policy (1024 events).
- `backend/backups.py` — `BackupService` con escritura atómica, hash SHA-256,
  retención dual (edad+conteo), locks por scope, manifest indexado.
- `backend/tiktok.py` — wrap del `TikTokWorker` PyQt; lazy import de Qt;
  señales conectadas al EventBus → broadcast WS.
- `backend/settings.py` — settings con write atómico + facade de backups.
- `backend/stubs.py` — implementaciones de fase para el resto de dominios
  cumpliendo el contrato.
- `server.py` — `pump_from_bus()` que drena el bus y broadcastea push events.

**Renderer**
- Window frameless con custom TitleBar (drag region + min/max/close).
- Sidebar colapsable con iconos lucide y 8 rutas.
- StatusBar inferior con estado sidecar/rpc/tiktok + stats live.
- Store zustand reorganizado con slices por dominio.
- `event-wire.ts` que cablea todos los push events del sidecar al store.
- Página Dashboard con 4 stat cards + feed reciente + panel de sistema.
- Página Conexión con input @usuario, feed live de eventos (max 200 en memoria).

**Tests**: 14/14 pasan (4 F0 + 5 backups + 2 event bus + 3 registry expandido).

## 0.1.0 — 2026-04-27

### Fase 0 — Monorepo + handshake sidecar

- Estructura `apps/{desktop,sidecar}` + `packages/{tsconfig,shared,ui}` con
  pnpm workspaces y Turborepo.
- Contrato JSON-RPC compartido en `@maru/shared` (Fase 0 solo `ping`).
- Design system base en `@maru/ui`: tokens Tailwind con CSS vars para temas,
  `Button`, `Card`, `StatusDot`, helper `cn`.
- Electron main con `SidecarManager` (spawn + ready regex + restart con backoff
  + shutdown limpio) y `RpcClient` (JSON-RPC 2.0 sobre WS, push events, timeouts).
- Preload con `contextBridge.exposeInMainWorld('maruApi', ...)` y CSP estricta.
- Renderer React 19 con zustand y pantalla de boot que ejecuta `ping` end-to-end.
- Sidecar Python `maru_sidecar` con servidor `websockets`, registry de métodos
  y CLI que imprime `MARU_SIDECAR_READY <port>` para handshake con Electron.
- Tests: 4/4 pasando (`pytest -q` en `apps/sidecar/tests`).
- Documentación: `README.md` raíz, `docs/PHASE_0.md`, `apps/sidecar/README.md`.
