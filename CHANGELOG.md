# Changelog — maru-desktop

## 1.0.48 — 2026-05-03 · ✨ Triggers emote/join + repeat por rol + temas distintos + búsqueda por valor

### Backend / sidecar

- **Trigger `emote`**: nueva regla cuyo trigger_value es el `emote_id`
  del sticker del streamer. Cuando un viewer envía ese emote la regla
  dispara. Validación en backend `rules.py` + match en `rule_engine`.
- **Trigger `join`**: cuando un viewer entra al live. Si
  `trigger_value` está vacío, dispara para cualquier user; si trae un
  username, dispara solo para ese user específico. Cableado el
  `JoinEvent` de TikTokLive 6.6.5 que NO estaba conectado antes.
- **Log entry de joins**: throttled 1.5s (evita inundar al inicio del
  live cuando llegan decenas/segundo). Categoría `tiktok` para que
  no rompa filtros existentes.
- **Multiplicador por rol/nivel** (`repeat_for`): nuevo campo opcional
  en cada regla. Si está enabled y el user del evento cumple
  rank/level, las ejecuciones se multiplican × times. Roles soportados:
  mod, superfan, donor, follower, member (con `level_min`/`level_max`
  para filtrar por rango de nivel).

### Frontend / UI

- **Búsqueda de gifts por valor en diamantes**: si el query es
  100% numérico (`100`, `5000`), filtra TAMBIÉN por `coins == query`.
  Aplica a TODAS las galerías (suerte, reglas, sounds) porque usan el
  mismo `useGifts.deriveVisible`.
- **EN VIVO** del header: gap entre `@user` y `EN VIVO` (antes
  pegados).
- **Hero card del logo** rediseñado: doble capa con halo accent
  superior tipo "luz cayendo del logo", inset highlights, viñeta
  inferior. Más radio (2xl) y padding más generoso.

### Temas: diferenciación radical
Cada tema (excepto Pure Dark, que no se tocó) ahora tiene su PROPIA
identidad cromática de fondo y glows, no solo un accent distinto:
- **Midnight** (default): violeta-índigo profundo signature MARU.
- **Dracula**: bg ahora violeta-noche real, glows pink/purple muy
  visibles.
- **Tokyo Night**: bg azul-marino oceánico con glows azul/cyan.
- **Catppuccin Mocha**: bg cálido marrón-violeta con glows rosa/peach.
- **Nord**: bg ártico glacial con glows frost cyan/teal.

Ahora los temas se distinguen al primer vistazo.

## 1.0.47 — 2026-05-03 · 🩹 Comments individuales + Spotify autostart con accounts + format 1.1k

### Comentarios desagrupados
Quitado `comment` del set GROUPABLE — los comentarios se ven uno por
uno (cada texto es único, agruparlos perdía información). Likes, gifts,
shares, follows, commands, sounds siguen agrupándose.

### Spotify auto-start: bug raíz
**Bug**: el listener de `tiktok:status` exigía credenciales en
`spotify.json` antes de hacer warm-start. Pero el user puede tener
cuentas guardadas en `spotify_accounts.json` SIN credenciales activas
en el config principal (caso común: cerró la app sin reconectar).

**Fix**: si no hay `client_id`/`client_secret` en el config pero SÍ
hay accounts guardadas, hidratamos la primera al config y disparamos
`_ensure_client`. Resultado: al iniciar el live, Spotify se prende
solo aunque no hayas tocado nada.

### Stats counter compact 1.1k
**Bug**: el tile de Likes es chiquito y `1247` ya quedaba apretado.
`11000`, `120000` salían cortados.

**Fix**: helper `formatCompact` aplicado al `format` de CountUp.
- 999 → "999"
- 1247 → "1.2k"
- 11000 → "11k"
- 1100000 → "1.1M"

Tooltip muestra el número completo `1247` para que no pierdas precisión.

## 1.0.46 — 2026-05-04 · 🔬 Log raíz: agrupación correcta + counter real

Auditoría completa del log. 3 bugs raíz cerrados.

### Likes en log: agrupación rota
**Síntoma**: a veces aparecía "@gottina dio 2 likes" + "@gottina dio
15 likes" como entries separados en vez de un solo bucket.

**Bug raíz #1 — batcher 1.5s del sidecar fragmentaba**: el
`_batch_like_for_log` acumulaba 1.5s sin nuevos likes y emitía. Si
el viewer pausaba 2s entre ráfagas, se generaban 2 entries — y el
front ya no podía re-agruparlos.

**Bug raíz #2 — grouping front exigía consecutivos estrictos**: si en
medio de la racha de likes de @gottina llegaba 1 comment de @otro,
el bucket se rompía y los siguientes likes de @gottina aparecían
individuales.

**Fix integral**:
- Sidecar emite UN log:entry POR EVENTO del worker (cada batch real
  de TikTok WS = 1 entry con `meta.count` correcto). Sin batcher local.
- Frontend `groupConsecutive` reescrito con anchor por (categoría,
  user). Agrupa todos los entries del mismo (cat, user) dentro de la
  ventana 60s — INCLUSO si hay entries intercalados de otros users.
  El bucket se renderiza en la posición del primer entry; los
  siguientes "desaparecen" del flujo y aparecen al expandir el chevron.
- `count` del bucket = Σ meta.count (no N° de entries). "@gottina × 47
  likes" muestra likes reales.

### Stats counter "Likes" arriba: contaba entries, no volumen
**Bug raíz #3**: `StatsCounters` hacía `out[cat] += 1` por entry. Cada
entry "dio 50 likes" sumaba 1 al counter "Likes" (debía sumar 50).

**Fix**: `out[cat] += meta.count ?? 1`. Ahora el contador refleja
likes REALES recibidos, no entries del log.

### Categorías agrupables ampliadas
- like, gift, share, follow, comment, command, sound, **rule** (NUEVO).
  Si una regla ejecuta 50 veces por un batch de likes, las 50
  ejecuciones se agrupan en un bucket "✅ regla → acción × 50".

## 1.0.45 — 2026-05-04 · 🧹 Log limpio: likes batched + ruido suprimido

### Likes en log: batched + agrupado
**Bug raíz**: el legacy `tiktok_client` emitía un `log_message` crudo
por CADA like ("❤️ @user +N likes (Total: X)") sin `category=like` →
no se agrupaba, inundaba el panel y duplicaba info que ya está en los
stats counters arriba.

**Fix dos capas**:
1. Removido el `log_message.emit` legacy para likes (estaba en
   `tiktok_client.on_like`).
2. Nuevo `_batch_like_for_log` en `tiktok.py` que acumula likes por
   user y emite UN solo `log:entry` con count agregado tras 1.5s sin
   nuevos likes del mismo user. Categoría `like` real → el
   log-grouping del frontend lo agrupa visualmente con otros usuarios.

Resultado: en vez de 50 entries "+1 likes (Total: 1234)", "+1 likes
(Total: 1235)"… ahora UN entry "❤️ @user dio 50 likes" que se
agrupa con otros usuarios si vienen en simultáneo.

### Ruido del log suprimido
Filtros nuevos en `_on_log_message`:
- `❤️ @...` (likes individuales del worker — superseded por el batcher).
- `❤️ Likes iniciales` (mensaje de calibración al boot).
- Mensajes de reintento de conexión (`intento N`, `reintentando en`,
  `backoff`, `retrying in`) — quedan en stderr para diagnóstico, no
  inundan el panel del streamer.

Stats counters arriba (LogPanel) y record_tap del SocialSystem siguen
en TIEMPO REAL — la limpieza solo afecta el panel visual de eventos.

## 1.0.44 — 2026-05-04 · 🔧 7 bugs raíz: versión 0.0.0 + Spotify auto + sounds scope + taps 500 + NowPlaying clicks + log groupings

### Versión "0.0.0" en header
**Bug raíz**: el handler IPC `app:get-version` usaba
`process.env['npm_package_version']` que solo existe bajo `pnpm run`.
En el .exe empaquetado ese env no está → fallback "0.0.0".

**Fix**: usar `app.getVersion()` (de electron). Lee package.json embebido
en el asar, funciona en dev y prod.

### Spotify auto-load al iniciar live
**Antes**: había que clickear "Conectar Spotify" cada vez (o esperar al
scheduler post-boot de 8s).

**Fix**: `SpotifyService` se subscribe al bus event `tiktok:status`. Cuando
el live arranca y hay credenciales persistidas en `spotify.json`, se
dispara warm-start en thread aparte (no bloquea el sidecar).

### Sounds: profile manual independiente del juego activo
**Bug raíz**: `_resolve_scopes` priorizaba `activeGame` del config. El
user no podía elegir un perfil de sonidos y mantenerlo — al cambiar
de juego, el perfil cambiaba sin querer.

**Fix**: nuevo campo `soundsScope` en config.json (persiste el scope
elegido por el user). El resolver lo usa con prioridad sobre
`activeGame`. RPCs nuevos: `sounds.scope.get` y `sounds.scope.set`.
El SoundsDialog persiste cada cambio del dropdown automáticamente
y carga el preferido al abrir.

### Sounds: log entry agrupable cuando se reproduce
- Cada `play_for_gift` y `play_for_event` emite `log:entry`
  category=sound con `meta.gift_id` o `meta.event_id`.
- El log-grouping ahora agrupa eventos `sound` consecutivos con el
  mismo gift/event id (10 rosas seguidas → bucket "🔔 sonido rosa × 10").

### NowPlayingCard: botones play/pause/skip no funcionaban
**Bug raíz**: `.maru-np-controls` y `.maru-np-content` ambos tenían
`z-index: 2`. Como `np-content` viene después en el DOM y tiene
`height: 100%`, su área cubre los botones de la esquina superior
derecha y secuestra los clicks.

**Fix**: `z-index: 3` en los controles. Bonus: el botón de la izquierda
ahora abre Spotify config (más útil que un skip-back duplicado).

### Log groupings ampliados
- Antes solo agrupaba `like/gift/share`. Ahora también `follow`,
  `comment`, `command`, `sound`.
- Para sonidos sin user definido, el agrupador usa `meta.gift_id` /
  `meta.event_id` como discriminador.

### Taps: contar precisos al recibir 500 likes
**Bug raíz**: en `tiktok_client.on_like` el cap `0 < new_likes < 500`
truncaba a 1 cualquier ráfaga de exactamente 500 o más. Por eso "500
taps reales" se contaba como 1.

**Fix**: cap subido a `<= 5000` (un único event con 5000+ likes nuevos
es señal de mala calibración, no de tráfico real).

## 1.0.43 — 2026-05-03 · 🔴 Bugs raíz: TTS dice "usuario" en vez de números + autoscroll + audios encimados

Sesión de fix raíz a 6 bugs reportados por user. Cero parches.

### TTS leía "usuario" en vez de números
**Bug raíz**: `sanitize_text_usernames` en `backend/utils/tts_text.py`
saneaba CUALQUIER token con dígitos como si fuera un username sucio.
Convertía "12" en "usuario" porque el filter `_NON_LETTER_RE` removía
los dígitos, dejando string vacío → caía en el fallback "usuario".

Resultado: TTS leía "Te quedan **usuario** usos hoy" en vez de
"Te quedan **3** usos hoy" (!playfan), y "Llevas **usuario** días"
en vez de "Llevas **12** días" (auto-racha).

**Fix**: ahora solo se sanea cuando el token combina LETRAS + caracteres
problemáticos (`@`/`_`/dígito). Tokens que son SOLO números pasan
intactos — el TTS los pronuncia como "doce", "tres", etc.

### Auto-scroll del log dejaba 1-2 filas atrás
**Bug raíz**: el efecto setea `scrollTop = scrollHeight`, pero el
contenedor usa `content-visibility: auto` por fila (`data-cv-auto-row`),
que SUBESTIMA `scrollHeight` mientras los hijos no están materializados.
Cada nueva entry quedaba visible "casi" pero 1-2 filas debajo del fondo.

**Fix**: usar `lastElementChild.scrollIntoView({block: 'end'})`. Fuerza
al browser a hacer layout del nodo y scrollearlo a la vista. Cero
dependencia del scrollHeight calculado.

### Audios TTS encimados de canales distintos
**Bug raíz**: los 3 canales pygame (chat/social/fortune) son
verdaderamente independientes — cuando hay items en cola simultánea,
los workers llaman `channel.play()` al mismo tiempo y los audios suenan
encimados.

**Fix**: nuevo `_global_play_lock` en `tts_engine.py`. Cada
`_play_on_*_channel` envuelve `channel.play() + while busy` con
`with self._global_play_lock:`. Las colas siguen independientes,
pero la reproducción se serializa: cada audio espera turno.

### Logo del header con marco feo
**Bug raíz**: `.header-v140-mark` tenía `background: linear-gradient`
+ `box-shadow: 0 4px 12px rgb(accent/0.4)`. Con el logo PNG real
encima, el cuadrado de fondo competía visualmente y se veía como un
"marco" cuadrado feo alrededor del logo.

**Fix**: el container ahora es 100% transparente. El logo respira solo
con un `drop-shadow` sutil. Tamaño 32→36px para mejor presencia.

### Hero card del logo más grande/respira
- Logo 88→108px, drop-shadow doble (negro + accent tinted), tracking
  más pronunciado en subtitle.

### Temas: contraste de texto en botones claros
Warnings amarillos/peach en Dracula, Tokyo Night, Catppuccin Mocha y
Nord eran demasiado claros para texto blanco encima. Bajados a tonos
ámbar saturados que respetan WCAG AA con `text-white`.
- Dracula warning: #ffb86c → #e68246
- Tokyo Night warning: #ff9e64 → #dc824b
- Catppuccin warning: #fab387 → #dc824b
- Nord warning: #ebcb8b → #c8913c

## 1.0.42 — 2026-05-03 · 🩹 Doble click = copiar (no borrar) + Pure Dark legible

Fix de regresión sobre v1.0.41 según feedback del user.

### Doble click en log → copiar al portapapeles
- Se removió la lógica de "ocultar entrada" introducida en v1.0.41
  (`hiddenIds` set local). Ahora doble click COPIA el texto de la
  entrada al clipboard:
  - Entrada normal: `[HH:MM:SS] mensaje`
  - Bucket (racha): cada entry con su timestamp, una por línea.
- Flash visual verde 700ms sobre la fila copiada (animation
  `maru-log-copied`, composite-only).
- Tooltip actualizado: "Doble click para copiar esta entrada".

### Pure Dark — texto legible en botones de color
- El accent blanco-azulado claro (`#dce6ff`) era ilegible con
  `text-white` encima de los botones primary. Cambio a azul medio
  saturado (`#3b82f6`) que mantiene el look monocromo frío del tema
  pero garantiza contraste WCAG AA.
- El warning amarillo claro (`#fac850`) también dejaba ilegible el
  texto blanco/claro encima — pasa a ámbar oscuro (`#d97706`).
- Glows y bg-glow del tema actualizados al nuevo accent.

Reglas duras cumplidas: cero handlers tocados, cero RAM extra.

## 1.0.41 — 2026-05-03 · 🎨 Pulido del redesign + 2 temas nuevos + foto streamer real

Iteración sobre v1.0.40 con feedback directo del user. 11 fixes
visuales sin tocar lógica de negocio. Build limpio sin nuevos errores TS.

### Duplicaciones removidas
- ThemeSwitcher viejo eliminado del Sidebar (queda solo el de arriba
  con 4 swatches en HeaderGlobal). Sin pérdida de funcionalidad: el
  switcher del header tiene los 6 temas y persiste igual.
- SystemHealthWidget removido del LogPanel (los 4 estados ya están
  arriba en HeaderGlobal).

### Auto-scroll del log mejorado
- Coalescer con `requestAnimationFrame`: bajo ráfagas (50+ entries/s)
  hacemos UN solo `scrollTop` por frame.
- Flag `programmaticScroll` para no desactivar autoscroll cuando el
  scroll es nuestro (no del user).
- Threshold "atBottom" 20px → 60px (más tolerante a un toque de rueda).
- Doble click en cualquier entrada del log la oculta localmente (set
  `hiddenIds` en LogPanel). Se resetea al limpiar el log.

### StatsCounters re-diseñado
- Cada contador ahora es tile vertical: emoji + número + label corta.
  Antes "👤" parecía "Usuarios" — ahora dice "Nuevos" claramente.
- Likes incluye `like_milestone` (que llegaba como categoría aparte
  y no se sumaba al contador).
- Labels: Regalos · Nuevos · Shares · Likes · Chat · Reglas.

### Hero card del logo
- Padding 22→28px, border-radius xl→2xl, sombra exterior añadida,
  halo accent superior con radial gradient. Más premium.

### Avatar real del streamer
- Sidecar emite `avatarUrl` en el `tiktok:status` cuando termina el
  handshake (ya extraía la URL del room_info, ahora la propaga al
  renderer).
- Slice `tiktok-slice` agrega `tiktokAvatarUrl: string` + setter.
- Card TikTok del Sidebar y el header global muestran `<img>` real
  con fallback a iniciales si la URL falla. Browser cachea — cero
  RAM agregada significativa (24px PNG ≈ 3KB).

### Header global pulido
- Logo placeholder "M" reemplazado por `logo.png` real.
- Subtitle muestra `vX.Y.Z` real desde `app.getVersion()` (ya estaba,
  solo más claro).
- Avatar + handle del streamer aparece a la derecha del brand cuando
  hay live activo, con ring verde y tag "EN VIVO".

### Layout de Configuración
- Grid 2-cols con TODOS los botones del mismo tamaño. El último botón
  (impar — "TikTok API") usa `col-span-2` para no quedar aislado en
  una fila propia con espacio vacío. Visualmente uniforme.

### Botones globales más profesionales
- `rounded-md` → `rounded-lg` (10px) en todos los Button.
- Hover `brightness-110` simultáneo con lift + glow → feedback más
  rico sin coste.
- Active `scale-[0.99]` en vez de `[0.98]` (más sutil, peso físico).
- Ghost variant: `backdrop-blur-sm` + border más fino → glass-like.
- `will-change-transform` para promotion GPU permanente.

### 2 temas nuevos
- **Pure Dark** (⚫): negro absoluto premium. Para OLED y minimalismo.
  Acento blanco-azulado frío.
- **Nord** (❄️): paleta nordtheme.com famosa en dev community. Frost
  cyan signature, polar night base.

Total: **6 temas** ahora (Midnight, Dracula, Tokyo Night, Catppuccin
Mocha, Pure Dark, Nord). Cero RAM extra — son solo tokens CSS.

### Reglas duras cumplidas
- ✅ Cero handlers/refs/useEffects rotos.
- ✅ Cero botones eliminados (solo movidos para verse mejor).
- ✅ Cero RPC nuevos.
- ✅ Cero RAM extra (avatar es nativo del browser).
- ✅ Build limpio (vite + tsc sin errores nuevos).

## 1.0.40 — 2026-05-03 · ⭐ Redesign visual 1→1000 (sin push hasta validación)

Reescritura visual completa **sin remover ni un solo botón existente,
sin RAM extra, sin re-renders adicionales**. Todo es CSS + componentes
nuevos que envuelven (no reemplazan) la lógica existente. Build limpio
en 6 fases incrementales con smoke build entre cada una.

### FASE V1 · Header Global (56px)
- Nuevo componente `HeaderGlobal.tsx` con brand mark gradient,
  status pill (TikTok/Sidecar/Spotify/TTS), 4 swatches del theme
  switcher y CTA del updater.
- `MainLayout` ahora es `flex-col`: header arriba + las 3 columnas
  intactas debajo. Paridad EXACTA con la composición previa.

### FASE V2-V3 · Hero card del logo + TikTok card premium
- Reemplazo del bloque del logo por `.maru-hero-card` con mesh
  gradient animado (3 blobs flotando, GPU compositing).
- TikTok GroupBox conserva título + handlers + input + botón connect,
  pero ahora muestra avatar circular con iniciales + badge LIVE
  pulsante cuando conectado + stats en 3 tiles modernos.

### FASE V4 · Now Playing card (Spotify)
- Nuevo `NowPlayingCard.tsx` que aparece SOLO cuando Spotify está
  conectado. Background con gradient HSL derivado del nombre del track
  (cero requests extra), scrim oscuro, controles glass (skip/toggle/skip).
- El botón "Spotify" del GroupBox de Configuración sigue disponible.

### FASE V5 · LogPanel feed cinemático
- `LogEntryRow` ahora es card pill con icono coloreado por categoría,
  body con who+what+meta y ts mono a la derecha.
- `LogBucketRow` ahora es card kind-{like|gift|share} con badge ×N
  grande en color de la categoría y chevron rotante al expandir.
- Mantiene 100% la estructura: dedupe, filtros, virtualización,
  autoscroll, bucket grouping, content-visibility.

### FASE V6 · Tabs underline animado
- Tabs del CenterPanel con indicador degradado accent→purple, glow,
  animación de scale-in al cambiar de tab.

### Reglas duras cumplidas
- ✅ Cero botones eliminados.
- ✅ Cero handlers/refs/useEffects modificados.
- ✅ Cero RPC nuevos.
- ✅ Cero RAM extra.
- ✅ `prefers-reduced-motion` respetado por la regla global existente.
- ✅ Smoke build limpio tras cada fase.

## 1.0.39 — 2026-05-02 · 🔴 !playfan raíz + TTS plomería + log agrupado + visual polish

Sesión de 4 fases atacando todo desde la raíz, sin parches.

### FASE 1 · Fix `!playfan` raíz (3 bugs en 1)

**Bug A — `playfan_uses` nunca se aplicaba al cliente legacy.**
`spotify.py:_ensure_client` llamaba `c.configure(priority_users=list(keys))`
pasando solo nombres. El cliente legacy convertía a `set()` y dejaba
`playfan_uses = {}`. Resultado: `playfan_request` veía `max_uses=0` y
devolvía "no tienes usos de playfan configurados" — el TTS lo leía
truncado/raro y al user le sonaba como "tiene usuarios activos".
Fix: tras `configure`, llamar `_apply_priority_users_to_client()`
explícitamente. `_apply_priority_users_to_client` ahora pobla SIEMPRE
ambas estructuras (`priority_users` set + `playfan_uses` dict), no solo
en el branch fallback.

**Bug B — `_playfan_used` vivía solo en memoria.**
Cualquier reinicio de MARU (auto-update incluido) reseteaba el contador
y el comando se volvía "infinito". Fix: nuevos métodos
`SpotifyClient.restore_playfan_state(used, date_iso)` y
`get_playfan_used_today()` + hook `on_playfan_state_changed` que el
sidecar registra. `spotify.json` ahora persiste `playfan_used` y
`playfan_used_date`. Reset diario sigue automático (descarta el dict si
la fecha persistida es de ayer).

**Bug C — UI no mostraba consumo por usuario.**
`super_fans_list` extendido con `usedToday` + `remaining` por user.
`SpotifyConfigDialog` agrega badge `X/Y` con color por intensidad
(verde <50%, amarillo 50-80%, naranja 80-100%, rojo lleno) y tooltip
con el detalle. Push event `spotify:playfan-state` repinta el badge
sin esperar al poll de 30s.

### FASE 2 · TTS plomería (3 huecos cerrados)

1. **Sanitización universal de username**. `tts.speak` ahora pasa
   `sanitize_text_usernames` SIEMPRE (incluido el comentario libre del
   viewer). La función solo limpia tokens con `@`/`_`/dígitos, así que
   el comentario natural queda intacto pero `@cristian_rivasxd hola`
   ya no trunca el audio.
2. **Overflow visible**. `_queue_chat_audio` antes descartaba en
   silencio cuando la cola chat alcanzaba 30 items. Ahora loguea una
   línea WARN throttleada cada 5s (`TTS chat saturada (X/30) —
   descartando hasta drenar`).
3. **Retry HTTP 429**. `tts_engine._gen` antes caía al else genérico y
   descartaba el chunk. Ahora respeta `Retry-After` (clamp 1-10s) o
   hace backoff exponencial 1s → 2s → 4s, hasta el cap `max_retries=3`.

### FASE 3 · Log overhaul (agrupación expand/collapse)

Nuevo módulo `lib/log-grouping.ts` (puro, memoizable). Eventos
consecutivos `like`/`gift`/`share` del mismo user dentro de 60s se
colapsan en un `LogBucket` con badge `@user × N likes` + chevron.
Click expande las entradas individuales con misma estructura de fila.
La identidad del bucket es estable (sobrevive a re-renders mientras la
racha siga viva), así el estado expand/collapse no se resetea.
Comments y commands NO se agrupan (cada uno tiene contenido único).
Filtros 1:1 con categorías (ya estaban perfectos).

Bonus: timestamps suben a 90% opacidad por default (eran 70% — había
que hacer hover para leerlos).

### FASE 4 · Visual 100→1000 (CSS-only, GPU)

Nuevas utilidades en `globals.css` — todas opt-in, composite-only:

- `.maru-live-dot` — punto verde respirando (animación `maru-breath`,
  solo box-shadow + opacity).
- `.maru-skeleton` — shimmer placeholder con gradient + transform.
- `.maru-header-shine` — gradiente animado MUY lento (30s) detrás de
  headers, solo `background-position`.
- `.maru-row-lift` — micro-lift `translateY(-1px)` para filas densas.
- `.maru-icon-pop` — bounce de entrada para badges nuevos.

Aplicado en: header del Sidebar (logo), filas de SuperFans, badge de
usos. Cero RAM extra, cero JS, respeta `prefers-reduced-motion`.

## 1.0.35 — 2026-05-01 · 🎚️ FASE 4: VolumeSlider premium + warmup que pobla store

Ataca dos issues reportados por user:
1. Sliders de volumen no eran fluidos (lag visible al arrastrar).
2. Modales mostraban "Cargando…" la primera vez que abrías.

### 1) VolumeSlider premium con state local + debounce

**Problema raíz**: cada `onChange` del slider disparaba un RPC al
sidecar inmediatamente. Al arrastrar el slider eso era 60+ RPCs/seg
→ spam de red, lag visible en la UI, tracker behind del valor real.

**Fix**: nuevo componente `@maru/ui/VolumeSlider` con:
- **State local instantáneo** (`localValue`): la UI se actualiza a
  60fps sin esperar respuesta del sidecar.
- **Commit debounced 150ms**: solo persiste al sidecar después de que
  el user paró de mover. Si suelta antes (`onMouseUp`/`onTouchEnd`/
  `onKeyUp`), commit inmediato sin esperar el debounce.
- **Track con gradient proporcional** al valor (premium look) — la
  parte rellena con `accent` del tema, la parte vacía neutro sutil.
- **Thumb premium** con glow expansivo al hover (`scale(1.2)`) y al
  drag (`scale(1.3)` + ring 8px). Spring easing en el scale.
- **GPU layer** (`translateZ(0) + backface-visibility:hidden`) para
  eliminar sub-pixel jitter en Windows.
- **Tabular nums** en el badge del % para que no "salte" el ancho
  cuando cambia 99→100.
- Compatible webkit (Chromium/Electron) + Firefox.

**Aplicado en los 5 lugares con sliders de volumen**:
- `Sidebar.tsx` → TTS Chat (volume_chat)
- `Sidebar.tsx` → Fortuna (volume_pct)
- `SoundsDialog.tsx` → Sonidos (sounds.volume)
- `social/GeneralTab.tsx` → Canal social (config.volume)
- `tts/TtsConfigPanel.tsx` → Chat / Social / Fortuna (volume_chat,
  volume_social, volume_fortune) — 3 sliders en uno

Resultado: mover los sliders es 100% fluido, sin lag, sin spam de
RPCs. El sidecar recibe SOLO el valor final cuando el user suelta o
deja de mover 150ms.

### 2) Cache warmup que POBLA el store (no solo el sidecar)

**Problema raíz**: el warmup de v1.0.34 hacía `rpcCall('gifts.list')`
directo, lo cual calentaba el cache del sidecar Python pero dejaba el
store del renderer en `status: 'idle'`. Cuando el user abría el modal
de Gifts, el hook leía `status === 'idle'` y disparaba `refresh()`
otra vez → spinner "Cargando…".

**Fix**: el warmup ahora **pobla el store directamente** con
`useAppStore.getState().setGifts(r.gifts)`, lo cual setea
`status: 'ready'` automáticamente. Cuando el modal abre, el hook ve
status='ready' y NO refresca.

Para configs (social, spotify, ia, tts) un `rpcCall` simple alcanza
porque el sidecar Python cachea internamente — la 2da llamada es
instantánea.

11 warmups con stagger 80ms para no saturar el sidecar:
- `donations.list` → store gifts (con setGifts)
- `tts.list-voices` (warmup sidecar)
- `games.list`
- `sounds.list`
- `social.config.get`
- `spotify.config.get`
- `ia.config.get`
- `tts.config.get`
- `tts.user-voices.list`
- `spotify.accounts.list`
- `profiles.list`

Resultado: cuando el user abre cualquier modal (Gifts, Voces,
Sonidos, Spotify, Social, IA, TTS), no hay spinner. Datos ya en
store o cacheados en sidecar.

### Garantías técnicas (intactas)

- ✅ Sidecar Python ni se mira (los RPCs son los mismos).
- ✅ Main process Electron ni se mira.
- ✅ Push events bus, store Zustand intactos.
- ✅ Regex de logs con emojis intactas.
- ✅ Anti-flicker `.maru-bg-shell` mantenido.
- ✅ Auto-update electron-updater 6.3.9.

### Métricas

- CSS bundle: ~65.15 → ~66.5 KB (+1.35 KB volume slider styles).
- JS bundle: 117.52 → 119.19 KB (+1.67 KB warmup + VolumeSlider).
- Build limpio en 1.87s.
- Mover slider: 0 RPC/seg durante drag, 1 RPC al soltar (era 60+/seg).
- Modal abre: instantáneo en lugar de 200-500ms con spinner.

---

## 1.0.34 — 2026-05-01 · 🎬 FASE 2 + 3: microinteracciones + boot ultra rápido + bug fix LogPanel

Combinación de FASE 2 (microinteracciones premium) y FASE 3 (boot ultra
rápido + perf adicional) en una sola release. Sin tocar lógica del
sidecar/main/RPCs. Reportado por user: bug del botón Trash2 cortado en
LogPanel toolbar — arreglado.

### 0) Bug fix · LogPanel toolbar — Trash2 cortado

**Reporte**: el ícono de la papelera (limpiar log) se cortaba aunque
ampliaras la ventana. Era el último de 4 botones a la derecha del
search.

**Causa raíz**: el `Input` con `flex-1` tomaba todo el espacio
disponible y los 4 botones (Clock, Download, RotateCcw, Trash2) no
tenían `shrink-0`, así que el último se comprimía y cortaba el ícono.
Además el container tenía `gap-1.5` + `px-3` que no daba aire suficiente.

**Fix**:
- Cada `<Button>` ahora con `!h-7 !w-7 !p-0 shrink-0` — tamaño fijo
  cuadrado 28×28, sin shrink.
- Container con `gap-1` + `px-2` (era 1.5 / px-3) para más espacio.
- `<Input>` con `flex-1 min-w-0` explícito.

Resultado: los 4 botones siempre completos, sin cortes, en cualquier
ancho de ventana.

### FASE 2 — Microinteracciones premium

#### CountUp animation en stats
Nuevo componente `@maru/ui/CountUp` que anima el cambio numérico desde
el valor previo al nuevo con `requestAnimationFrame` + `easeOutCubic`
600ms. Skip del primer render para no animar al boot.

Aplicado en:
- **Sidebar TikTok stats** (likes / viewers / diamonds): cuando llegan
  push events del live, los números cuentan progresivamente. Da el
  efecto premium de "actividad real".
- **StatsCounters del LogPanel** (gifts / follows / shares / likes /
  chat / acciones): mismo efecto, 500ms.

Performance: 0 re-renders del padre, 0 efectos secundarios. Animación
local con setState + cancela en cleanup. Respeta
`prefers-reduced-motion`.

#### Skeleton premium
`@maru/ui/Skeleton` ampliado con 4 variants (`default`, `text`, `circle`,
`card`), prop `lines` (multi-line con la última al 75% width), inline
opcional, role/aria-label correctos. + nuevo `SkeletonGrid({count})`
para placeholders de listas. Shimmer mejorado con `via-fg/[0.08]`
(antes era `via-white/5` hardcoded — ahora respeta el tema).

#### Toast premium
`@maru/ui/Toaster` actualizado:
- **Slide-in lateral** (`animate-slide-in-right`) en vez de slide-up.
- **Progress bar** inferior 2px que se contrae con `transform: scaleX`
  durante la duración del toast (estilo Stripe/Linear). Cero JS, puro
  CSS keyframe. No corre en errors (no auto-dismiss).
- Border-radius/shadow refinados con `shadow-elev-3 shadow-inset-top`.
- Z-index a `9000` (var). Backdrop-blur mantenido.

#### Connect button premium states
Nuevas animaciones en `globals.css`:
- `animate-success-flash` — anillo verde 1.4s que se expande+desvanece
  cuando TikTok conecta exitosamente.
- `animate-error-shake` — sacudida horizontal 0.5s al fallo de conexión.
- `animate-connecting-pulse` — glow oscilante mientras intenta conectar.

Cableadas en `Sidebar.tsx` con `useRef + setKey` pattern para
re-disparar la animación SOLO cuando cambia el estado relevante (no en
cada render).

#### Spring physics utility
`.transition-spring` class que aplica `cubic-bezier(0.34, 1.56, 0.64, 1)`
(rebote sutil estilo Apple) para switches y dropdowns que querés que
tengan ese feel material. Disponible para uso futuro.

### FASE 3 — Boot ultra rápido + perf adicional

#### Preconnect a Google Fonts en `<head>`
Antes el browser hacía DNS lookup + TLS handshake + descarga del CSS
secuencial (200-400ms). Ahora con `<link rel="preconnect">` el handshake
empieza en paralelo al parsing del HTML. Reduce el FOUT (flash of
unstyled text) ~200-400ms al primer boot.

#### requestIdleCallback warmup
`App.tsx` ahora dispara 3 RPCs en idle (después del primer paint):
- `gifts.list` (1000+ gifts del catálogo TikTok)
- `tts.voices.list` (487 voces del TikTok TTS)
- `sounds.list` (catálogo de sonidos del user)

Con fallback a `setTimeout(0)` si el browser no tiene idle callback.
Cuando el user abre el modal de gifts/voices/sounds, ya está cacheado
en el sidecar — modal abre instantáneo sin spinner.

#### Overscroll behavior premium
Nueva utility CSS `[data-scroll-area]` con `overscroll-behavior: contain`.
Aplicado al scroll del LogPanel. Resultado: el scroll del log no
"rebota" en el padre cuando llegás al final/inicio (problema típico en
trackpad de macOS y mouse wheel agresivo en Windows).

`[data-smooth-scroll]` para opt-in a `scroll-behavior: smooth`
(disponible para uso futuro en navegación interna).

#### GPU layer utility
`.gpu-layer` class:
- `transform: translateZ(0)` — promociona a GPU layer permanente.
- `backface-visibility: hidden` — elimina sub-pixel jitter en Windows.
- `will-change: transform` — hint al compositor.

Disponible para elementos que se animan frecuentemente.

### Garantías técnicas (intactas)

- ✅ Sidecar Python ni se mira.
- ✅ Main process Electron ni se mira.
- ✅ RPCs sin cambios (los warmup `gifts.list` / `tts.voices.list` /
  `sounds.list` son los mismos que ya usaban hooks existentes).
- ✅ Push events bus, store Zustand intactos.
- ✅ Regex de logs con emojis intactas.
- ✅ Strings con emojis en componentes intactos.
- ✅ Anti-flicker `.maru-bg-shell` mantenido.
- ✅ `<Card>` sin backdrop-blur por default — no flicker en push events.

### Métricas

- CSS bundle: ~64.75 → ~65.15 KB (+0.40 KB animations + perf utils).
- JS bundle main: 115.23 → 117.52 KB (+2.29 KB CountUp + Toast premium
  + warmup + Skeleton refinement).
- Build pasa limpio en 1.82s.
- Boot time: ~200-400ms más rápido al primer arranque (preconnect).
- Modal abre instantáneo de gifts/voices/sounds tras boot (warmup).

---

## 1.0.33 — 2026-05-01 · ✨ FASE 1 polish: input limpio + temas refinados + perf

Continuación del rediseño v1.0.32. Esta release ataca el feedback del
user: **doble contorno** en inputs y **letras blancas que brillan**, +
optimizaciones de performance reales sin tocar lógica.

### 1) Doble contorno en inputs ELIMINADO

**Bug visual reportado**: los inputs y barras de búsqueda mostraban
DOS líneas: el `border` del wrapper + un `ring` exterior `focus-within`
(2px adicionales). Quedaba el efecto de marco doble.

**Fix sistémico** (1 cambio = arregla TODAS las búsquedas):
- `packages/ui/src/components/Input.tsx`: removido
  `focus-within:ring-2 focus-within:ring-mn-cyan/15`. Reemplazado por
  `focus-within:shadow-[0_0_0_3px_rgb(126_214_223/0.10)]` — UN solo
  contorno (border) que cambia color en focus + glow muy sutil sin
  línea extra.
- `packages/ui/src/components/Select.tsx`: misma corrección.
- `packages/ui/styles/globals.css` `.maru-input`: idem.
- Inputs internos ahora con `border-0 ring-0 focus:outline-none
  focus:ring-0` para asegurar que ningún reset de Tailwind o browser
  default agregue contorno extra.

**Resultado**: barras de búsqueda en RulesTab, GiftSelectorDialog,
GiftsDialog, SoundsDialog, SimulatorDialog, UsersTab, LogPanel,
EntitySelectorDialog — todas se ven limpias con un solo contorno.

### 2) Texto refinado en los 4 temas (sin "brillo" molesto)

**Feedback**: las letras blancas brillaban demasiado contra los
backgrounds oscuros (especialmente en streams largos cansa la vista).

**Cambio**: bajado el `--maru-fg` de blanco puro `#ffffff` a off-white
en cada tema. Mantiene contraste AAA pero suaviza el reflejo:

| Tema | Antes | Ahora |
|------|-------|-------|
| Midnight | `#ffffff` | `#e8eaf4` (off-white frío premium) |
| Dracula | `#f8f8f2` | `#e6e6de` (off-white cálido) |
| Tokyo Night | `#c0caf5` | `#b8c4e8` (saturación bajada) |
| Catppuccin Mocha | `#cdd6f4` | `#c4ccea` (entre text y subtext1) |

También refinada la jerarquía `--maru-fg-muted` / `-subtle` / `-hint`
en cada tema para que la diferencia entre niveles sea natural sin
pelear con el fg principal.

`body` agregado: `font-weight: 400` explícito + `-moz-osx-font-smoothing:
grayscale` para rendering parejo cross-platform.

### 3) Performance: memoización + content-visibility + debounce

#### React.memo en RuleListItem
Cuando hay 50+ reglas y llega un push event del live, ANTES todas las
filas re-renderizaban. AHORA solo re-renderiza la fila cuya prop cambió
(shallow compare). Mejora notable cuando el stream tiene mucha
actividad.

`apps/desktop/src/renderer/components/dialogs/rules/RuleListItem.tsx`:
- Función renombrada a `RuleListItemImpl` interna.
- Export `RuleListItem = memo(RuleListItemImpl)`.
- Props con default values estables (los `EMPTY_*` Maps en module
  scope) — clave para que el memo funcione bien.

`LogEntryRow` ya estaba memoizado (sesión 30/04).

#### content-visibility: auto en filas del log
`globals.css`: nuevos atributos `data-cv-auto-row`, `data-cv-auto-card`,
`data-cv-auto`. Aplican `content-visibility: auto` + `contain: layout
paint` + `contain-intrinsic-size` calibrado.

`LogEntryRow` ahora marcado con `data-cv-auto-row`. El browser salta
layout/paint de filas fuera del viewport — beneficio masivo en buffers
densos (200+ events).

#### useDebouncedValue hook
`apps/desktop/src/renderer/lib/hooks.ts`: nuevo hook
`useDebouncedValue<T>(value, delayMs = 250)`. Útil para search inputs
donde el filtro corre sobre listas grandes.

Aplicado en `GiftSelectorDialog` (1000+ gifts en TikTok). El input
sigue siendo controlado (typing instantáneo en pantalla), pero el
filtro+sort pesado corre cada 200ms en lugar de cada keystroke.

### 4) Garantías técnicas (intactas)

- ✅ Sidecar Python ni se mira.
- ✅ Main process Electron ni se mira.
- ✅ RPCs sin cambios.
- ✅ Push events bus, store Zustand intactos.
- ✅ Regex de logs con emojis (`^🎵|^🎶|...`) intactas.
- ✅ Strings con emojis en componentes intactos.
- ✅ `.maru-bg-shell` con isolation+contain — anti-flicker mantenido.
- ✅ `<Card>` sin backdrop-blur por default — no flicker en push events.

### Métricas

- CSS bundle: 64.59 KB → ~64.75 KB (+0.16 KB, content-visibility utils).
- JS bundle main: 114.68 KB → 115.23 KB (+0.55 KB, hook nuevo).
- Build pasa limpio en 1.88s, 1711 modules.

---

## 1.0.32 — 2026-05-01 · 🎨 Premium Polish + Multi-Theme System

Rediseño visual 100% premium **sin tocar lógica**. Sidecar Python, RPCs,
single-instance lock, dedupe, regex de logs con emojis, persistencia,
auto-update — todo intacto. Solo cambian tokens CSS, tipografía y polish
de componentes UI primarios.

### 1) Sistema de 4 temas premium con persistencia

Selector de tema visual al final del sidebar con dropdown elegante.
La elección persiste en `settings.theme` (RPC) y se restaura al boot
aplicando `data-theme="..."` en `<html>`. Cambiar tema es instantáneo
(solo CSS vars) y NO reinicia ni desconecta nada.

Temas incluidos:
- **🌙 Midnight** (default) — paleta MARU original mejorada (más
  contraste de texto, gradientes refinados, accents radiales en bg).
- **🦇 Dracula** — púrpura/rosa signature de dracula-theme.com,
  +40k stars en GitHub.
- **🗼 Tokyo Night** — azul-violeta noche, paleta del extension VSCode
  popular 2024 (`#bb9af7` mauve, `#7aa2f7` blue, `#7dcfff` cyan).
- **🍮 Catppuccin Mocha** — pastel premium (`#cba6f7` mauve, `#cdd6f4`
  text), comunidad enorme.

Implementado como CSS vars `[data-theme="..."]` en `globals.css`. Los
nombres de tokens (`--maru-bg-base`, `--maru-fg`, `--maru-accent`,
etc.) se mantienen IDÉNTICOS — los componentes existentes funcionan sin
cambios. Cada tema redefine valores; los componentes no saben qué tema
hay activo.

### 2) Tipografía variable premium

- **Geist** (sans, premium UI) reemplaza Inter como font default. Carga
  vía Google Fonts CDN con fallback a Inter, system-ui, Segoe UI.
- **JetBrains Mono** (mono, números/timestamps/code) ya estaba pero
  ahora se usa más vía `tabular-nums` + utility `.font-mono`.
- CSP del `index.html` actualizada para permitir `fonts.googleapis.com`
  + `fonts.gstatic.com` (sin tocar otros dominios).

### 3) Polish premium en componentes UI primarios

`packages/ui/src/components/`:
- **Button**: gradients internos + inset highlight (1px luz arriba) +
  `hover:-translate-y-0.5` + `active:translate-y-0` + glows por variant
  (`shadow-glow` accent, `shadow-glow-blue` primary, custom red en
  danger). Cero cambios de API/props.
- **Card**: `shadow-inset-top` + transitions suaves. Mismo API.
- **GroupBox**: title chip con gradient bg (de `bg-elevated` a
  `mn-card`) + border + inset highlight. Conserva el look QSS-flotante
  pero ahora se ve premium.
- **Input / TextArea**: focus ring sutil con cyan glow + hover en
  border + ring 3px en focus. Mismo API.
- **Switch**: gradient en track activo + glow + spring easing en knob.
  Mismo API.
- **StatusDot**: anillo `live-ring` animado (1.8s, expande+fade) cuando
  está conectado. Resto de estados (disconnected, connecting, error)
  igual.

### 4) Tokens y utilidades premium

`packages/ui/styles/globals.css` reescrito (manteniendo todos los
nombres existentes):
- 5 niveles de elevación (`--maru-elev-1..5`) refinados.
- 2 inset highlights (`--maru-inset-top`, `-strong`) para superficies
  premium.
- 3 glows con accent del tema activo (accent / blue / green).
- 6 keyframes nuevos (`maru-slide-in-left/right`, `maru-live-ring`,
  etc.) con easing `cubic-bezier(0.22, 1, 0.36, 1)`.
- Background dedicado `.maru-bg-shell` con 2 radial accents (top-right
  + bottom-left) + noise texture overlay sutil. GPU-promoted, isolated,
  contained — anti-flicker (mantiene el fix de sesión 29-04).
- Scrollbars premium 6px con hover.
- Focus rings con cyan-blue 70% opacity.
- Modal backdrop con `blur(10px) saturate(130%)`.

`packages/ui/tailwind.preset.cjs`:
- Geist agregado como primer fallback en `font-sans`.
- Nuevos shadows: `glow-green`, `inset-top`, `inset-top-strong`.

### 5) ThemeSwitcher dropdown premium

Nuevo componente `apps/desktop/src/renderer/components/ThemeSwitcher.tsx`:
- Dropdown con backdrop translúcido + cierra al click fuera.
- Cada tema con emoji + label + descripción.
- Preview activo con check icon + bg-accent/15.
- Animation `animate-fade-in` al abrir.
- Persistencia inmediata: aplica `data-theme` en DOM + setter en store
  + RPC `settings.set` con `{ theme: id }`.

Integrado al final del Sidebar (después del GroupBox de Configuración).

### 6) Boot del tema persistido

`App.tsx` lee `settings.get` al montar. Si hay `theme` válido, lo aplica
con `setTheme()`. Si no, asegura `data-theme="midnight"` en `<html>`
(default). Si el RPC falla (sidecar booting), también cae a midnight.

### Garantías técnicas (lo que NO se tocó)

- ✅ Sidecar Python (`apps/sidecar/`) intacto.
- ✅ Main process (`apps/desktop/src/main/`) intacto:
  `requestSingleInstanceLock`, `killOrphanSidecars`, IPC, attachRpcClient.
- ✅ Regex que clasifica logs por emojis (`tiktok.py`, `logs.py`,
  ej. `^🎵|^🎶|^🎷|...` → music) NUNCA tocado.
- ✅ Strings con emojis (GroupBox titles `🎵 TikTok Live`, eventos del
  feed 🌹 ❤ 🦁) intactos.
- ✅ Los 154 RPCs sin cambios.
- ✅ Push events bus, store Zustand intactos.
- ✅ Persistencia `%APPDATA%/MARU Live/data/`.
- ✅ Single instance lock + dedupe doble + idempotencia listeners.
- ✅ Auto-update electron-updater 6.3.9.

### Verificación pre-release

`pnpm --filter @maru/desktop build` pasa limpio sin warnings (CSS
@import movido antes de @tailwind). 1711 modules transformados.

---

## 1.0.31 — 2026-05-01 · 🪲 3 fixes: editor de imagen de entries, música mal categorizada, stats counters reales

### 1) Editor de imagen para entries de juegos (paridad MARU original)
**Problema**: en MARU original, al crear/editar un entry (entity/item/
event) en la pestaña Datos, podías subir tu propio PNG/JPG como
icono. La nueva versión solo te dejaba editar nombre + comando — la
imagen seguía pegada a lo que vino con el bundle.
**Fix completo (server + client)**:
- Nuevo dir runtime `USERDATA_GAME_IMAGES_DIR` (`<appdata>/data/game_images/`)
  para guardar los iconos custom del user (writable, no se pisa con
  cada update del .exe).
- `ImageIndex._scan_game_images` ahora escanea ambas dirs (bundle
  read-only + userdata writable) y prioriza userdata si hay archivo
  con el mismo nombre. El image-protocol del Electron main ya
  soportaba esa prioridad.
- 2 RPCs nuevos:
  - `images.set-entry-image({gameId, category, command, sourcePath})`
    — copia el archivo del filesystem del user a la dir userdata
    del game, sanitiza paths (no permite `..` ni `/`), borra
    variantes anteriores con mismo stem (evita duplicados con
    distintas extensiones).
  - `images.delete-entry-image({gameId, category, command})` —
    quita la imagen custom y vuelve a la del bundle / `_default_<cat>.png`.
  - Ambos hacen rebuild del index para que el lookup encuentre la
    imagen al instante sin reiniciar el sidecar.
- `EntryEditForm` (DataDialog) ahora muestra un bloque de imagen
  arriba del campo Nombre:
  - Preview 64×64 de la imagen actual (cache-busted al subir nueva).
  - Botón "Cambiar" → file picker (PNG/JPG/WEBP/GIF) → upload.
  - Botón trash → `images.delete-entry-image` para volver al default.
  - Estado: deshabilitado hasta que el `command` esté definido (la
    imagen se guarda como `<command>.<ext>`).

### 2) Logs de Spotify/música clasificados como "Sistema"
**Causa raíz**: el regex `r"\btiktok\b|🎵|live"` para categoría
`tiktok` matcheaba el emoji `🎵`. Mensajes del Spotify player que
arrancan con `🎵` (típico: "🎵 ▶ Track - Artist") caían en
`tiktok` → pill "Sistema" en vez de "Música".
**Fix**:
- Nueva regla regex de alta prioridad: `^🎵|^🎶|^🎷|^🎺|^🎸|^🎻|^🥁`
  → categoría `music`. Cualquier mensaje que arranque con emoji
  musical va al pill "Música".
- Removido `🎵` del regex de `tiktok` (ya no causa el conflicto).
- Ampliado el regex genérico de music con palabras clave extras:
  `cancion`, `canción`, `track`, `reproduciendo`.

### 3) Stats counters arriba del log no detectaban nada
**Causa raíz**: `StatsCounters` leía `log.stats` (counter incremental
del store que se mantenía vía `pushLogEntry`). En ciertos casos
(rebuild del slice, race con `loadInitial` que pisa con stats del
sidecar), los counters se quedaban out-of-sync con las entries
reales del buffer.
**Fix**: `StatsCounters` ahora cuenta DIRECTO desde `entries` del
buffer (max 500). Si limpias el log → vuelven a 0. Si llega un evento
→ incrementa al instante. Refleja exactamente lo que se ve en panel,
sin depender de un counter intermedio.

### Archivos tocados

- `apps/sidecar/maru_sidecar/runtime.py` — `USERDATA_GAME_IMAGES_DIR`.
- `apps/sidecar/maru_sidecar/backend/images.py` — scan dual dir +
  RPCs `set-entry-image` / `delete-entry-image`.
- `apps/sidecar/maru_sidecar/backend/logs.py` — regex música prioritario.
- `apps/sidecar/maru_sidecar/rpc/registry.py` — registra los 2 RPCs nuevos.
- `apps/desktop/src/renderer/components/dialogs/data/EntryEditForm.tsx`
  — bloque de imagen + handleUploadImage / handleDeleteImage.
- `apps/desktop/src/renderer/components/log/StatsCounters.tsx`
  — props `entries` (no más `stats`); cuenta del buffer directo.
- `apps/desktop/src/renderer/components/LogPanel.tsx` — pasa
  `log.entries` en vez de `log.stats`.

## 1.0.30 — 2026-05-01 · 🪲 4 fixes: spawn HTTP debug, gifts log individuales, RuleListItem responsive, TikTok estado claro

### 1) Mensaje "🎯 🐍 terraria spawn ... HTTP 200" innecesario en log
**Causa raíz**: `core_bridge._patch_games_logging._post_with_log`
loguea cada HTTP request al mod del juego como `log.info(...)`. Eso
llega al panel del usuario aunque la información ya está cubierta
por el log "✅ regla disparada → spawn slime · @user" del
rule_dispatcher → ruido confuso.
**Fix**: bajar el log a `log.debug` cuando el HTTP es 200/201/204
(éxito normal — invisible en panel). Solo errores HTTP (>=400) o
network errors se quedan como `log.warning` para que el user vea
problemas reales del mod.

### 2) Gifts en log: N entries individuales (no resumen por streak)
**Problema**: cuando un user dona N rosas, el core emite eventos
parciales como "envió 3 rosas", luego "envió 5 rosas" (delta del
streak). El user veía el resumen actualizándose y se confundía con
los conteos.
**Fix**: dos cambios coordinados en `tiktok.py`:
- `_on_log_message` ahora SUPRIME los logs `🎁 @user envió: ...`
  del worker (eran los resúmenes).
- `_on_event(type=gift)` ahora emite UN log entry individual por
  cada evento gift recibido, con `skip_dedupe=True` para que el
  dedupe global no los colapse.
- Resultado: 5 rosas → 5 entries "🎁 @user envió: rose" en el log,
  uno por uno, secuenciales. Mucho más fácil de leer.

### 3) Bug visual: cards de reglas se cortan al achicar ventana
**Causa raíz**: `RuleListItem` tenía un bloque `restActions` (íconos
de acciones extra) con `flex shrink-0` que ocupaba ancho fijo. En
pantallas estrechas, esos íconos empujaban los botones de la
toolbar (play/edit/copy/delete) hasta cortarse fuera del card.
**Fix**: bloque `restActions` con `hidden xl:flex` — solo se ve en
ventanas anchas (xl: 1280px+). En pantallas estrechas, se reemplaza
por un badge compacto "+N" que indica cuántas acciones hay sin
ocupar espacio. Toolbar siempre visible al borde derecho.

### 4) TikTok API modal: estado vacío aunque conectado
**Causa raíz**: el JSX antes solo mostraba el bloque "Estado" si
`(status || isConnected)`, dejando blanco si el RPC no había
respondido. Y el badge de estado no cubría todos los casos.
**Fix v1.0.29 ya hizo el render incondicional**, pero v1.0.30
agrega:
- Badge de estado descriptivo: 🟢 Conectado / 🟡 Conectando… /
  ⚠ Error / ⚪ Desconectado (cubre los 4 estados del store).
- Línea "Usuario:" SIEMPRE visible (con texto del @user o
  "sin usuario · conectate desde el sidebar" si no hay).
- Header cambiado a "Estado TikTok Live" para clarificar.

### Bonus: smoke build pre-release
Antes del `release:exe`, corremos `pnpm build` localmente para
detectar errores de sintaxis JSX en 5 segundos en vez de
descubrirlos a los 3 minutos del build completo. v1.0.29 falló por
un `)}` huérfano que esto hubiera detectado al instante.

### Archivos tocados

- `apps/sidecar/maru_sidecar/core_bridge.py` — `_post_with_log`
  baja a DEBUG en éxito.
- `apps/sidecar/maru_sidecar/backend/tiktok.py` — suprime gift
  summary del worker, emite individuales con `skip_dedupe=True`.
- `apps/desktop/src/renderer/components/dialogs/rules/RuleListItem.tsx`
  — restActions con `hidden xl:flex` + badge compacto fallback.
- `apps/desktop/src/renderer/components/dialogs/tiktok/TikTokApiInfoDialog.tsx`
  — badge de estado descriptivo + línea Usuario siempre visible.

## 1.0.29 — 2026-05-01 · 🪲 3 fixes raíz: gift sound case-insensitive + cola, log N entries, TikTok API render

### 1) Sonidos no suenan en gifts REALES + 100 sonidos a la vez
**Causa raíz #1** (no suenan): el SoundsDialog asigna sonidos por
`g.id` con casing original de TikTok (ej. `"Rose"`), pero el WORKER
REAL del core emite `gift_name` en **lowercase**
(`core/tiktok_client.py:320: gift_lower = gift_name.lower()`). El
simulador conserva el casing (`"Rose"`) → matchea; el live envía
`"rose"` → no matchea (lookup falla porque la KEY del dict es
`"Rose"`, mi fallback `.lower()` no ayuda).
**Fix #1**: nuevo `_lookup_gift_path` con lookup CASE-INSENSITIVE —
prueba match exacto, lower, y finalmente itera todas las keys
comparando lower-vs-lower. Ahora el sonido suena sin importar el
casing usado al asignar.

**Causa raíz #2** (todos a la vez): `pygame.mixer.Sound.play()`
reproduce inmediatamente sin esperar — un streak de 100 rosas
encolaba 100 sonidos simultáneamente en el mixer → cacofonía.
**Fix #2**: nueva cola interna (`queue.Queue` capacidad 50) +
worker thread que reproduce uno tras otro **esperando a que termine
el actual** (`channel.get_busy()`). Si la cola se llena (>50
pendientes), descarta el resto silencioso para no freezar el live.
- `play_for_gift` y `play_for_event` ahora usan `_play_queued`
  (cola).
- `tts.test`/preview manual sigue usando `_play_file` directo
  (instantáneo, no encolado — el user clickea Probar y espera audio
  inmediato).

### 2) Log no muestra N entries cuando regla dispara N veces
**Causa raíz**: el dedupe v1.0.23 de `LogsService.publish` colapsa
publishes con mismo `(level, source, message)` en 2s para evitar
duplicados de race. Pero el `rule_dispatcher` cuando un user dona
10 rosas y la regla `spawn_slime` se ejecuta 10 veces, mandaba 10
publishes idénticos `"✅ slime → ok · @user"` → dedupe los colapsaba
a 1. El user veía 10 spawns en el juego pero solo 1 línea en el log.
**Fix**: nuevo parámetro `skip_dedupe: bool = False` en
`LogsService.publish`. El `rule_dispatcher` lo pasa `True` cuando
publica una ejecución de regla → cada uno de los 10 spawns aparece
como entry separado en el log. Las dedupes para handlers
re-instalados / SocialSystem doble-fire (caso original del v1.0.23)
siguen funcionando para todos los demás callers.

### 3) TikTok API modal sigue saliendo en blanco
**Causa raíz**: el render del bloque principal estaba dentro de
`{(status || isConnected) && (<>...</>)}`. Si el RPC `tiktok.status`
no respondió aún (primera milisecunda al abrir el modal) Y el user
NO está conectado al live (tiktokStatus='disconnected'), la
expresión es `(null || false)` = `false` → modal en BLANCO.
**Fix**:
- Sección principal SIEMPRE se renderea (sin condicional).
- Si `status` aún no está y no hubo error, se ve un banner
  "🔄 Consultando sidecar…" mientras llega.
- Si el user no está conectado, se ve "Sin usuario · conectate al
  live desde el sidebar" en lugar de seccion vacía.
- Stats con valores por default (0) siempre visibles → diagnóstico
  inmediato si no llegan push events.

### Archivos tocados

- `apps/sidecar/maru_sidecar/backend/sounds.py` — `_play_queued`,
  worker thread, `_lookup_gift_path` case-insensitive, queue.
- `apps/sidecar/maru_sidecar/backend/logs.py` — `skip_dedupe` param.
- `apps/sidecar/maru_sidecar/backend/rule_dispatcher.py` — pasa
  `skip_dedupe=True`.
- `apps/sidecar/maru_sidecar/backend/chat_dispatcher.py` — single
  call a `play_for_gift` (lookup interno cubre casing).
- `apps/desktop/src/renderer/components/dialogs/tiktok/TikTokApiInfoDialog.tsx`
  — render incondicional + banner "consultando".

## 1.0.28 — 2026-05-01 · 🪲 9 fixes raíz: game id, sounds cascade, sticker simulator, log persistente, gifts search

### 1) Game ID rechazaba al guardar editando categorías (caso 7_days)
**Causa raíz**: en EDIT mode el `id` es READ-ONLY (input disabled),
pero `idValid = ID_RE.test(id)` se evaluaba igual. Como `7_days`
empieza con número (no matchea `^[a-zA-Z_]...`), `idValid=false` →
`canSave=false` → bloqueo de save aunque el user solo cambiara el
nombre de una categoría.
**Fix**: `idValid = isEdit ? true : ...` — solo validar id en CREATE.

### 2) SoundsDialog: preview no sonaba + tab Regalos tosco
**Causa raíz preview**: `play_for_gift` siempre buscaba en
`scope=global`, pero el SoundsDialog asigna sonidos al scope del
juego activo (selectedGameId). Mismatch silencioso → user asignaba
sonido, simulaba, no sonaba.
**Fix**: `play_for_gift` y `play_for_event` ahora resuelven scopes
en CASCADA: scope explícito → juego activo (config.json:activeGame)
→ global. Funciona sin importar dónde el user asignó el sonido.
**Mejoras UX tab Regalos**:
- Search en tiempo real (también por costo numérico, ej. "100").
- Sort por: costo / nombre / asignados primero.
- Botón "asc/desc".
- Botón "solo con sonido asignado" (filtro rápido).
- Empty state con descripción específica.

### 3) TikTok API mostraba todo en 0 aunque conectado
**Causa raíz**: el modal solo leía del RPC `tiktok.status` (snapshot
único). Si el user abría el modal sin clickear Refresh manualmente,
los stats quedaban congelados en lo que devolvió el RPC al abrir
(típicamente 0).
**Fix**:
- Modal ahora lee `tiktokStats`/`tiktokStatus`/`tiktokUsername` del
  STORE (actualizados en tiempo real por push events
  `tiktok:stats`/`tiktok:status`).
- Auto-refresh del RPC cada 5s (versión, signKey, lastError).
- Estado conectado se determina prioritariamente del store live (no
  del snapshot del RPC).

### 4) Bottom bar TikTok no mostraba nada
Cubierto por #3: ahora los datos del modal están sincronizados con
los push events. El bloque TikTok del Sidebar (likes/viewers/diamonds)
ya leía del store; quien fallaba era el modal "TikTok API". Ambos
ahora muestran el mismo estado.

### 5) Filtros del LogPanel no persistían entre cierres
**Causa raíz**: `logActiveGroups` y `logShowTimestamps` se
inicializaban con valores estáticos en cada arranque del programa.
Las desmarcas que el user hacía (típicamente quitar `audio`/`sistema`)
se perdían al reabrir MARU.
**Fix**: persistencia en `localStorage` (`maru.logPanel.activeGroups.v2`
+ `.showTimestamps.v2`). Carga en lazy init del slice + save en
cada toggle/setActiveGroups/setShowTimestamps.

### 6) Simulador: nuevo "Sticker" con galería visual
Antes el simulador no podía generar emote events. Ahora:
- Nuevo tipo "🎨 Sticker" en EVENT_TYPES.
- Sección visual: dropdown de streamers (de la galería emotes
  guardados con `emotes.list-streamers`) → grid de stickers
  (cards 72px con `<MaruImage scope="emotes">`).
- Click selecciona, doble-click envía al instante.
- `simulator.emote({user, streamer, emoteId, imagePath})` nuevo
  RPC en sidecar — emite `tiktok:event(type=emote)` al bus, llega
  al log como sticker real.
- Todos los rangos del usuario se aplican también al sticker.

### 7) Repaso simulador: validación faltante
Antes el botón "Simular" estaba enabled siempre que `!busy`. Si user
elegía gift sin seleccionar uno, o emote sin elegir, se enviaba un
evento con value vacío al sidecar.
**Fix**: cada tipo valida su input específico antes de habilitar
el botón. Si está disabled, el `title` explica qué falta. Aplica
también al botón "Enviar" (burst).

### 8) Reglas mostraban "Sin nombre" en cards de acción
**Causa raíz**: el sidecar usa "Sin nombre" como placeholder cuando
una regla seed no tiene nombre. El UI mostraba ese placeholder literal
en cada card, llenando la pantalla de "Sin nombre" sin info útil.
**Fix**: `RuleListItem` ahora deriva un nombre legible del trigger +
acción cuando `rule.name` es vacío o "Sin nombre" — ej.
`!spawn → 🐗 Boar`, `🎁 Rose → 📦 Iron Sword`, `❤️ 100+ likes → ⚡ Storm`.

### 9) Buscar gifts por costo (galería + simulador)
Ahora si el query es un número entero puro (ej. "100"), también
filtra por coins exactos. Mantiene la búsqueda por nombre/id. Aplicado
tanto en `GiftSelectorDialog` como en el grid del simulador.

### Bonus polish
- TikTokApiInfoDialog auto-refresh cada 5s mientras está abierto.

### Archivos tocados

- **Renderer**:
  - `dialogs/games/CustomGameDialog.tsx` (idValid en edit)
  - `dialogs/sounds/SoundsDialog.tsx` (search/sort/only-assigned)
  - `dialogs/simulator/SimulatorDialog.tsx` (sticker picker + validación)
  - `dialogs/gifts/GiftSelectorDialog.tsx` (search por coins)
  - `dialogs/tiktok/TikTokApiInfoDialog.tsx` (store live + auto-refresh)
  - `dialogs/rules/RuleListItem.tsx` (fallback nombre)
  - `lib/store/log-slice.ts` (persistencia localStorage)
- **Sidecar**:
  - `backend/sounds.py` (`_resolve_scopes` cascada)
  - `backend/simulator.py` (RPC `emote`)
  - `rpc/registry.py` (registro `simulator.emote`)

## 1.0.27 — 2026-05-01 · 🪲 5 fixes raíz: guardar juegos, sounds reales, niveles dual, super fans sync, TikTok version

### 1) Guardar en CustomGameDialog no persistía / botón mudo
**Causa raíz**: `handleSubmit` empezaba con `if (!canSave) return;`
SILENCIOSO. Si el name estaba vacío, port inválido, etc., el user
clickeaba Guardar, no pasaba nada, cerraba el dialog → cambios se
perdían sin ningún feedback. Adicional: el `initialSnapshotRef.current`
se seteaba en `useEffect` post-paint → en el primer render del dialog
`dirty=false` (snapshot vacío) → botón disabled hasta el siguiente
render.
**Fix**:
- `handleSubmit` muestra el primer error de validación con
  `setError(...)` claro: "El nombre no puede estar vacío", "El puerto
  debe estar entre 1 y 65535", "Ya existe un juego con id X", etc.
- Cambio `useEffect` → `useLayoutEffect` para que el snapshot esté
  listo ANTES del primer paint visible. Sin más race del primer
  render.
- Botón Save: `disabled={busy || !dirty}` (no depende de canSave).
  Si dirty + canSave → amarillo. Si dirty + !canSave → rojo (señala
  errores). Click en cualquier estado dirty muestra error específico
  o procede.
- Footer ahora muestra `⚠ <error específico>` cuando hay validation
  fail (en vez de solo "● Cambios sin guardar").

### 2) Sounds: stickers no sonaban + no se podía detener
**Causa raíz**: `playLocal` del renderer usaba `new Audio('file:///...')`.
En Electron empaquetado, las restricciones de file:// + CSP + sandbox
hacían que la mayoría de los archivos no sonaran. Y no había manera
de cortar un sticker que durara demasiado.
**Fixes**:
- Nuevo RPC `sounds.play({path, volume})` en sidecar — usa el mismo
  pygame.mixer que ya funciona en producción (`play_for_gift` /
  `play_for_event`). Sin sandbox, sin CSP.
- `useSounds.playLocal` ahora delega al RPC del sidecar (vs Audio
  del renderer). Los previews del SoundsDialog SUENAN en empaquetado.
- `useSounds.stopAll()` (alias de stopLocal) llama `sounds.stop-all`
  RPC → `pygame.mixer.stop()` → corta todos los sonidos en
  reproducción del sidecar (incluye stickers/gifts en vivo).
- Botón **"⏹️ Detener"** agregado al header del SoundsDialog.
- `chat_dispatcher._handle_comment` ahora dispara
  `sounds.play_for_event("superfan")` cuando el comment trae
  `is_super_fan=true` (sonido de notificación super fan paridad MARU).

### 3) Simulador: nivel fan + nivel donador no se veían los dos
**Causa raíz**: `simulator._rank_label` solo concatenaba
`member_level` (L#). El `gifter_level` (G#) se extraía en `_ranks()`
pero NO se mostraba en el badge label → si el user simulaba con
ambos niveles, en el log y comment-enriched solo aparecía uno (L3).
**Fix**: `_rank_label` ahora también incluye `G#` después de `L#`.
Resultado visual `[⭐SF L3 G2] @TestUser`.

### 4) Spotify Super Fans no se actualizaba desde simulador
**Causa raíz**: `notify_super_fan` solo se invocaba desde
`tiktok._cache_ranks` que se ejecuta como handler del SIGNAL del
worker real (PyQt). Los events del simulador publican
`tiktok:comment-enriched` al BUS (`get_event_bus()`) pero nadie del
lado de Spotify lo escuchaba → simular un super fan en el simulador
NO actualizaba la lista PlayFan.
**Fix**: `SpotifyService.__init__` se suscribe al bus
`tiktok:comment-enriched` con `_on_comment_enriched_bus`. Cuando el
payload trae `is_super_fan` explícito (true o false), llama a
`notify_super_fan(user, bool, displayName)`. Idempotente con throttle
5min interno → no escribe el JSON con cada comment de un super fan
activo. Funciona tanto para events del worker real como del simulador.

### 5) TikTok API mostraba `<module 'TikTokLive.__version__'>`
**Causa raíz**: TikTokLive 6.6+ tiene `TikTokLive.__version__` como
**SUBMÓDULO** (`TikTokLive/__version__.py`), no como string.
`getattr(_tl, "__version__", "")` devolvía el repr del módulo →
la card "TIKTOKLIVE" del modal mostraba literal:
`<module 'TikTokLive.__version__' from 'C:\\...\\__version__.py'>`.
**Fix**: prioriza `importlib.metadata.version("TikTokLive")` (devuelve
string limpio "6.6.5"). Si falla, intenta extraer `.version` o
`.__version__` del submódulo. Sanitización defensiva final descarta
cualquier resultado con "<module" o length > 32 chars.

### Archivos tocados

- **Renderer**:
  - `dialogs/games/CustomGameDialog.tsx` — useLayoutEffect, handleSubmit
    con error específico, footer con error, botón color por estado.
  - `dialogs/sounds/SoundsDialog.tsx` — botón Detener + handlePlay async.
  - `lib/use-sounds.ts` — playLocal vía RPC sidecar, stopAll.
- **Sidecar**:
  - `backend/sounds.py` — RPC `play(path, volume)` nuevo.
  - `backend/chat_dispatcher.py` — sound superfan en _handle_comment.
  - `backend/simulator.py` — `_rank_label` incluye G# (gifter_level).
  - `backend/spotify.py` — bus listener `tiktok:comment-enriched`.
  - `backend/tiktok.py` — version detection robusta para TikTokLive 6.6+.
  - `rpc/registry.py` — `sounds.play` registrado.

## 1.0.26 — 2026-05-01 · 🪲 8 fixes: dirty stable, Validar/TikTok-API/sounds gallery, simulador con roles, sin minijuegos

### 1) Spotify suffix "canciones" rompía visualmente
`packages/ui/src/components/Input.tsx`: el `<input flex-1>` no tenía
`min-w-0`, así que no se podía achicar y empujaba al `suffix` fuera de
la caja. El suffix tampoco tenía `whitespace-nowrap shrink-0` →
visualmente quedaba pisado/cortado en cualquier campo angosto (max
queue 5 + suffix "canciones"). Ahora todo el componente Input es
robusto a campos estrechos.

### 2) CustomGameDialog: dirty se "apagaba" al cambiar categoría
**Causa raíz**: el `initialSnapshot` era un `useMemo` con dep
`[open, editing]`. Cuando algo del store de games re-fetcheaba en
background y `byId(editingId)` devolvía un objeto distinto (referencia
nueva), el useMemo recalculaba el snapshot **con los valores actuales
del state local** (porque ya eran iguales a `editing` post re-fetch),
lo que hacía `dirty=false`. Botón Save se "apagaba" aunque el state
local sí tenía cambios.
**Fix**: snapshot capturado UNA SOLA VEZ con `useRef` en el effect de
"abrir el dialog" (`useEffect [open, editing?.id]`). Inmutable hasta
cerrar/reabrir → ningún re-render del store puede invalidarlo.
Botón Save también ahora no depende de `canSave` para habilitarse
(solo `dirty && !busy`); el `canSave` se valida al hacer click y se
muestra error específico si falla → ya no hay contradicción entre
"Dialog dice tenés cambios" pero "Save está disabled".

### 3) Quitado Minijuegos completo
Removido botón del Sidebar + `MinigamesDialog.tsx` + slice del store +
hook `use-minigames.ts` + tipos `MinigamesConfig/MinigameInfo/etc.` +
6 RPCs (`minigames.meta/.config.get/.config.set/.state/.start/.stop`)
+ módulo `apps/sidecar/maru_sidecar/backend/minigames.py` + entry del
LogsBridgeHandler + ID `'minigames'` del tipo `ModalId`. Limpieza
total — el resto de la app sigue funcionando idéntico.

### 4) Simulador con roles para CUALQUIER tipo de evento
Antes el panel "🏷️ Rango del usuario" solo se mostraba con
`eventType === 'comment'` y solo `comment`/`command` propagaban los
ranks. Ahora:
- Panel SIEMPRE visible (banner amarillo arriba del bloque de evento).
- Nuevo input `Gifter G` (faltaba en la UI aunque el flag existía).
- Botón "Limpiar" para resetear todos los ranks.
- `dispatchEvent()` propaga ranks a `gift/like/follow/share/subscribe`
  (antes solo `comment/command`).
- Sidecar `simulator.py`: cada handler ahora extrae `_ranks(params)`,
  los inyecta en `data`, los pasa a `_emit(user_ranks=...)` (eso
  emite `tiktok:comment-enriched` para que el ChatDispatcher los
  cachee), y los muestra en el log con `_rank_label`.
- `subscribe`: forza `is_super_fan=True` automáticamente (subscribirse
  ya es ser super fan).
**Resultado**: podés probar reglas con `required_ranks=[super_fan]`
simulando un gift, like, comment o cualquier evento del rango elegido.

### 5) Botón "Validar" no funcionaba
**Causa raíz**: `apps/sidecar/.../backend/rules.py:validate_all` hacía
`from gui.widgets.rule_validator import RuleValidator` — ese módulo
es del GUI original PyQt y **NO está empaquetado en el sidecar
PyInstaller**. El import fallaba en cada release y el RPC devolvía
`{ok: false, message: "validador no disponible: ..."}`. El botón
Validar no mostraba nada útil.
**Fix**: validador NATIVO en el sidecar (sin dependencias del GUI):
- Estructura básica de cada regla (name, trigger_type, actions).
- Validación por trigger: gift contra catálogo (custom_gifts +
  estándar mínimos), command sin prefijo `!`/`/`, like/like_milestone
  con número > 0.
- Cada acción: action_type, action_value contra catálogo de la
  categoría (`data_<gameId>.json`), amount >= 1.
- Detección de conflictos: dos reglas con mismo `(trigger_type,
  trigger_value)` → warning de match doble.
- Devuelve `{ok, problems[], conflicts[], error_count, warning_count,
  info_count, totalRules}` exactamente como el frontend espera.

### 6) Gestor de sonidos con imágenes reales de gifts
`SoundsDialog → GiftSoundsList` mostraba solo el emoji fallback de
cada gift. Ahora cada row usa `<MaruImage scope="donaciones"
path={iconPath} />` con el PNG real del gift (auto-descargado del live)
y emoji fallback solo si la imagen no carga. También se muestran las
coins (💎) por gift para que el usuario identifique cuál es cuál.

### 7) Selector de regalo de fortuna usa la galería visual
Sidebar `🔮 Fortuna`: el `<select>` plano fue reemplazado por un
botón que abre `GiftSelectorDialog` (la misma galería visual de gifts
con cards 110×135, search, filtros, doble-click). Muestra inline el
gift elegido con `MaruImage` + nombre + coins. Mucho más fácil de
identificar que un dropdown con texto.

### 8) Botón "TikTok API" del Sidebar no respondía bien
**Causa raíz**: usaba `alert()` nativo del browser que en Electron
puede quedar silente, y el sidecar `tiktok.status` solo devolvía
`{connected, username, stats}` — el frontend leía `version`/`lastError`
que nunca venían → el alert mostraba info pobre y el user lo percibía
como "no funciona".
**Fix**:
- Sidecar `tiktok.status` ampliado: ahora devuelve `version` (de
  `importlib.metadata` para `TikTokLive`), `reconnectAttempts`,
  `autoReconnect`, `signKeyConfigured`, `lastError`.
- `_on_error` ahora guarda el último error en `self._last_error`
  para diagnóstico en el botón.
- Nuevo modal `TikTokApiInfoDialog` (reemplaza al `alert()`):
  estado conectado / username / versión TikTokLive / API key
  configurada o no / stats (viewers, likes, diamonds, followers,
  shares) / último error en mono. Botón Refresh + acceso directo
  a "Configurar API key".

### Archivos tocados (resumen)

- **UI base**: `packages/ui/src/components/Input.tsx`,
  `packages/ui/src/components/Dialog.tsx` (sin cambios — heredado).
- **Renderer**: `Sidebar.tsx`, `ModalRoot.tsx`,
  `dialogs/games/CustomGameDialog.tsx`,
  `dialogs/sounds/SoundsDialog.tsx`,
  `dialogs/simulator/SimulatorDialog.tsx`,
  `dialogs/tiktok/TikTokApiInfoDialog.tsx` (nuevo),
  `lib/store/index.ts`, `lib/store/ui-slice.ts`.
- **Sidecar**: `backend/rules.py` (validate_all nativo),
  `backend/tiktok.py` (status ampliado, _last_error),
  `backend/simulator.py` (ranks en todos los tipos),
  `backend/logs.py` (entry minigames removida),
  `rpc/registry.py` (minigames removido).
- **Shared**: `packages/shared/src/types/index.ts` (Minigames types
  removidos), `packages/shared/src/rpc/methods.ts` (MinigamesMethods
  removido).
- **Borrados**: `dialogs/minigames/`, `lib/use-minigames.ts`,
  `lib/store/minigames-slice.ts`, `backend/minigames.py`.

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
