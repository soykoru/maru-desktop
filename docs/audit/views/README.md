# MARU Original — Audit de gui/views, gui/widgets, gui/controllers

> Producido en G0.5 · 2026-04-27.

## Documentos

- [`MARU_VIEWS_MIXINS.md`](MARU_VIEWS_MIXINS.md) — los 5 mixins de `gui/views/` (2129 líneas)
- [`MARU_WIDGETS.md`](MARU_WIDGETS.md) — los 14 widgets de `gui/widgets/` (4083 líneas)
- [`MARU_CONTROLLERS.md`](MARU_CONTROLLERS.md) — el único controller (`ConnectionWorker`, 17 líneas)

## Otros artefactos producidos en G0.5
- [`../MARU_VISUAL_AUDIT.md`](../MARU_VISUAL_AUDIT.md) — paleta hex
  exacta, tipografía, splash, animaciones, todo el design system unificado.

## Resumen de hallazgos clave

### Design system (`gui/constants.py`)
- **Tema único** confirmado: borrar Aurora/Cyberpunk + los demás 7
  temas. Solo queda `midnight`.
- **34 tokens** explícitos en constants (acentos, texto, cards, paneles,
  inputs, botones, header/footer, scrollbars).
- **9 helpers de estilo** (`card_style`, `input_style`,
  `btn_primary_style(color)`, `btn_secondary_style`, `btn_danger_style`,
  `header_gradient`, `footer_style`, `scroll_style`).
- **GIFTS** — diccionario hardcoded de **15 gifts** con `id → "<emoji>
  <Nombre> (<coins>)"`. Es un fallback / referencia visual; el JSON
  `gifts.json` con 415 entradas tiene precedencia.
- **GAME_FEATURES** — solo los 3 predefinidos `valheim, terraria,
  minecraft` con `entities/items/events: True`. Custom games extienden
  este dict en runtime.

### Mixins
- **AudioMixin (425 líneas)**: 3 canales TTS (chat/social/fortune)
  + sistema de sonidos con cola y worker daemon + 17 categorías de
  fortuna con random uniforme.
- **ImagesMixin (298 líneas)**: pre-index de imágenes al boot +
  auto-descarga de gifts con metadata `tEXt` injection.
- **SimulatorMixin (263 líneas)**: flujo idéntico al `on_event` real,
  burst con stagger 200ms.
- **StreamProfilesMixin (669 líneas)**: snapshots completos
  (juego+reglas+gifts+sonidos+voces+TTS+tema) con backup auto al cargar.
- **CategoryTabsMixin (450 líneas)**: pestañas dinámicas + ejecución
  asíncrona via `core.games.EX` con templating de payload completo
  (variables `{entity}, {amount}, {user}, {username}, {command}, {value}`).

### Widgets
- **EnhancedLogWidget (362 líneas)**: 19 categorías con colores propios,
  8 filtros UI agrupados, smart auto-scroll, batch updates 50ms,
  auto-detection con 12 reglas regex.
- **AnimatedSplashScreen (123 líneas)**: 380x280, progress bar gradient
  rojo→morado, ~1.7s hasta 100%.
- **NotificationWidget**: 4 estilos de toast (success/error/warning/info)
  con bg color por tipo, position top-center.
- **BackupManager (135 líneas)**: 7 backups max, los **3 críticos**
  (`config, social_data, fortunes`) + globs de `rules_*.json` y
  `data_*.json`. Display name `dd/mm/yyyy hh:mm`.
- **SystemHealthWidget (116 líneas)**: 4 indicadores
  (`tiktok, game, tts, backup`) con 4 estados visuales.
- **RuleValidator (200 líneas)**: cache de game data con lookup-set
  pre-procesado para búsqueda O(1).
- **image_cache.py**: LRU max 400 pixmaps + 400 icons. Tinting destructivo
  (sobrescribe archivo).
- **default_images.py**: 7 trigger icons + 6 category icons con triple
  fallback (icons8 → uxwing+tint → letra generada).
- **game_sounds.py**: 11 sonidos sintetizados con ADSR envelope, sin
  archivos externos.
- **OverlayCard (429 líneas)**: preview con QWebEngineView + live update
  via `<overlay_id>_config` event sin recargar.
- **3 minijuegos** ventanas independientes (`WordBombWindow`,
  `WordSearchWindow`, `WordSearchLiteWindow`).

### Controller
- **ConnectionWorker (17 líneas)**: único QThread del módulo. Para test
  de conexión async.

## Lista de constantes y tokens

### Colores especiales que NO están en `constants.py` pero se repiten
- `#7ed6df` (cyan secundario, GroupBox titles, hints info).
- `#dfe6e9` (texto claro decorativo).
- `#b2bec3` (subtítulos en list items).
- `#636e72` (gris oscuro detail).
- `#888` (hints generic).
- `#f9ca24` (amarillo de monedas — siempre).
- `#a29bfe` (TTS log color).
- `#1DB954` (Spotify green — siempre).
- `#0d0d14` (background base, igual que splash).

### Fuentes
- Primaria: **`Segoe UI`** (default Windows).
- Mono: **`Consolas`** (logs).
- Emoji: **`Segoe UI Emoji`**.

### Tamaños comunes (px)
9, 10, 11, 12, 13, 14-15, 16-18, 22-28, 64.

## Implicaciones para G1

1. **Tokens completos** listos para `tailwind.config.js` (sección 10 del
   visual audit).
2. **Helpers de estilo** se traducen a componentes React reutilizables
   o classes Tailwind compuestas (`@apply`).
3. **Single theme**: borrar `gui/themes.py` enteramente y dejar solo el
   tema midnight como tokens directos en `:root` CSS.
4. **Splash**: replicar idéntico en Electron BrowserWindow con `show:false`
   + opacidad 0 hasta que MainWindow esté lista.
5. **Logo**: copiar `logo.png` (1.1 MB) al bundle del Electron app.
6. **Iconos auto-descargables**: incluir los 13 PNG (7 triggers + 6
   categorías) estáticos en el bundle — NO descargar en runtime.
7. **3 ventanas de minijuegos**: replicar como vistas dentro del mismo
   Electron window o como ventanas separadas (`new BrowserWindow`) según
   se prefiera. El original las abre como ventanas independientes
   (`QMainWindow`-equivalentes).
