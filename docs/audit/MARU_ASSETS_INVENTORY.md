# MARU Original — Inventario de assets / imágenes

> Producido en G0.8 · 2026-04-27.
> Inventario completo + cross-check contra los JSON.

---

## Resumen ejecutivo

| Categoría | Archivos | Tamaño |
|-----------|---------:|-------:|
| `data/donaciones/` (PNGs reales) | **413** | 18.7 MB |
| `data/donaciones/` (basura: zip + catalog) | 2 | 1.1 GB |
| `data/icons_triggers/` | 7 | 78 KB |
| `data/game_images/<juego>/<cat>/` (reales) | **2.141** | ~50 MB |
| `data/game_images/<juego>/<cat>/_default_*.png` | ~33 | ~1 MB |
| `data/game_images/_templates/` | 276 | ~8 MB |
| `assets/overlays/` (HTML/JS/CSS) | 6 (2 overlays × 3) | ~30 KB |
| `logo.png` (root) | 1 | 1.09 MB |
| `icon.ico` (root) | 1 | 70 KB |
| **TOTAL útil** | **≈ 2.873 imágenes** | **≈ 70 MB** |

> **`gifts_1541.zip` (1.1 GB)** y `_catalog.json` (49 KB) son artefactos
> de la herramienta de descarga (no parte del runtime). En G2 se
> excluyen del bundle.

---

## 1. Donaciones — `data/donaciones/`

### Resumen
- **413 PNG reales** (18.7 MB total).
- **+ 2 archivos basura**: `gifts_1541.zip` (1.1 GB) y `_catalog.json` (49 KB).
- Existe placeholder universal: **`Rose_black_white.png`**.

### Naming convention
- Formato: `<NombreOriginalConSpaces_o_Underscores>.png`.
- Mantienen casing original de TikTok (`Heart_Me.png`, `TikTok_Universe.png`,
  `You're_amazing.png` con apóstrofo Unicode).
- Algunos con caracteres especiales: `Adam's_Dream.png` (apóstrofo
  curly U+2019).
- Numerados: `TikTok_Universe.png` y `TikTok_Universe_2.png` (variantes).

### Cross-check contra `gifts.json` (485 entries)

| Estado | Count |
|--------|------:|
| Gift con `icon_path` apuntando a PNG real existente | **423** |
| Gift apunta a `Rose_black_white.png` (placeholder) | **62** |
| Gift con `icon_path` vacío | 0 |
| Gift apunta a archivo MISSING | **0** ✅ |

> Los **62 con placeholder** son los gifts marcados `disabled: true` —
> conservan metadata pero no PNG.

### PNGs huérfanos (en disco pero sin gift que los referencie)

10 PNGs:
- `Balloons.png`
- `Candy_Bouquet.png`
- `Castle_Fantasy.png`
- `Diamond_Gun.png`
- `Heart.png`
- `LIVE_Ranking_Crown.png`
- `Level_Ship.png`
- `Rose_Bear.png`
- `Rose_Hand.png`
- `Star_Throne.png`

> Probablemente gifts viejos o variantes no usadas. Conservar (son
> assets útiles si TikTok los reactivan).

### `_catalog.json` (49 KB) — herramienta de descarga

Estructura:
```json
[
  { "file": "Adam's_Dream.png", "id": "adam's_dream", "name": "Adam's Dream", "coins": 25999 },
  ...
]
```

414 entries. Stats:
- coins: min=0, max=44999, median=399.

### `_catalog.json` vs `gifts.json` (cross-check normalizado)

Normalizando lowercase + `_` → ` `:
- **408 IDs matchean** entre ambos.
- **6 solo en catalog** (apóstrofos curly que gifts.json no tiene).
- **76 solo en gifts.json** (auto-detectados en vivo por TikTok después
  del catalog inicial — flujo `_on_gift_image_detected`).

> El **catalog es el seed inicial** del bundle; `gifts.json` se va
> enriqueciendo con auto-descargas en vivo. **Ambos coexisten**.

### Para el port (G2)
1. Bundlear los **413 PNG** (18.7 MB).
2. **NO bundlear** `gifts_1541.zip` (1.1 GB).
3. **Bundlear** `_catalog.json` como seed inicial.
4. Crear `Rose_black_white.png` como placeholder universal.
5. Conservar los 10 huérfanos (futuros gifts).

---

## 2. Iconos de triggers — `data/icons_triggers/`

7 PNGs (78 KB total), todos con prefijo `trigger_`:

| Archivo | Tamaño | Trigger asociado |
|---------|-------:|------------------|
| `trigger_command.png` | ~10 KB | command (chat con `!`) |
| `trigger_follow.png` | ~10 KB | follow |
| `trigger_gift.png` | ~10 KB | gift (fallback genérico) |
| `trigger_like.png` | ~10 KB | like |
| `trigger_like_milestone.png` | ~10 KB | like_milestone |
| `trigger_share.png` | ~10 KB | share |
| `trigger_subscribe.png` | ~10 KB | subscribe / member |

> Auto-descargados al boot por `ensure_trigger_icons()` desde icons8.
> Fallback URL desde uxwing con tinting + last fallback letter PNG
> generado a 128x128.

### Para el port (G2)
- Bundlear los 7 PNG estáticamente — no descargar en runtime.
- Mantener `trigger_<type>.png` naming convention.

---

## 3. Game images — `data/game_images/<juego>/<categoria>/`

### Resumen total
- **2.141 PNGs reales** (sin contar `_default_*`).
- **~33 PNGs `_default_*.png`** (uno por categoría que se accede).
- 8 carpetas de juegos + `_templates/`.

### Distribución detallada

```
GAME           CATEGORY     JSON   PNG  MATCH  MISS  ORPH
─────────────────────────────────────────────────────────────
valheim        entities       52    93     50     2    45
valheim        items         114   140    114     0    26
valheim        events         26    26     26     0     0
                                          ──── ──── ────
                                           190     2    71

terraria       entities      130   168    130     0    39
terraria       items         470   466    470     0     0  ⚠️ 4 entries sin PNG
terraria       events         26    40     26     0    14
                                          ──── ──── ────
                                           626     0    53

minecraft      entities        1     0      0     1     0  ⚠️ no hay PNG
minecraft      items           1     0      0     1     0  ⚠️ no hay PNG
                                          ──── ──── ────
                                             0     2     0

7_days_to_die  entities       59    58     58     1     0
7_days_to_die  items         181   179    179     2     0
7_days_to_die  events         44    41     41     3     0
                                          ──── ──── ────
                                           278     6     0

hytale         entities       71    71     71     0     0  ✅ perfecta paridad
hytale         items          42    42     42     0     0
hytale         events         21    21     21     0     0

repo           entities       30    30     30     0     0  ✅ perfecta paridad
repo           items          52    52     52     0     0
repo           events          4     4      4     0     0
repo           valuables     158   158    158     0     0

ror2           entities       51    84     51     0    36
ror2           items         128   125    128     0     0
ror2           events         10    28      2     8    26  ⚠️ 8 events sin PNG
ror2           equipment      30    30     30     0     0
                                          ──── ──── ────
                                           211     8    62
─────────────────────────────────────────────────────────────
TOTAL MISS (entries sin PNG):  18
TOTAL ORPH (PNG sin entry):   186
```

### Hallazgos clave

#### Match perfecto en 3 juegos
**`hytale`, `repo`, `7_days_to_die` (casi)** — paridad total entre
JSON y PNGs. Sirven de modelo.

#### Mismatches significativos
- **Minecraft (entities + items)**: tiene entries en JSON pero CERO PNGs.
  Esperable — Minecraft usa RCON con comandos directos, las "entities"
  e "items" del data_minecraft.json son placeholder mínimos.
- **RoR2 events**: 10 entries pero solo 2 con PNG (8 missing) y 26
  PNGs huérfanos. Probablemente el JSON está incompleto o los PNGs
  fueron generados de otra fuente.
- **Valheim/Terraria/RoR2 entities**: muchos PNGs huérfanos (45/39/36).
  Los PNGs cubren MÁS de lo que el user puso en su JSON — es expected
  porque el bundle viene con catálogo completo y el user solo agrega
  los que usa.

#### Orphans = bundle más grande que catálogo del user
Los **186 PNGs huérfanos** representan la "biblioteca completa" que el
bundle proporciona — el user puede agregar nuevas entries al JSON y los
PNGs ya están listos.

#### Equipment + valuables solo en sus juegos
- `equipment`: solo en RoR2 (30 PNGs).
- `valuables`: solo en R.E.P.O. (158 PNGs).
- En los demás juegos esas carpetas existen pero solo tienen el
  `_default_<cat>.png`.

### `_default_<cat>.png` por carpeta

Cada juego tiene su `_default_entities.png`, `_default_items.png`,
`_default_events.png`, `_default_equipment.png`, `_default_valuables.png`
para fallback cuando el entry no tiene PNG específico.

Auto-generados por `ensure_category_default()` en
`gui/widgets/default_images.py`. Source primaria: icons8 + tinting con
color por categoría:
```
entities  → #a55eea (morado)
items     → #74b9ff (azul)
events    → #ffd32a (amarillo)
valuables → #7efff5 (cyan)
equipment → #ffa502 (naranja)
```

### `data/game_images/_templates/` — 276 PNGs

Plantillas genéricas reutilizables (animales, items comunes,
herramientas) — fallback para custom games sin PNGs específicos.

Ejemplos de filenames: `dragon.png`, `sword.png`, `axe.png`, `cat.png`,
`fire.png`, `gold_bar.png`, `crown.png`, `diamond.png`, etc. (lista
larga de nombres genéricos minúsculos).

### Para el port (G2/G5)
1. **Bundlear todos los 2.141 PNGs reales** + 33 defaults + 276 templates.
2. **Pre-build del image_index** al boot (replicar `_build_image_index`
   de `ImagesMixin`).
3. **Lookup con normalización** del nombre (variantes `cmd, display,
   con underscore, lowercase, safe_cmd`).
4. **Dedup `7daystodie` vs `7_days_to_die`** — quedarse con
   `7_days_to_die` como canónico (tiene `equipment` + `valuables`
   default folders, y el config real lo usa).
5. **Resolver mismatches en G5**:
   - Minecraft: aceptar que las entities/items del JSON son placeholder.
   - RoR2 events: o agregar 8 PNGs faltantes o limpiar el JSON.
   - Terraria items: 4 entries sin PNG (revisar manualmente).

---

## 4. Overlays HTML/JS/CSS — `assets/overlays/`

| Overlay | index.html | style.css | app.js | Total |
|---------|-----------:|----------:|-------:|------:|
| `streak/` | 894 B | 4.5 KB | 9.9 KB | 15.3 KB |
| `taps/` | 1.2 KB | 6.0 KB | 7.2 KB | 14.4 KB |

### Estructura por overlay
```
assets/overlays/<id>/
├── index.html   # Estructura mínima del overlay
├── style.css    # Animaciones + visual
└── app.js       # Lógica WebSocket + render
```

### Para el port
- En `maru-desktop/`, estos archivos viven en el **frontend de Cloudflare
  Pages** (`overlays.korugames.lat`), NO en el sidecar Python.
- Para preview local en la galería, copiar los HTML/JS/CSS al bundle del
  Electron app (servidos vía `QWebEngineView` en el original; en
  Electron equivalente con `<iframe>` o `<webview>`).
- El **backend WebSocket** en Cloudflare Workers
  (`maru-overlays.soykoru07.workers.dev`) se mantiene tal cual.

---

## 5. Logo + icon

| Archivo | Tamaño | Uso |
|---------|-------:|-----|
| `logo.png` (root) | 1.09 MB | Splash, titlebar, sidebar (scaled a 100px) |
| `icon.ico` (root) | 70 KB | Windows window icon |

### Lookup order
1. `BASE_DIR / "logo.png"` (cwd del exe).
2. `BUNDLE_DIR / "logo.png"` (PyInstaller _MEIPASS).
3. `Path("logo.png")` (relativo).

Mismo orden para `icon.ico`/`icon.png`.

### Para el port
- Copiar `logo.png` y `icon.ico` al bundle del Electron app.
- En `app.png`/`app.ico` para Linux/macOS si se hace cross-platform.

---

## 6. Carpetas runtime (auto-creadas, no parte del bundle)

```
data/
├── backups/<backup_<timestamp>_<reason>>/   # 7 max FIFO
├── tts_cache/<md5>.mp3                      # MP3 generados al vuelo
└── stream_profiles/<id>.json                # snapshots del user

secrets/spotify/
├── account             # cuenta seleccionada
├── accounts.json       # todas las cuentas guardadas
├── cache               # OAuth refresh token
└── rate_limit          # estado del rate limit persistido

logs/
└── livechaos.log       # rotación 2MB × 5 archivos
```

Estas carpetas se crean al boot por `ensure_runtime_dirs()` en
`core/paths.py`.

---

## 7. Inventario para empaquetado del bundle (port)

### Archivos a INCLUIR en `maru-desktop/` bundle (≈ 70 MB)

```
assets/                                  # 30 KB
├── logo.png                             # 1.1 MB
├── icon.ico                             # 70 KB
├── overlays/                            # 30 KB (preview local)
└── data/
    ├── donaciones/                      # 18.7 MB (413 PNG)
    │   └── _catalog.json                # 49 KB (seed)
    ├── icons_triggers/                  # 78 KB (7 PNG)
    └── game_images/                     # 50 MB (2.141 PNG + defaults + templates)
        ├── 7_days_to_die/
        ├── hytale/
        ├── minecraft/
        ├── repo/
        ├── ror2/
        ├── terraria/
        ├── valheim/
        └── _templates/
```

### Archivos a EXCLUIR del bundle
- `data/donaciones/gifts_1541.zip` (1.1 GB, herramienta de descarga).
- `data/donaciones/7daystodie/` (duplicado legacy de `7_days_to_die`).
- `data/backups/`, `data/tts_cache/`, `data/stream_profiles/` (runtime).
- `secrets/`, `logs/` (runtime/sensible).

---

## 8. Hallazgos para el plan G

### G2 (Sistema de imágenes)
- **Custom protocol** `maru://images/<scope>/<file>` para servir PNGs
  desde el bundle al renderer.
- **Image cache LRU** (max 400 según `image_cache.py`).
- **`_image_index`** pre-built al boot (mapeo `cmd → path` con
  variantes).
- **Lazy loading** en grids grandes (`<img loading="lazy">` o
  IntersectionObserver para cards >100).
- **Fallback chain**: entry-specific → `_default_<cat>.png` →
  `_templates/<genérico>.png` → letter PNG generado.
- **Migración** de `icon_path` absolutos a relativos al `data/donaciones/`.

### G3 (Galería de Donaciones)
- 413 PNGs cargando smooth con virtual scroll.
- Search por nombre + sort por coins.
- 10 PNGs huérfanos como "biblioteca extra" del bundle.

### G5 (Catálogo de entidades por juego)
- Resolver los **18 mismatches** (entries sin PNG):
  - Minecraft 2: aceptar que son placeholder (juego es RCON-only).
  - 7_days_to_die 6: agregar PNGs faltantes o relajar el JSON.
  - RoR2 8 events: agregar PNGs (los nombres son `100, 1000, 10000` —
    parece datos sintéticos).
  - Terraria 0 ✅.
  - Valheim 2 entities: chequear nombres exactos.
- **Decidir canónico** entre `7_days_to_die` y `7daystodie` (eliminar
  el duplicado).

---

## 9. Stats finales (resumen visual)

```
Imágenes totales útiles:  ~2.873
  ├── Donaciones:           413 (18.7 MB)
  ├── Triggers:               7 (78 KB)
  ├── Game images:        2.141 (~50 MB)
  ├── _default_*.png:        33 (~1 MB)
  └── _templates:           276 (~8 MB)

Cross-check con JSON:
  ├── gifts.json (485):
  │   ├── 423 con PNG real ✅
  │   ├── 62 con placeholder (disabled)
  │   └── 0 missing ✅
  ├── data_*.json (8 juegos):
  │   ├── ~870 entries con PNG ✅
  │   ├── 18 entries sin PNG ⚠️
  │   └── 186 PNGs huérfanos (bundle extra)
  └── _catalog.json (414): 408 norm-match con gifts.json

Tamaño bundle estimado (port): ~70 MB
```

### Identidad visual confirmada
- **logo.png** y **icon.ico** disponibles → identidad MARU lista para G1.
- **`Rose_black_white.png`** = placeholder universal de gifts.
- **5 colors per category** definidos en defaults (morado/azul/amarillo/cyan/naranja).

---

## Conclusión: G0 al 80%

El audit confirma que MARU tiene un **bundle de assets limpio y bien
estructurado** con paridad casi completa entre JSONs y PNGs.

Los **18 mismatches** son menores y trazables. Los **186 huérfanos**
son features del bundle (catálogo más completo de lo que el user usa).

El port debe replicar este sistema 1:1 con custom protocol + LRU cache
+ lazy loading.
