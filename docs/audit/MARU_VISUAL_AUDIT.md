# MARU Original — Audit Visual

> Identidad visual exacta del MARU original. Todo lo extraído acá es
> contrato firme para G1 (Identidad visual + design tokens).
> Fuente: `gui/constants.py` + `gui/themes.py` + `gui/widgets/splash.py`.

---

## 1. Logo y Splash

### Logo
- **Archivo**: `logo.png` (1.1 MB) en root del proyecto.
- **Tamaños usados**:
  - Sidebar de MainWindow: scaled a 100px de ancho con `SmoothTransformation`.
  - Splash screen: scaled a 100x100 con `KeepAspectRatio`.
- **Fallback**: si no existe `logo.png`, mostrar texto `"MaruLive"` 18px bold ACCENT.
- **Lookup order**: `BASE_DIR/logo.png` → `BUNDLE_DIR/logo.png` → `Path("logo.png")`.

### Icon
- **Archivo**: `icon.ico` (69 KB) en root.
- **Lookup order**: `icon.ico` → `icon.png` → fallback a `logo.png`.
- Ubicaciones: `BASE_DIR`, `BUNDLE_DIR`, cwd.

### Splash screen (`AnimatedSplashScreen`)

Fixed 380x280, frameless, translucent, always on top.

```
┌────────────────────────┐
│                        │
│       [logo 100x100]   │
│                        │
│        MaruLive        │  ← Segoe UI 28 weight 600 white
│                        │     letter-spacing 2
│                        │
│       ▓▓▓░░░░░░░░░     │  ← progress bar 3px alto
│                        │     gradient #e74c3c → #9b59b6
└────────────────────────┘
```

- Container interior: bg `#0d0d14`, border-radius `16px`.
- Padding: 40px laterales / 50px top / 40px bottom.
- Logo (100px) o emoji `🎮` (64px) si no hay logo.
- Spacing 20px entre logo y título.
- Title: `"MaruLive"` color `#ffffff`, font-size `28px`, font-weight `600`,
  letter-spacing `2px`.
- Progress bar: 3px alto, bg `rgba(255,255,255,0.1)` con fill gradient
  horizontal `#e74c3c → #9b59b6`. Avanza 1.5% cada 25ms (~1.7 segundos hasta 100%).
- Al llegar a 100%: `QTimer.singleShot(200, _finish)` → emite `finished`.
- `fade_out()`: setea opacidad 0 y close.

---

## 2. Paleta de colores (hex EXACTOS — del design system)

### Acentos
| Token | Hex | Uso |
|-------|-----|-----|
| `ACCENT` | `#f39c12` | Primario (naranja-mostaza). Logos, títulos, botones default. |
| `ACCENT_BLUE` | `#74b9ff` | Selección de cards/items, focus de inputs. |
| `ACCENT_GREEN` | `#27ae60` | Botones primarios "Save". |
| `ACCENT_GREEN_LIGHT` | `#2ecc71` | Hover de verde. Status OK. |
| `ACCENT_RED` | `#e74c3c` | Botones de delete, errores. |
| `ACCENT_RED_DARK` | `#c0392b` | Gradient de delete (stop final). |
| `ACCENT_PURPLE` | `#9b59b6` | Botones secundarios morados. |

### Texto
| Token | Hex | Uso |
|-------|-----|-----|
| `TEXT_PRIMARY` | `white` | Texto principal. |
| `TEXT_SECONDARY` | `rgba(255,255,255,0.7)` | Subtítulos, hints suaves. |
| `TEXT_MUTED` | `rgba(255,255,255,0.4)` | Metadata, fechas, contadores. |
| `TEXT_HINT` | `rgba(255,255,255,0.35)` | Placeholders, hints muy débiles. |

### Cards y contenedores
| Token | Hex | Uso |
|-------|-----|-----|
| `CARD_BG` | `rgba(255,255,255,0.07)` | Fondo de card normal. |
| `CARD_BG_HOVER` | `rgba(255,255,255,0.12)` | Fondo de card hover. |
| `CARD_BORDER` | `rgba(255,255,255,0.10)` | Borde de card normal. |
| `CARD_RADIUS` | `10px` | Radio uniforme. |
| `CARD_SELECTED_BG` | `rgba(116,185,255,0.18)` | Fondo de card seleccionada. |
| `CARD_SELECTED_BORDER` | `rgba(116,185,255,0.5)` | Borde de card seleccionada. |

### Paneles
| Token | Hex | Uso |
|-------|-----|-----|
| `PANEL_BG` | `rgba(0,0,0,0.2)` | Bg interior de paneles. |
| `PANEL_RADIUS` | `12px` | Radio uniforme paneles. |

### Inputs
| Token | Hex | Uso |
|-------|-----|-----|
| `INPUT_BG` | `rgba(0,0,0,0.25)` | Fondo de inputs. |
| `INPUT_BORDER` | `rgba(255,255,255,0.08)` | Borde normal. |
| `INPUT_BORDER_FOCUS` | `rgba(116,185,255,0.4)` | Borde focus. |
| `INPUT_RADIUS` | `8px` | Radio uniforme. |

### Botones
| Token | Hex | Uso |
|-------|-----|-----|
| `BTN_RADIUS` | `10px` | Radio normal. |
| `BTN_RADIUS_SM` | `8px` | Radio pequeño (subbtons). |

### Footer/Header
| Token | Hex | Uso |
|-------|-----|-----|
| `HEADER_RIGHT_COLOR` | `rgba(44,62,80,0.5)` | Stop derecho del gradient horizontal de headers. |
| `FOOTER_BG` | `rgba(0,0,0,0.15)` | Fondo de footers. |
| `FOOTER_BORDER` | `rgba(255,255,255,0.05)` | Border-top de footers. |

### Scrollbars
| Token | Hex | Uso |
|-------|-----|-----|
| `SCROLLBAR_WIDTH` | `6px` | Ancho default. |
| `SCROLLBAR_HANDLE` | `rgba(255,255,255,0.15)` | Color del handle. |
| `SCROLLBAR_HANDLE_HOVER` | `rgba(255,255,255,0.25)` | Hover. |

### Especiales (no en constants pero se repiten)
| Hex | Uso |
|-----|-----|
| `#7ed6df` | Cyan secundario — labels de info, tooltips. |
| `#dfe6e9` | Texto claro decorativo. |
| `#b2bec3` | Detalle gris claro (subtítulos en list items). |
| `#636e72` | Detalle gris oscuro. |
| `#888` | Hints generic. |
| `#f9ca24` | Amarillo de monedas (always). |
| `#a29bfe` | TTS (categoría log). |
| `#1DB954` | Verde Spotify (always). |
| `#ff69b4` | Rosa social. |
| `#fd79a8` | Rosa likes. |
| `#1abc9c` | Verde turquesa (follow). |
| `#3498db` | Azul info. |
| `#0d0d14` | Background base de la app (igual que el splash). |

---

## 3. Tipografía

- **Familia primaria**: `Segoe UI` (default Windows).
- **Monospace**: `Consolas` (logs, tema Hacker).
- **Emoji**: `Segoe UI Emoji` (necesario para que los emojis se rendericen
  bien en Windows).

### Tamaños observados
| Px | Uso |
|----|-----|
| `9` | Detalles (sub-labels). |
| `10` | Hints (TEXT_MUTED). |
| `11` | Labels secundarios. |
| `12` | Texto base. |
| `13` | Botones, status TikTok. |
| `14-15` | Títulos de cards. |
| `16-18` | Headers de diálogos (bold). |
| `22-28` | Títulos de splash y headers grandes. |
| `64` | Emojis grandes (cards "Próximamente"). |

### Pesos
- `QFont.Weight.Bold` para títulos y status.
- `QFont.Weight.Normal` (default) para texto base.
- `weight: 600` en CSS para el splash title (semi-bold).

---

## 4. Iconos del sidebar (emojis)

El sidebar de MainWindow usa **GroupBoxes con emoji en el título**:
- `🎵 TikTok Live`
- `🎮 Perfil de Juego`
- `🔊 Texto a Voz`
- `🔮 Fortuna`
- `💬 Sistema Social`
- `⚙️ Configuración`

Y los botones:
- `🔌 Conectar` / `🔌 Desconectar`
- `🔗 Probar` / `⚙️ Config` / `➕ Añadir Juego`
- `🎁 Regalos` / `🔔 Sonidos`
- `🎭 Simulador` / `💾 Perfiles` / `🔄 Respaldos`
- `🔧 TikTok API` / `🎬 Overlays`

> Estos NO son SVG/PNG — son **emojis Unicode**. En el port a React
> hay 2 opciones:
> 1. Mantener los emojis (cross-platform pero distinto rendering por OS).
> 2. Reemplazar por iconos lucide/heroicons con el mismo significado
>    (más consistente, pero pierde el "feel" original).
> **Decisión recomendada**: mantener emojis. La memoria dice "identidad
> visual fiel" y los emojis son parte del DNA visual.

---

## 5. Iconos auto-descargados (`gui/widgets/default_images.py`)

### 7 iconos de trigger
Se descargan al boot vía `ensure_trigger_icons(DATA_DIR/icons_triggers)`:

| Trigger | URL primaria (icons8) | Tint | Letra fallback |
|---------|----------------------|------|----------------|
| `like` | `filled-like.png` | `#ff4757` | `♥` |
| `share` | `share--v1.png` | `#2ed573` | `S` |
| `subscribe` | `star-filled.png` | `#ffa502` | `★` |
| `gift` | `gift--v1.png` | `#a55eea` | `G` |
| `follow` | `add-user-male--v1.png` | `#1e90ff` | `+` |
| `command` | `chat--v1.png` | `#a4b0be` | `>` |
| `like_milestone` | `goal--v1.png` | `#ff6b81` | `◎` |

Tamaño 128px, formato PNG.

Si la URL primaria falla, intenta con UXWing fallback URL, luego aplica
`tint_icon_file(path, color)` para colorear.

Si ambas URLs fallan: genera un PNG con `_draw_letter_icon`:
- 128x128, transparent.
- RoundedRect 16% radius.
- Gradient radial bg.
- Border 2.5px.
- Letra 45% del tamaño, centrada, bold.

### 6 iconos de categorías
| Categoría | URL | Tint | Letra |
|-----------|-----|------|-------|
| `entities` | `dragon--v1.png` | `#a55eea` | `D` |
| `items` | `sword--v1.png` | `#74b9ff` | `S` |
| `events` | `flash-on.png` | `#ffd32a` | `E` |
| `commands` | `flash-on.png` | `#ffd32a` | `C` |
| `valuables` | `diamond--v1.png` | `#7efff5` | `V` |
| `equipment` | `treasure-chest--v1.png` | `#ffa502` | `T` |

> En el port a React, cargar estos 13 PNG estáticamente (incluirlos en
> el bundle del Electron app — no descargar en runtime).

---

## 6. Stylesheet QSS — Tema "midnight" (default)

> ⚠️ **Solo se conserva `midnight` en el plan G**. Borrar todos los demás
> temas (cyberpunk, forest, sunset, ocean, light, sakura, hacker, dracula).

### Colores del tema midnight
- **Background app**: `qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 #1a1a2e, stop:1 #16213e)`.
- **GroupBox bg**: `rgba(30, 30, 50, 0.9)`.
- **GroupBox border**: `1px solid #3a3a5a`.
- **GroupBox title color**: `#7ed6df` (cyan).
- **Button bg**: `qlineargradient(x1:0, y1:0, x2:0, y2:1, stop:0 #4a69bd, stop:1 #3c528c)`.
- **Button hover**: `qlineargradient(stop:0 #6a89cc, stop:1 #4a69bd)`.
- **Button disabled**: bg `#2a2a4a`, color `#666`.
- **LineEdit/SpinBox/ComboBox**: bg `rgba(20, 20, 35, 0.95)`, border `#3a3a5a`,
  color `#fff`.
- **ListWidget**: bg `rgba(20, 20, 35, 0.8)`, border `#3a3a5a`, item selected `#4a69bd`.
- **TabWidget pane**: border `#3a3a5a`, bg `rgba(20, 20, 35, 0.8)`.
- **TabBar tab**: bg `rgba(30, 30, 50, 0.9)`, border `#3a3a5a`, color `#aaa`.
- **TabBar tab selected**: bg `#4a69bd`, color `white`.
- **TextEdit**: bg `rgba(10, 10, 20, 0.9)`, color `#7ed6df`.
- **Slider groove**: `#3a3a5a`, height 6px.
- **Slider handle**: `#7ed6df`, 18x18px, radius 9px.
- **CheckBox indicator**: 18x18, border 2px `#3a3a5a`, checked bg `#4a69bd`.
- **Label color**: `#ddd`.
- **Scrollbar**: bg `#1a1a2e`, handle `#4a69bd`, width 10px.

### Helpers de estilo (`gui/constants.py` funciones)

```python
card_style(selected=False)       # bg + border + radius
card_hover_style()               # hover state
input_style()                    # bg + border + radius + padding
input_focus_extra()              # solo cambio de border en focus
btn_primary_style(color=GREEN)   # gradient con color custom
btn_secondary_style()            # transparente con border sutil
btn_danger_style()               # rojo translúcido
header_gradient(accent_rgba)     # gradient horizontal accent → HEADER_RIGHT_COLOR
footer_style()                   # bg + border-top
scroll_style()                   # scroll area + scrollbar fina
```

---

## 7. Animaciones

### Splash progress bar
- 25ms tick interval (40 FPS).
- 1.5% incremento → ~1.7s hasta 100%.

### `AnimatedButton.pulse()`
- Duración 150ms.
- `QEasingCurve.OutCubic`.
- Geometry expansion ±2px en cada eje.
- Disparado en `mousePressEvent`.

### `AnimatedLabel.flash(color, duration=500)`
- Setea color de fondo durante 500ms y vuelve al estilo original.

### `NotificationWidget`
- 4 estilos con bg color: success / error / warning / info.
- Position: top-center del parent (10px desde el top).
- Auto-hide con `_timer` (`QTimer`) según duration param.
- Sin animación de fade — solo `setText` + `show()` + `hide()` cuando termina.

### `MainWindow._update_activity` / `_dim_activity`
- Cambia color del indicador a verde brillante.
- Vuelve a `#666` después de 2 segundos vía `QTimer.singleShot`.

### Theme switching
- Sin animación — instant via `setStyleSheet`.

---

## 8. Toasts y diálogos modales

### NotificationWidget
- Padding 12x20.
- border-radius 8px.
- Font-weight bold, font-size 13px.
- Estilos:
  - **success**: `rgba(46, 204, 113, 0.95)` (verde).
  - **error**: `rgba(231, 76, 60, 0.95)` (rojo).
  - **warning**: `rgba(243, 156, 18, 0.95)` (naranja).
  - **info**: `rgba(52, 152, 219, 0.95)` (azul).

### QMessageBox
- Sin tema custom — usa el del tema actual aplicado al setStyleSheet
  global.
- Iconos estándar: question, information, warning, critical.

### Diálogos custom
- Heredan estilos del theme via `setStyleSheet(gui_constants.CURRENT_STYLE)`.

---

## 9. Cards / botones / inputs (resumen visual)

### Card (de `card_style()`)
```
bg: rgba(255,255,255,0.07);
border: 1px solid rgba(255,255,255,0.10);
border-radius: 10px;
```

### Card seleccionada
```
bg: rgba(116,185,255,0.18);
border: 2px solid rgba(116,185,255,0.5);
border-radius: 10px;
```

### Botón primario (verde)
```
QPushButton {
  background: #27ae60;
  color: white;
  border: none;
  border-radius: 10px;
  padding: 8px 20px;
  font-weight: bold;
}
QPushButton:hover { background: #27ae60; opacity: 0.9; }
```

### Botón secundario
```
QPushButton {
  background: rgba(255,255,255,0.06);
  color: white;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 10px;
  padding: 8px 16px;
}
QPushButton:hover { background: rgba(255,255,255,0.12); }
```

### Botón danger
```
QPushButton {
  background: rgba(231,76,60,0.15);
  color: #e74c3c;
  border: 1px solid rgba(231,76,60,0.3);
  border-radius: 10px;
  padding: 8px 16px;
  font-weight: bold;
}
QPushButton:hover { background: rgba(231,76,60,0.3); }
```

### Input
```
background: rgba(0,0,0,0.25);
border: 1px solid rgba(255,255,255,0.08);
border-radius: 8px;
padding: 6px 12px;
color: white;
```

Focus: `border: 1px solid rgba(116,185,255,0.4);`

### Header gradient (de `header_gradient(accent_rgba)`)
```
background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
    stop:0 <accent_rgba>, stop:1 rgba(44,62,80,0.5));
```

Donde `accent_rgba` puede ser `rgba(52,73,94,0.7)` (profiles),
`rgba(155,89,182,0.4)` (simulator), `rgba(39,174,96,0.4)` (backups), etc.

### Footer
```
background: rgba(0,0,0,0.15);
border-top: 1px solid rgba(255,255,255,0.05);
```

---

## 10. Especificaciones para G1

Al portar a React (Tailwind + tokens), generar `tailwind.config.js` con
estos tokens:

```js
theme: {
  extend: {
    colors: {
      accent: { DEFAULT: '#f39c12', blue: '#74b9ff',
                green: '#27ae60', 'green-light': '#2ecc71',
                red: '#e74c3c', 'red-dark': '#c0392b',
                purple: '#9b59b6' },
      panel: { DEFAULT: 'rgba(0,0,0,0.2)' },
      card: {
        DEFAULT: 'rgba(255,255,255,0.07)',
        hover: 'rgba(255,255,255,0.12)',
        border: 'rgba(255,255,255,0.10)',
        'selected-bg': 'rgba(116,185,255,0.18)',
        'selected-border': 'rgba(116,185,255,0.5)',
      },
      input: {
        DEFAULT: 'rgba(0,0,0,0.25)',
        border: 'rgba(255,255,255,0.08)',
        'border-focus': 'rgba(116,185,255,0.4)',
      },
      muted: 'rgba(255,255,255,0.7)',
      hint: 'rgba(255,255,255,0.35)',
    },
    borderRadius: {
      card: '10px',
      panel: '12px',
      btn: '10px',
      'btn-sm': '8px',
      input: '8px',
    },
  },
}
```

Background app:
```css
background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
```

---

## 11. NO incluir en el port (los 8 temas a borrar)

`gui/themes.py` tiene 9 temas: solo **mantener `midnight`**.

Borrar:
- 💜 Cyberpunk
- 🌲 Forest
- 🌅 Sunset
- 🌊 Ocean
- ☀️ Light Mode
- 🌸 Sakura
- 💻 Hacker
- 🧛 Dracula

> El selector de temas en el sidebar (`theme_sel`) tampoco se porta. La
> sección `🎨` del sidebar queda eliminada.
