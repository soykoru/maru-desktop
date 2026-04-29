# Fase 2 — Design system + UX foundations

**Objetivo**: definir y materializar el lenguaje visual completo de MARU
Desktop antes de poblar las 7 pestañas restantes (F4). Esta fase no toca
sidecar — es 100% de presentación, microinteracciones y catálogo de
primitivas.

## Lo que quedó hecho

### Tokens visuales (3 temas operativos)
`packages/ui/styles/globals.css` y `tailwind.preset.cjs` definen:

- **Surfaces**: `bg-base / bg-surface / bg-elevated / bg-overlay`
- **Text**: `fg / fg-muted / fg-subtle`
- **Brand**: `accent / accent-hover`
- **Semánticos**: `success / warning / danger / info`
- **Líneas**: `border / border-strong`
- **Sombras**: `shadow-sm / shadow-md / shadow-lg / shadow-glow` (las 3
  primeras se redefinen por tema; el glow es siempre del accent)
- **Radii**: `sm / md / lg / xl / 2xl`
- **Motion**: `dur-fast (120ms) / dur-base (200ms) / dur-slow (320ms)` con
  ease `cubic-bezier(0.22, 1, 0.36, 1)`

Tres temas listos para usar:
1. **Midnight** (default) — violeta sobre azul oscuro, alta legibilidad.
2. **Aurora** — claro premium con violeta–púrpura, ideal para edición de día.
3. **Cyberpunk** — neón cian sobre negro azulado, look "high-energy stream".

Transición suave automática entre temas (sólo color, no layout) y
`prefers-reduced-motion` respetado globalmente.

### Primitivas UI nuevas en `@maru/ui`
- `Button` (4 variantes × 3 sizes)
- `Card / CardHeader / CardTitle / CardBody`
- `Input / Label / TextArea` con prefix/suffix/invalid
- `Select` con chevron + estados focus/invalid
- `Switch` con label + description y 2 sizes
- `Tabs / TabsList / TabsTrigger / TabsContent` (controlado o uncontrolled)
- `Tooltip` (4 sides)
- `Badge` (6 variantes)
- `Skeleton` con shimmer
- `Empty` (icon + title + description + action)
- `Spinner` (3 sizes)
- `IconButton` (4 variantes × 3 sizes)
- `Kbd` para shortcuts
- `Dialog` con portal, escape, overlay y focus trap
- `Toaster` + `toast.{success,error,warning,info}` global

### Sistema de toasts
- Store singleton (`ToastStore`) con `subscribe`/`push`/`dismiss`/`clear`.
- `<Toaster />` portala al body desde el AppShell.
- Auto-dismiss 4s para success/info/warning; **error sin auto-dismiss** por
  default (forzando reconocimiento del usuario).
- API ergonómica: `toast.success(title, description?)`.

### Selector de tema con persistencia
- `useAppStore` agrega `theme` y `hydrateTheme()`.
- Persiste en `localStorage` clave `maru.theme`.
- `<ThemeSelect />` reusable (segmented buttons con iconos).
- Aplicado en `/settings → Apariencia`.

### Microinteracciones
Tailwind keyframes + utilidades:
- `animate-fade-in` (4px translateY)
- `animate-slide-up` (12px) — usado por toasts
- `animate-slide-down` — para dropdowns futuros
- `animate-scale-in` — usado por Tooltip y Dialog
- `animate-shimmer` — usado por Skeleton
- `animate-pulse-soft` — para badges "EN VIVO"

### Páginas refrescadas
- **Dashboard**: badge "EN VIVO" pulsante (Tooltip + animate-pulse-soft),
  Empty state cuando no hay eventos, Skeleton mientras carga health.
- **Conexión**: Input pulido con Label, Badge variante por tipo de evento,
  Tooltip + IconButton para limpiar feed, Empty state, toasts en éxito/error.
- **Settings** (nueva): Tabs (Apariencia / Notificaciones / Avanzado /
  Privacidad), ThemeSelect, Switches con descripción.

### Mockups HTML navegables
Site estático en `docs/design/` para revisar el lenguaje visual sin
instalar nada — abrir `docs/design/index.html` en cualquier browser.

| Página | Archivo |
|---|---|
| Index | `index.html` |
| Dashboard | `dashboard.html` |
| Conexión | `connection.html` |
| Reglas | `rules.html` |
| Datos | `data.html` |
| Social | `social.html` |
| Spotify | `spotify.html` |
| IA | `ia.html` |
| Overlays | `overlays.html` |
| Stream Profiles | `profiles.html` |
| Logs | `logs.html` |
| Settings | `settings.html` |
| Catálogo Components | `components.html` |

Cada mockup:
- Levanta el shell completo (TitleBar custom + Sidebar + StatusBar).
- Switch de tema arriba a la derecha (persiste en `localStorage` key
  `maru-mockup-theme`).
- Usa CSS plano (sin Tailwind) con tokens espejo de `@maru/ui`.

## Verificaciones

- **14/14 tests** Python siguen verdes (no se tocó sidecar en F2).
- Smoke tests visuales: abrir `docs/design/index.html` y navegar por todas
  las pantallas en los 3 temas.

## Decisiones tomadas en F2

1. **CSS vars como source of truth**: temas se intercambian con
   `data-theme` en el `<html>`. Cero re-render en JS, solo cambio de variables.
2. **Toaster global**: store + portal en lugar de `<ToastProvider>`. Más
   simple de usar (`toast.success(...)` desde cualquier código async) y sin
   coste de Context Provider.
3. **Mockups en HTML estático**: replicables sin servidor, sin build, sin
   dependencias. CSS plano con `rgb(from var(--x) r g b / .15)` (sintaxis
   moderna ya soportada por Chromium ≥ 119, que es exactamente lo que
   carga Electron 33).
4. **Error toasts persistentes**: el original no avisaba bien los errores;
   ahora cualquier fallo de RPC/conexión queda visible hasta que el usuario
   lo cierra.
5. **Reduce motion respetado**: `@media (prefers-reduced-motion: reduce)`
   anula animaciones. Importante para sesiones largas de stream.

## Próximo paso (F3 / F4)

F2 dejó la **base completa**: paleta, primitivas, motion, toasts y mockups
de las 11 pantallas. F3 (originalmente "AppShell + routing") ya está
hecho desde F1, así que el siguiente trabajo real es **F4 — migración
pestaña por pestaña**:
1. Reglas (drag-and-drop, multi-acción, modo aleatorio).
2. Datos por juego (CRUD, búsqueda, import/export).
3. Social (ranking, comandos, narraciones).
4. Spotify, IA, Overlays, Profiles, Logs.
