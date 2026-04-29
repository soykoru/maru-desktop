# MARU Desktop — Plan G FINAL (revisado tras G0)

> Producido en G0.10 · 2026-04-27.
>
> Este documento **reemplaza** al borrador G1-G14 que vivía en memoria.
> Cada fase trae los **IDs de feature** específicos de la matriz
> [`MARU_FEATURE_MATRIX.md`](MARU_FEATURE_MATRIX.md) que debe portar.
>
> **Resultado de la auditoría G0**: las 14 fases del borrador son
> suficientes — no se agregaron G15+. Pero CADA fase está más detallada.

---

## Reglas firmes (no negociables)

1. **MARU original = única referencia válida**.
2. **Lo que está, va al 100%** — sin "MVP", sin reemplazos sintéticos.
3. **Tema único oscuro `midnight`** — borrar los 8 demás.
4. **TTS es interno**, expuesto solo en `voices_dialog`.
5. **Galería de imágenes = prioridad #1** (G2 antes que UI).
6. **Reglas multi-action + random_action son obligatorias** (G6).
7. **Cada fase cierra con paridad 100%** contra el original.
8. **Antes de cerrar fase**: comparar pestaña-por-pestaña con MARU.
9. **Si una feature de la matriz queda sin portar, la fase NO cierra**.
10. **Sidecar Python conserva `core/` y mixins prácticamente sin cambios**.

---

## Resumen de fases

```
G0  · Auditoría exhaustiva (sin código)         ✅ COMPLETADA
G1  · Identidad visual + design tokens          ← arrancar acá
G2  · Sistema de imágenes (custom protocol + cache + auto-descarga)
G3  · Galería de Donaciones (415 PNGs + selector reusable)
G4  · Conexión con juegos + custom games + ManageGames
G5  · Catálogo de entidades por juego (DataDialog + EntitySelector)
G6  · Editor de Reglas (multi-action + random_action + 7 trigger types)
G7  · Sistema social completo (35 comandos + Fortuna + 7 tabs config)
G8  · IA multi-proveedor (4 providers + auto-fallback)
G9  · Voces TTS (74 voces + 3 canales + 3 niveles)
G10 · Stream Profiles + Sonidos + Minigames
G11 · Simulador + Log con 19 categorías
G12 · Backup manager (7 max FIFO)
G13 · Overlays manager (Cloudflare + WebSocket)
G14 · Pulido + TikTok + Spotify + Infra + v1.0.0 real
```

**Total**: 343 features distribuidas en 14 fases.

---

## G1 · Identidad visual + design tokens reales

> **Objetivo**: la app debe verse y sentirse como MARU desde el segundo
> en que la abrís. Tema único oscuro, splash idéntico, paleta exacta.

### Features a portar (sección A · 11 ítems)
- A1 logo MaruLive (root + sidebar 100px + splash 100x100)
- A2 splash 380x280 con progress bar gradient `#e74c3c → #9b59b6`
- A3 tema único oscuro "midnight" (gradient `#1a1a2e → #16213e`)
- A4 34 design tokens (paleta hex exacta de `gui/constants.py`)
- A5 9 helpers de estilo (card, btn_primary, btn_secondary, btn_danger, header_gradient, footer_style, scroll_style, input_style, input_focus_extra)
- A6 iconos sidebar (emojis Unicode)
- A7 background gradient global
- A8 window icon (icon.ico) — Windows
- A9 NotificationWidget (4 tipos: success/error/warning/info, top-center)
- A10 AnimatedButton pulse 150ms `OutCubic`
- A11 AnimatedLabel flash

### Limpieza obligatoria al inicio de G1
- Borrar themes Aurora, Cyberpunk, Forest, Sunset, Ocean, Light, Sakura, Hacker, Dracula (8 temas inventados o decorativos).
- Borrar página TTS dedicada (TTS solo en voices_dialog y sidebar GroupBox).
- Borrar welcome con hero gradient.
- Borrar simulador inline (es ventana modal).
- Borrar donations page mock.
- Revertir `package.json` v1.0.0 → v0.5.0-alpha.

### Tailwind tokens (output esperado)
```js
// tailwind.config.js
colors: {
  accent: { DEFAULT: '#f39c12', blue: '#74b9ff', green: '#27ae60',
            'green-light': '#2ecc71', red: '#e74c3c',
            'red-dark': '#c0392b', purple: '#9b59b6' },
  panel: { DEFAULT: 'rgba(0,0,0,0.2)' },
  card: { DEFAULT: 'rgba(255,255,255,0.07)',
          hover: 'rgba(255,255,255,0.12)',
          border: 'rgba(255,255,255,0.10)',
          'selected-bg': 'rgba(116,185,255,0.18)',
          'selected-border': 'rgba(116,185,255,0.5)' },
  input: { DEFAULT: 'rgba(0,0,0,0.25)',
           border: 'rgba(255,255,255,0.08)',
           'border-focus': 'rgba(116,185,255,0.4)' },
}
```

### Validación G1
- [ ] Splash idéntico al original (logo, progress bar, fade-out).
- [ ] Background app igual gradient.
- [ ] 5 screenshots lado a lado (titlebar, sidebar, dialog modal,
      empty state, splash) — sensación "esto es MARU pero más pulido".
- [ ] No hay rastro de los 8 temas inventados.
- [ ] Tailwind config tiene los 34 tokens.

---

## G2 · Sistema de imágenes

> **Objetivo**: infra para servir 2.873 PNG sin trabar nada.

### Features a portar (sección B · 13 ítems)
- B1 custom protocol `maru://images/<scope>/<file>` en main process
- B2 image cache LRU max 400 (pixmap) + 400 (icons)
- B3 pre-build `_image_index` al boot (mapeo cmd→path con variantes)
- B4 lookup con normalización de nombres (cmd, display, lower, underscore)
- B5 `_resolve_gift_images()` al boot (resolver paths a `donaciones/`)
- B6 auto-descarga PNG de gifts en vivo (TikTok)
- B7 inyección metadata `tEXt` (Gift-Name, Gift-Coins) en PNG descargado
- B8 `ensure_trigger_icons()` (7 PNGs incluidos en bundle)
- B9 `ensure_category_default()` por juego/categoria (33 PNGs `_default_*`)
- B10 letter PNG fallback generado a 128x128
- B11 tinting destructivo de PNG monocromático
- B12 `find_entity_image()` con variantes (cmd, display, lower, etc.)
- B13 migración de paths absolutos → relativos al `data/donaciones/`

### Bundle del Electron app
- 413 PNGs de donaciones (18.7 MB) + `_catalog.json` seed (49 KB).
- 7 PNGs de triggers (78 KB).
- 2.141 PNGs de game_images (~50 MB).
- ~33 `_default_<cat>.png` (~1 MB).
- 276 templates (~8 MB).
- `Rose_black_white.png` placeholder universal.
- **Total**: ~70 MB. **NO bundlear** `gifts_1541.zip` (1.1 GB legacy).

### Validación G2
- [ ] Custom protocol responde con caching headers correctos.
- [ ] LRU cache no excede 400 pixmaps en stress test.
- [ ] Galería de 415 gifts carga smooth a 60fps.
- [ ] Lazy loading visible en el devtools (network panel).
- [ ] Auto-descarga: simular un gift evento con URL → PNG aparece en
      `data/donaciones/` con metadata `tEXt`.
- [ ] Fallback chain: borrar PNG → muestra default categoría → borrar
      default → genera letter PNG.

---

## G3 · Galería de Donaciones completa

> **Objetivo**: replicar `gifts_dialog.py` y `gift_selector.py` al 100%.

### Features a portar (sección C · 17 ítems)
- C1 GiftsDialog galería con cards (950x750)
- C2 GiftCardWidget 110x135 con imagen 80x80
- C3 search con debounce 150ms
- C4 sort asc/desc por coins
- C5 toggle "Mostrar desactivadas"
- C6 "Importar desde carpeta" → `scan_donaciones_folder`
- C7 preview lateral (180x180 + nombre + coins + ID)
- C8 form CRUD: nombre, ID (locked), coins, icon, enabled
- C9 browse imagen con QFileDialog (filter PNG/JPG/etc)
- C10 CRUD save/delete/new gift
- C11 GiftSelectorDialog reusable (750x550)
- C12 SelectorCard 100x130 con grid 6 cols
- C13 doble-click acepta directo
- C14 read PNG `tEXt` metadata para auto-import
- C15 `Rose_black_white.png` placeholder universal
- C16 filter por search en gallery
- C17 disabled gifts con bg gris look

### Validación G3
- [ ] Galería de 415 PNGs con search funcional.
- [ ] CRUD completo persiste en `gifts.json`.
- [ ] Importar desde carpeta detecta PNG nuevos y agrega entries.
- [ ] GiftSelectorDialog reusable funciona desde rule_dialog (G6).
- [ ] Comparar visual con `gifts_dialog.py` original — paridad.

---

## G4 · Conexión con juegos + diálogos custom

> **Objetivo**: `manage_games_dialog` + `custom_game_dialog` +
> conexión async + comprobación de puerto al 100%.

### Features a portar (sección D · 24 ítems)
- D1-D4 Valheim/Terraria/Minecraft games + MinecraftRCON (en sidecar Python)
- D5 CustomGame configurable HTTP/RCON
- D6 templating de payload con 6 variables
- D7 ThreadPoolExecutor pool 50 workers (en sidecar)
- D8 fire-and-forget HTTP/RCON
- D9 test_connection cascading (status → spawn → socket)
- D10 ConnectionWorker async (en sidecar via JSON-RPC)
- D11 sidebar selector de juego con 8 opciones
- D12 "Probar" connection con feedback color
- D13 "Config" → CustomGameDialog
- D14 "Añadir Juego" → ManageGamesDialog
- D15 CustomGameDialog completo (837 líneas)
- D16 4 presets (Valheim, Terraria, 7 Days, Rust RCON)
- D17 Categorías declarables (id, name, type, endpoint, payload, rcon_cmd, tutorial)
- D18 Tutorial inline por categoría
- D19 ManageGamesDialog (3 predefinidos editables + custom CRUD)
- D20 EditPredefinedDialog (host/port/password)
- D21 Auto-test debounce 800ms (HTTP)
- D22 NewProfileDialog (crear perfil basado en otro)
- D23 Async via EX desde category_tabs
- D24 `_execute_custom_game_action` callback (RuleEngine → GUI)

### Bundle de juegos default
8 juegos en `games.json` seed:
- Predefinidos: `valheim, terraria, minecraft`.
- Custom: `repo, 7_days_to_die, hytale, ror2`.
- **Eliminar duplicado** `7daystodie` (sin underscore).

### Validación G4
- [ ] Con servidor real (Valheim/Terraria), conectar y spawn entity desde UI.
- [ ] Minecraft RCON con password correcto conecta.
- [ ] Auto-test debounce visible.
- [ ] Crear nuevo perfil basado en Valheim funciona (copia data + crea rules vacío).
- [ ] CustomGameDialog admite categoría custom con endpoint nuevo.
- [ ] Tutorial se muestra en DataDialog (G5).

---

## G5 · Catálogo de entidades por juego

> **Objetivo**: `data_dialog` + `entity_selector` al 100% + galería
> visual con tabs multi-categoría.

### Features a portar (sección E · 20 ítems)
- E1 DataDialog grid + preview (950x700)
- E2 EntryCard 120x120 imagen 64x64
- E3 form CRUD: name, command, icon, "Probar"
- E4 browse PNG → save en `game_images/<game>/<cat>/<cmd>.png`
- E5 tutorial inline (de games.json o defaults)
- E6 search debounce
- E7 EntitySelectorDialog reusable (multi-tab + multi-select)
- E8 EntityCard 110x130 lazy-loaded
- E9 tabs por categoría con `setExpanding(True)`
- E10 multi-select con `_SelectionRow` (qty per item)
- E11 lazy image loading
- E12 tabs dinámicas por juego (CategoryTabsMixin)
- E13 parse_entry "NombreVisible:Comando"
- E14 find_command fuzzy con 4 estrategias
- E15 manejo de categorías extra (`_extra_data`)
- E16 quick-change entity desde lista de reglas
- E17 resolver 18 mismatches de entries sin PNG
- E18 dedup `7_days_to_die` vs `7daystodie`
- E19 categoría `valuables` (158 PNGs en R.E.P.O.)
- E20 categoría `equipment` (30 PNGs en RoR2)

### Validación G5
- [ ] Cargar `data_terraria.json` (130 entities + 470 items + 26 events)
      en menos de 1 segundo.
- [ ] EntitySelectorDialog con multi-select retorna lista correcta.
- [ ] R.E.P.O. tab `valuables` muestra los 158 items.
- [ ] RoR2 tab `equipment` muestra los 30 items.
- [ ] Quick-change entity desde lista de reglas funciona.
- [ ] Tutorial se muestra arriba del DataDialog.

---

## G6 · Editor de Reglas — multi-acción 100% paridad

> **Objetivo**: `rule_dialog` con TODAS sus features.
> **El más crítico del producto.**

### Features a portar (sección F · 36 ítems)
- F1 RuleDialog scroll + 9 secciones (680x880)
- F2 7 trigger types (gift/command/follow/share/subscribe/like/like_milestone)
- F3 4 secciones que se ocultan/muestran según trigger
- F4-F7 selector de gift (combo + galería + sort + search)
- F8 Like cada N (QSpinBox 1-10000)
- F9 Like milestone (QSpinBox 100-1M)
- F10 Command input
- F11 Allowed_users con CSV
- F12 lista de acciones múltiples
- F13 add/edit/delete acción
- F14 sub-modal de edit acción
- F15 Random action checkbox
- F16 combo action_type cargado de games.json
- F17 "Galería unificada" multi-select
- F18 Test inline de acción
- F19 QPlainTextEdit para Minecraft (multi-line)
- F20 Cooldown
- F21 TTS por regla (toggle + msg + voice)
- F22 backward-compat con campos legacy
- F23 lista de reglas con drag&drop reorder
- F24 `_build_rule_widget` con 2 imágenes + flecha
- F25 click en imagen → quick change
- F26 6 botones CRUD (Nueva, Duplicar, Editar, Eliminar, On/Off, Probar)
- F27 Import/Export reglas a JSON
- F28 Validate all rules
- F29 RuleValidator con cache + lookup O(1)
- F30 backup automático antes de import
- F31 Test selected rule (todas las acciones)
- F32 search + filter de reglas
- F33 RuleEngine: process_event con 8 trigger types
- F34 Like counter por (rule_id, user) + milestone reached set
- F35 Multi-action atómica (no aborta si falla una)
- F36 TTS automático en rule trigger

### Schema target del rule (formato moderno)
```json
{
  "id", "name", "enabled",
  "trigger_type", "trigger_value",
  "action_type", "action_value", "amount", "commands",
  "actions": [{action_type, action_type_name, action_value, amount, commands}],
  "random_action": false,
  "cooldown": 0,
  "tts_enabled": false, "tts_message": "", "tts_voice": "",
  "allowed_users": []
}
```

### Validación G6
- [ ] Importar `rules_valheim.json` real (27 reglas) → todas se ven igual.
- [ ] Importar `rules_terraria.json` (25 reglas, incluye 5 multi-action).
- [ ] Crear regla con 5 acciones + random_action → ejecutar → solo 1 random.
- [ ] Crear regla like 10 → triggear 10 likes → ejecuta una vez.
- [ ] Crear regla like_milestone 1000 → no ejecuta hasta llegar a 1000.
- [ ] Drag&drop reorder persiste.
- [ ] Validar reglas detecta gift no encontrado.
- [ ] Backup `pre_import` se crea antes de importar.

---

## G7 · Sistema social completo (rachas + fortuna)

> **Objetivo**: replicar `social_config.py` (2464 líneas) +
> `core.social_system + core/social/*` 100%.

### Features a portar (sección G · 35 ítems + sección P · 11 ítems)
- G1 SocialSystem con 6 mixins + 35 comandos
- G2 8 categorías de comandos
- G3-G9 7 grupos de comandos (DUEL, ACCEPT, RESPONSE, UTILITY, MUSIC, IA, SYSTEM)
- G10 auto-add new commands con `known_commands`
- G11 rachas diarias (`!racha`)
- G12 auto-rachas + timer 1h
- G13 sistema de duelos con `!dado`
- G14 timeout 90s default
- G15 cooldown 10s default
- G16 relaciones single-per-type
- G17 stats per-user (>14 keys)
- G18 stats globales
- G19 tarot con 78+ cartas
- G20 ranking, top, likes
- G21 taps system con historial diario
- G22 taps cleanup timer 6h
- G23 streak overlay callback
- G24 111 narraciones (238 variantes) JSON-driven
- G25 username normalization
- G26 silencio sin TTS si no registrado
- G27 SocialConfigDialog (7 tabs)
- G28-G32 las 7 tabs (General/Comandos/Usuarios/Taps/Stats/Spotify(en G14)/IA(en G8))
- G33 sub-modal Auto-Racha (1-365 días)
- G34 AdminMixin con 30+ admin methods
- G35 "Sistema Social" GroupBox sidebar

### Fortuna (cross-fase)
- P1-P11: GroupBox sidebar + match exacto + 17 categorías 842 mensajes + canal TTS exclusivo (en G9).

### Bundle data
- `data/social_narrations.json` con 111 keys × 238 variantes.
- `data/fortunes.json` con 842 mensajes en 17 categorías.
- `core/social/_tarot_data.py` con cartas + interpretaciones (586 líneas).

### Validación G7
- [ ] Los 35 comandos funcionan desde chat (`!register, !golpe @x, !beso @y, !dado, !racha, !ranking`, etc.).
- [ ] Tabla de usuarios con celdas editables persiste cambios.
- [ ] Auto-racha: activar 7 días, simular 24h pasaron → racha auto-marca.
- [ ] Tarot da carta diferente cada vez con interpretación.
- [ ] Reset all data con doble confirm + escribir DELETE.
- [ ] Comparar tabs de SocialConfigDialog lado a lado con original.

---

## G8 · IA real (multi-proveedor)

> **Objetivo**: `core.ia_engine` 100% + tab IA en SocialConfigDialog.

### Features a portar (sección H · 20 ítems)
- H1 IAEngine con 4 proveedores
- H2-H5 Claude (2 modelos), Groq (4), Gemini (3), OpenAI (4)
- H6 `_FREE_FALLBACK_ORDER` auto-fallback
- H7 API keys por proveedor
- H8 MODELS dict por proveedor
- H9 _COST_RATES USD por 1M tokens
- H10 cooldown 3-120s por user
- H11 max_response_length 100-800 chars
- H12 detección automática fortune type
- H13 3 prompts dramáticos especiales (suerte, tarot, horoscopo)
- H14 SOYKORU_CONTEXT **configurable** en el port (no hardcoded)
- H15 system prompt custom
- H16 log detallado tokens + costo USD
- H17 tab IA en SocialConfigDialog
- H18 test IA con thread daemon + signal
- H19 comando `!ia` desde social_system
- H20 `_ia_speak_lock` para serializar

### Cambio respecto al original
- **`SOYKORU_CONTEXT` configurable** desde la UI: campo "Contexto del
  streamer" en el tab IA. El usuario edita su propia bio. Default vacío
  o template genérico.

### Validación G8
- [ ] Test IA en cada proveedor con su key real.
- [ ] Auto-fallback: configurar Gemini sin key → poner Groq con key
      → fallar Gemini → debe usar Groq automáticamente.
- [ ] Cooldown: 2 preguntas seguidas del mismo user → segunda rechaza.
- [ ] Detection fortune type: `!ia tirame las cartas` → usa prompt tarot.
- [ ] Log muestra tokens + costo USD para modelo de pago.

---

## G9 · Voces TTS (globales + perfil + usuario + prueba)

> **Objetivo**: `voices_dialog` + 3 canales TTS + 74 voces + 3 niveles.

### Features a portar (sección I · 22 ítems)
- I1 TTSEngine con endpoint TikTok TTS
- I2 74 voces hardcoded
- I3-I5 3 canales (chat, social, fortune) independientes
- I6 3 canales simultáneos
- I7 cache MD5 audio MP3
- I8 retries con backoff
- I9 truncado chat 150 / social-fortune 400
- I10 split por `". "` para chunks largos
- I11 `_social_gen_lock` atomicidad
- I12 username normalization
- I13 3 niveles de voces (default → perfil/global → per-user)
- I14 voces globales vs por perfil (radio toggle)
- I15 VoicesDialog (550x500)
- I16 "Probar voz" button
- I17 sub-modal de edit voz
- I18 TTS GroupBox sidebar (volumen, voice, prueba, voces button)
- I19 volumen slider con label `%`
- I20 `speak_now` síncrono para botón
- I21 clear_cache al boot
- I22 stop limpio de los 3 canales

### Bundle
- `tts_engine.py` completo (840 líneas) en sidecar Python.
- 74 voces hardcoded en `VOICES` dict.

### Validación G9
- [ ] 74 voces aparecen en el combo.
- [ ] Probar voz: TTS habla correctamente.
- [ ] Asignar voz a @user → su próximo mensaje sale con esa voz.
- [ ] Cambiar de "perfil" a "globales" → user_voices cambia.
- [ ] Reproducir 3 mensajes simultáneos en los 3 canales — no se
      interrumpen.
- [ ] Cache MD5 hit en segunda generación del mismo texto.

---

## G10 · Stream Profiles + sonidos por evento + minigames

> **Objetivo**: snapshots completos + sounds + 3 minijuegos.

### Features a portar (sección J · 27 ítems)
- J1 StreamProfilesDialog con cards (880x640)
- J2 ProfileCard 82px
- J3-J7 save/load/duplicate/rename/delete + export/import
- J8 schema completo del profile JSON
- J9 SoundsDialog 3 tabs
- J10 tab Biblioteca con cards
- J11 tab Regalos por gift
- J12 tab Eventos (3: follow, share, superfan)
- J13 volume slider
- J14 playback en thread daemon
- J15 sound queue + worker
- J16 sound cache LRU 50
- J17 MinigamesDialog (520x580)
- J18 WordSearchGame (8 direcciones)
- J19 WordSearchLite mode
- J20 WordBombGame (fragmentos, vidas, bonus abecedario)
- J21 19 categorías de palabras
- J22 spanish_words.py diccionario
- J23 minigame_stats persistentes
- J24 avatar pool from game_images
- J25 game_sounds sintetizados (11 ADSR)
- J26 process_minigame_command desde chat
- J27 NewProfileDialog (compartir sonidos/voces globales)

### Validación G10
- [ ] Save profile actual → archivo JSON correcto.
- [ ] Load profile → reemplaza juego, gifts, sounds, voices, theme,
      rules. Backup `pre_load` se crea.
- [ ] Export profile → archivo `.lce_profile.json` correcto.
- [ ] Import profile → mismo schema funciona.
- [ ] WordSearch: generar grilla 10x10 con 8 palabras.
- [ ] WordBomb: 2+ jugadores, 15s turn, vida bonus al completar A-Z.
- [ ] WordSearchLite: rondas automáticas sin pistas.

---

## G11 · Simulador real + log widget pro

> **Objetivo**: `simulator_dialog` + log con 19 categorías + 8 filtros.

### Features a portar (sección K · 21 ítems)
- K1 SimulatorDialog 800x760
- K2 6 trigger types
- K3 galería gifts 100x92
- K4 search + sort
- K5 repeat 1-100
- K6 burst con stagger 200ms
- K7 10 presets
- K8 preview del gift seleccionado
- K9 status auto-clear 2s
- K10 `_execute_simulated_event` flujo idéntico a `on_event`
- K11 EnhancedLogWidget 19 categorías
- K12 8 filtros UI agrupados
- K13 auto-detection 12 reglas regex
- K14 smart auto-scroll
- K15 batch updates 50ms
- K16 stats counter
- K17 MAX 500 entries con trim
- K18 clear/export/reset stats/timestamps
- K19 SystemHealthWidget 4 indicadores
- K20 health timer 30s
- K21 activity indicator + pulse 5s

### Validación G11
- [ ] Simular cada uno de los 6 trigger types funciona.
- [ ] Burst 50x rosa: 50 gifts visibles en log con stagger 200ms.
- [ ] Preset "!ia hola" abre comando IA en chat real.
- [ ] Log con 1000 mensajes no laggea (trim a 500 funciona).
- [ ] Auto-scroll: si scroll-up, contador unread incrementa.
- [ ] Health: TikTok desconectado muestra rojo.

---

## G12 · Backup manager

> **Objetivo**: `backup_dialog` + atomic writes + migración automática.

### Features a portar (sección L · 11 ítems)
- L1 BackupManager MAX 7 FIFO
- L2 4 reasons typeados
- L3 3 critical files + globs
- L4 BackupDialog cards (700x580)
- L5 cards con icon + reason badge + age relativo
- L6 restore con pre-restore backup automático
- L7 delete con confirm
- L8 auto-cleanup al crear
- L9 atomic write fsync (`config_store`)
- L10 migración config monolítico → particionado
- L11 "Respaldos" botón sidebar

### Validación G12
- [ ] Crear 8 backups → solo 7 quedan (FIFO drop el más viejo).
- [ ] Restaurar → backup `prerestore` se crea antes.
- [ ] Migración: arrancar con `config.json` viejo monolítico → se
      divide en 4 archivos.
- [ ] Crash test: matar proceso durante save → JSON queda válido (atomic write).

---

## G13 · Overlays manager

> **Objetivo**: `overlays_manager` + Cloudflare backend + 2 overlays.

### Features a portar (sección M · 21 ítems)
- M1 OverlayClient (Cloudflare Workers)
- M2 OVERLAY_REGISTRY extensible
- M3 anonymous user_id SHA256
- M4 migración IDs viejos
- M5 send_event async fire-and-forget (1.5s)
- M6 skip si NO hay overlay enabled
- M7 throttled error log (3 max + silencio)
- M8 test_connection /health
- M9 OverlaysManager grid 2 cols (960x720)
- M10 OverlayCard 420x420 con preview iframe
- M11 pre-warmup detrás del splash
- M12 "Copiar URL" feedback
- M13 "Test" event con payload por overlay
- M14 "Reload remoto"
- M15 OverlaySettingsDialog
- M16 live update via `<id>_config` event
- M17 settings de taps (goal, color picker, message, reset_on_goal)
- M18 settings de streak (duration, label)
- M19 "Cambiar mi alias"
- M20 cards "PRÓXIMAMENTE"
- M21 "Overlays" botón sidebar

### Cambio respecto al original
- En Electron, el preview del overlay usa **iframe** (no `QWebEngineView`).
- Backend (`maru-overlays.soykoru07.workers.dev`) y frontend
  (`overlays.korugames.lat`) se mantienen tal cual.

### Validación G13
- [ ] Galería muestra 2 overlays + 3 placeholders.
- [ ] Copiar URL: pegar en TikTok Studio Browser Source → llega evento.
- [ ] Test event: 50 taps reflectan en overlay live.
- [ ] Cambiar color en settings → overlay actualiza sin recargar.
- [ ] Reload remoto: overlay hace location.reload().

---

## G14 · Pulido + integración + v1.0.0 REAL

> **Objetivo**: TikTok client + Spotify + Infra + tests + v1.0.0 honesto.

### Features a portar (secciones N + O + Q · 54 ítems)

#### N · Conexión TikTok (16)
- N1 TikTokWorker en sidecar
- N2 8 signals → JSON-RPC events
- N3 backoff exponencial max 8 retries
- N4 auto-reconnect
- N5 detección 19 keywords API change
- N6 verificar is_live timeout 15s
- N7 6 event handlers
- N8 streak con group_id (max 50)
- N9 calibración likes + delta cap
- N10 auto-comando si `!`
- N11 username extraction 4 fallbacks
- N12 _extract_gift_image
- N13 sidebar TikTok GroupBox
- N14 _check_tiktok_api con check_update
- N15 KNOWN_GOOD_VERSIONS rollback
- N16 API Error modal

#### O · Spotify (23)
- O1 SpotifyClient (1652 líneas) en sidecar
- O2 OAuth server local :8888
- O3 auto-reconnect al boot
- O4 multi-cuenta accounts.json
- O5 throttling 3s/call + 8/30s
- O6 cap progresivo 60→120→300s
- O7 recovery mode 10min cache 120s
- O8 search cache 15min
- O9 _SpotipyFilter
- O10 play_request cola random priority
- O11 playfan_request cuota diaria + context
- O12 save/restore context
- O13 check_and_advance timer 30s
- O14 skip/pause/resume/toggle
- O15 get_devices + device_id
- O16 tab Spotify SocialConfigDialog
- O17 cuentas guardadas combo
- O18 guía paso a paso colapsable
- O19 now playing + queue table
- O20 UI timer 45s
- O21 priority users + playfan_uses
- O22 5 comandos enabled
- O23 TTS lectura música toggle

#### Q · Infra runtime (15)
- Q1 paths centralizados
- Q2 ensure_runtime_dirs al boot
- Q3 resolve_spotify_secret backward-compat
- Q4 logger central rotación 2MB×5
- Q5 as_callback adapter
- Q6 config_store partición 4 archivos
- Q7 atomic write fsync
- Q8 migrate_from_monolithic
- Q9 auto-save timer 5min
- Q10 _unsaved_changes flag
- Q11 7 atajos de teclado
- Q12 F1 ayuda
- Q13 closeEvent ordenado (11 timers)
- Q14 PyInstaller frozen detection (Electron equivalente: app.isPackaged)
- Q15 auto-copy bundle data al cwd al boot

### QA paridad final (cierre G14)
- [ ] Comparar pestaña-por-pestaña con MARU original — 5 screenshots
      pareados por sección.
- [ ] Importar `social_data.json` real (44 users, 68 duelos) → todo aparece igual.
- [ ] Importar `gifts.json` real (485 gifts) → galería completa.
- [ ] Conectar TikTok @soykoru en vivo → eventos llegan al log.
- [ ] Conectar Spotify con cuenta real → !play funciona.
- [ ] 27 reglas Valheim del config real → todas aparecen y funcionan.
- [ ] Performance: RAM ≤ MARU + 200MB (Electron overhead aceptable).
- [ ] CPU idle < 5%.
- [ ] All tests verde (`pnpm quickcheck`).

### v1.0.0 REAL — checklist de release
- [ ] Todas las 343 features de la matriz portadas.
- [ ] Tema único `midnight` (8 borrados).
- [ ] Splash idéntico al original.
- [ ] Logo + icon en bundle.
- [ ] AutoUpdater funcionando.
- [ ] CHANGELOG honesto: "v1.0.0 — paridad 100% con MARU original v8.5".
- [ ] Migración usuario MARU → MARU Desktop probada.
- [ ] Smoke test: arranque < 3s, no errors en log.
- [ ] Build EXE / DMG / AppImage según OS target.

---

## Reglas de oro de cada fase G

1. **Antes de empezar**: abrir el original, ejecutar la pestaña relevante,
   hacer screenshot.
2. **Durante**: ir punto por punto del audit document G0.3-G0.8 +
   features IDs de la matriz.
3. **Al cerrar**: comparar lado a lado con el original, screenshots
   pareados.
4. **Si una feature no está en la matriz**, no se mete (no inventar).
5. **Si una feature está en la matriz y no en el código**, la fase no cierra.

---

## Próximos pasos

### Inmediato (cerrar G0)
- **G0.11**: producir checklist de limpieza pre-G1
  (`MARU_CLEANUP_BEFORE_G1.md`).

### Después de G0 (cuando el usuario diga "vamos con G1")
- Borrar invenciones (8 temas, página TTS, simulador inline,
  donations mock, welcome hero).
- Revertir `package.json` v1.0.0 → v0.5.0-alpha.
- Empezar a portar features sección A (G1).

### Cadencia esperada
- G1 + G2: 1-2 semanas (foundation visual + imágenes).
- G3-G6: 3-4 semanas (UI principal: gifts, juegos, datos, reglas).
- G7-G9: 3-4 semanas (social + IA + TTS).
- G10-G13: 2-3 semanas (profiles + simulador + backup + overlays).
- G14: 2-3 semanas (TikTok + Spotify + integración + QA).

**Total estimado**: 11-16 semanas para v1.0.0 real con paridad 100%.

---

## Compromiso del Plan G

> Cada fase G se cierra **solo** cuando todas las features de su sección
> de la matriz están portadas y verificadas contra el original. Sin
> atajos. Sin "MVP". Sin features inventadas.
>
> El producto final = todo lo del audit + identidad visual mejorada.
> Misma cantidad de features, mismo flujo, mismas opciones, MISMA
> sensación.
