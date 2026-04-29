# MARU Desktop — Limpieza pre-G1

> Producido en G0.11 · 2026-04-27.
>
> Antes de empezar G1 hay que **borrar todo lo inventado en F0-F8** y
> **revertir el v1.0.0 prematuro**. Este documento es el checklist
> exacto con archivos y líneas a tocar.
>
> **NO ejecutar todavía** — esperar a que el usuario diga "vamos con G1".
> Cuando lo diga, esta limpieza es lo PRIMERO de G1.

---

## Resumen

| Categoría | Items | Riesgo |
|-----------|------:|--------|
| Temas inventados (Aurora + Cyberpunk) | 5 archivos | Bajo — tokens CSS aislados |
| Welcome page con hero | 1 archivo + 4 referencias | Bajo |
| Simulator inline en /connection | 1 import + 1 render | Bajo — `Simulator.tsx` se mantiene como diálogo modal en G11 |
| Donations page mock | 1 archivo + 1 ruta | Medio — la versión real llega en G3 |
| Página TTS dedicada | 1 archivo + 1 ruta | Medio — TTS solo en sidebar + voices_dialog |
| Versión v1.0.0 prematura | 4 archivos package.json | Bajo |
| Routes no contempladas en MARU original | 5 routes a revisar | Medio |
| Componente ThemeSelect | 1 archivo + 1 import | Bajo |
| Sidebar con navegación por rutas (vs MARU sin tabs) | revisión arquitectura | **ALTO** — decisión arquitectónica G1 |

---

## 1. Temas inventados (Aurora + Cyberpunk)

> MARU original tiene 9 temas hardcoded en `gui/themes.py`. **El plan G
> solo conserva `midnight`**. En el repo nuevo solo hay 3 (midnight,
> aurora, cyberpunk) — borrar los 2 inventados.

### Archivos a editar

#### `apps/desktop/src/renderer/lib/store/ui-slice.ts`
- Línea 3: `export type ThemeId = 'midnight' | 'aurora' | 'cyberpunk';`
  → Reemplazar por `export type ThemeId = 'midnight';`
- Línea 10: condición `if (v === 'midnight' || v === 'aurora' || v === 'cyberpunk')`
  → `if (v === 'midnight')`
- Considerar **eliminar el slice entero**: si solo hay 1 tema, no hace
  falta `setTheme` ni `hydrateTheme`. Mantener solo `sidebarCollapsed` /
  `toggleSidebar`. El tema queda hardcoded en el HTML root.

#### `apps/desktop/src/renderer/components/ThemeSelect.tsx`
- **BORRAR archivo entero** (38+ líneas). No hay selector de tema
  en MARU original más allá del combo del sidebar (que también se elimina
  en G1 — un solo tema no necesita selector).

#### `apps/desktop/src/renderer/routes/Settings.tsx`
- Línea 19: `import { ThemeSelect } from '../components/ThemeSelect.js';` → BORRAR.
- Línea 120: `<ThemeSelect />` → BORRAR (junto con su contenedor de "Apariencia" si queda vacío).

#### `packages/ui/styles/globals.css`
- Líneas **52-72** (bloque `[data-theme='aurora']`) → BORRAR.
- Líneas **74-95** (bloque `[data-theme='cyberpunk']`) → BORRAR.
- Línea 12-49: bloque `[data-theme='midnight']` → CONSERVAR como base.
- **Comentario de la línea 4** del preset:
  `tailwind.preset.cjs:4 → "Tres temas: midnight, aurora, cyberpunk"` →
  cambiar a `"Tema único: midnight"`.

#### `apps/desktop/src/renderer/index.html`
- Línea 2: `<html lang="es" data-theme="midnight">` → conservar tal cual.
  (Ya está bien.)

### Validación post-limpieza
- `grep -ri "aurora\|cyberpunk" apps/desktop packages/ui` → **0 hits**.
- App arranca con tema midnight aplicado.
- Settings sin sección de "Apariencia" (o vacía).

---

## 2. Welcome page con hero gradient

> El original NO tiene welcome screen. La app abre directo a su layout
> principal después del splash.

### Archivos a editar

#### `apps/desktop/src/renderer/routes/Welcome.tsx`
- **BORRAR archivo entero**.

#### `apps/desktop/src/renderer/App.tsx`
- Línea 4: `import { Welcome, isWelcomeSeen } from './routes/Welcome.js';` → BORRAR.
- Línea con `useState`: `const [initialPath] = useState<string>(() => (isWelcomeSeen() ? '/' : '/welcome'));` → BORRAR.
- Línea con `<Route path="/welcome" element={<Welcome />} />` → BORRAR.
- Línea `<Route path="*" element={<Navigate to={initialPath} replace />} />`
  → cambiar `initialPath` por `"/"`.

#### `apps/desktop/src/renderer/components/Sidebar.tsx`
- Si tiene un link al `/welcome` → BORRAR.

#### LocalStorage
- Key `'maru.welcomeSeen'` se vuelve obsoleta. No es crítico borrarla;
  un comment en el código (`// removed in G1`) basta.

### Validación post-limpieza
- `grep -ri "welcome" apps/desktop/src` → **0 hits relevantes**
  (puede quedar el string "Bienvenido" en mensajes UI, lo cual es OK).
- App abre directo al dashboard, sin pantalla de welcome.

---

## 3. Simulator inline en /connection

> El simulator del MARU original es **una ventana modal** abierta desde
> el botón "🎭 Simulador" del sidebar (Ctrl+Shift+S). NO está embebido
> en una página de conexión.
>
> **El componente `Simulator.tsx` se conserva** — se reusa como diálogo
> modal en G11.

### Archivos a editar

#### `apps/desktop/src/renderer/routes/Connection.tsx`
- Línea 20: `import { Simulator } from '../components/Simulator.js';` → BORRAR.
- Línea 193: `<Simulator />` → BORRAR (con su contenedor).

#### `apps/desktop/src/renderer/components/Simulator.tsx`
- **CONSERVAR el archivo**, pero cuando se haga G11 hay que rediseñarlo
  como modal completo (replicando `SimulatorDialog` del original con
  galería de gifts, presets, burst, etc.).
- Por ahora, solo **dejar de renderizarlo** desde Connection.

### Validación
- `/connection` no muestra simulator embebido.
- Componente `Simulator` queda como dead code temporal hasta G11
  (G6 podría llamarlo desde un atajo o lo dejamos para G11).

---

## 4. Donations page mock

> El original tiene `gifts_dialog.py` (galería completa con CRUD) abierto
> desde el botón "🎁 Regalos" del sidebar. **No es una ruta dedicada**,
> es un diálogo modal.
>
> La versión real (CRUD + 415 PNGs + selector reusable) llega en **G3**.

### Archivos a editar

#### `apps/desktop/src/renderer/routes/Donations.tsx`
- **CONSERVAR temporalmente** pero anotar `// TODO G3: Reemplazar por
  GiftsDialog modal según MARU original`.
- Alternativa más limpia: **borrar archivo y ruta** ahora, agregarla en
  G3 directo como modal.

#### `apps/desktop/src/renderer/App.tsx`
- Línea con `<Route path="/donations" element={<L><Donations /></L>} />`
  → si decidimos borrar Donations.tsx, borrar también esta línea.

#### `apps/desktop/src/renderer/components/Sidebar.tsx`
- Si tiene link a `/donations` → eliminar o renombrar a botón que abre
  modal (post G3).

### Decisión recomendada para G1
- **Borrar `Donations.tsx`** y su ruta + link sidebar.
- En G3 se crea `GiftsDialog.tsx` como modal abierto desde sidebar
  (siguiendo MARU original).

---

## 5. Página TTS dedicada

> MARU original NO tiene página TTS. El TTS está en:
> 1. **Sidebar GroupBox "🔊 Texto a Voz"** (volumen, voz, prueba, voces button).
> 2. **`voices_dialog.py`** abierto desde el botón "👤 Voces" del sidebar.

### Archivos a editar

#### `apps/desktop/src/renderer/routes/Tts.tsx`
- **BORRAR archivo entero** (168 líneas).

#### `apps/desktop/src/renderer/App.tsx`
- Línea: `<Route path="/tts" element={<L><Tts /></L>} />` → BORRAR.
- Import de Tts → BORRAR.

#### `apps/desktop/src/renderer/components/Sidebar.tsx`
- Link a `/tts` → BORRAR.

### Reemplazo en G9
- TTS GroupBox dentro del sidebar (al lado de "TikTok Live" y "Perfil de Juego").
- VoicesDialog modal para gestión de voces por user.

---

## 6. Versión v1.0.0 prematura → v0.5.0-alpha

### Archivos a editar (4 package.json)

#### `package.json` (root)
- Línea 3: `"version": "1.0.0",` → `"version": "0.5.0-alpha",`

#### `apps/desktop/package.json`
- Buscar `"version": "1.0.0"` → `"version": "0.5.0-alpha"`.

#### `apps/sidecar/package.json` (si existe)
- Buscar `"version"` → `"version": "0.5.0-alpha"`.

#### `packages/ui/package.json`
- Buscar `"version"` → `"version": "0.5.0-alpha"`.

#### `packages/shared/package.json`
- Buscar `"version"` → `"version": "0.5.0-alpha"`.

### `CHANGELOG.md` — entrada honesta nueva al inicio

Insertar al inicio del archivo:

```markdown
## [0.5.0-alpha] — 2026-04-27

### Notice
**Reverted from v1.0.0**: the previous v1.0.0 release was prematurely
tagged. The infrastructure (sidecar, JSON-RPC, autoupdater, packaging,
backups) was solid, but the UI lacked many features from the original
MARU Live (415 gift gallery, multi-action rules, full social system,
3-channel TTS, etc.). The real v1.0.0 will follow the **Plan G**
(G1-G14) which ports each system to 100% parity with the original.

See: [`docs/audit/MARU_PLAN_G_FINAL.md`](docs/audit/MARU_PLAN_G_FINAL.md)
for the full roadmap.

### Audit complete (G0)
- 75 Python files audited (~26.500 lines)
- 16 dialogs documented
- 5 mixins + 14 widgets + 1 controller documented
- 10 core modules documented
- 15 JSON schemas extracted
- ~2.873 images cataloged with cross-check
- 343 features mapped to Phase G in `MARU_FEATURE_MATRIX.md`

### Pre-G1 cleanup
- Removed Aurora and Cyberpunk themes (only midnight remains)
- Removed Welcome page with hero gradient
- Removed inline simulator from /connection
- Removed Donations mock (will be GiftsDialog modal in G3)
- Removed dedicated TTS page (TTS is sidebar + voices_dialog only)

### What stays (infrastructure F0-F8 solid)
- pnpm + Turborepo monorepo
- Electron 33 + React 19 + Vite + Tailwind + zustand
- Python sidecar with JSON-RPC over WebSocket
- Bridge to original `core/` without modification
- BackupService atomic writes
- AutoUpdater
- Hardening + metrics
- 40 Python tests green
```

---

## 7. Routes a revisar (decisión arquitectónica)

> **PROBLEMA GORDO**: el repo nuevo tiene **navegación por rutas**
> (`/connection, /donations, /rules, /data, /social, /spotify, /ia,
> /tts, /overlays, /profiles, /logs, /settings`).
>
> **MARU original NO tiene rutas** — es una **ventana ÚNICA** con:
> - Sidebar izquierdo (310px fijo).
> - Centro: tabs de reglas + categorías dinámicas por juego.
> - Derecho: stats + log (380px fijo).
>
> Botones del sidebar abren **diálogos modales** (no rutas).

### Decisión propuesta para G1

#### Opción A — Replicar 1:1 ventana única (RECOMENDADO)
- **Eliminar HashRouter completo**.
- App.tsx renderiza `<MainLayout>` con 3 columnas fijas.
- Sidebar con botones que abren **modales** (no navegan).
- Tabs internos en columna central (como QTabWidget).

#### Opción B — Mantener rutas (NO recomendado)
- Romper paridad con el original.
- Pero permite URLs profundas, mejor para web hipotético.

> **Recomendación**: **Opción A**. La regla "MARU original = única
> referencia válida" obliga a esto. Confirmar con el usuario antes de
> ejecutar.

### Si Opción A — Routes a borrar y reemplazar por modales

| Route actual | Reemplazo en plan G |
|--------------|---------------------|
| `/` (Dashboard) | sidebar + center tabs + log (G1 layout principal) |
| `/welcome` | borrado |
| `/connection` | "🎮 Perfil de Juego" GroupBox sidebar + modales (G4) |
| `/donations` | botón sidebar → GiftsDialog modal (G3) |
| `/rules` | center tab "📋 Reglas" + RuleDialog modal (G6) |
| `/data` | center tabs dinámicos por categoría + DataDialog modal (G5) |
| `/social` | sidebar GroupBox + SocialConfigDialog modal (G7) |
| `/spotify` | tab dentro de SocialConfigDialog (G14) |
| `/ia` | tab dentro de SocialConfigDialog (G8) |
| `/tts` | sidebar GroupBox + VoicesDialog modal (G9) |
| `/overlays` | botón sidebar → OverlaysManager modal (G13) |
| `/profiles` | botón sidebar → StreamProfilesDialog modal (G10) |
| `/logs` | columna derecha siempre visible (G11) |
| `/settings` | botón sidebar → settings modal o quitar |

---

## 8. Sidebar con rutas vs sidebar con secciones (impacto de Opción A)

### `apps/desktop/src/renderer/components/Sidebar.tsx`
- Rediseñar como **sidebar de MARU original** con 7 GroupBoxes:
  1. 🎵 TikTok Live (status, likes, user input, conectar btn).
  2. 🎮 Perfil de Juego (selector + Probar + Config + Añadir).
  3. 🔊 Texto a Voz (toggle, voice combo, volumen, prueba, Voces btn, radios per-perfil/global).
  4. 🔮 Fortuna (toggle, gift selector, voice, volumen, Probar btn).
  5. 💬 Sistema Social (toggle, Configurar btn, Minijuegos btn).
  6. ⚙️ Configuración:
     - 🎁 Regalos / 🔔 Sonidos (botones grid 2x).
     - 🎭 Simulador.
     - 💾 Perfiles.
     - 🔄 Respaldos.
     - 🔧 TikTok API.
     - 🎬 Overlays.
- Logo MaruLive arriba (100px) + subtítulo "Chaos Engine v8.5".
- ScrollArea con scrollbar fina 6px (porque las secciones pueden
  crecer más que la pantalla).

### `apps/desktop/src/renderer/components/AppShell.tsx`
- Reemplazar por **MainLayout** con 3 columnas fijas:
  - Left: 310px (Sidebar).
  - Center: stretch (TabPanel con tab "📋 Reglas" + dynamic tabs).
  - Right: 380px (StatsPanel + HealthWidget + LogPanel).

---

## 9. Componentes a evaluar (no borrar todavía)

| Componente actual | Status para G+ |
|-------------------|----------------|
| `AppShell.tsx` | reemplazar por MainLayout |
| `Sidebar.tsx` | rediseñar (G1) con 7 GroupBoxes |
| `PageHeader.tsx` | borrar (no hay rutas con header) |
| `StatCard.tsx` | usar en columna derecha (stats) |
| `StatusBar.tsx` | mantener para SystemHealth (G11) |
| `SystemMetricsCard.tsx` | adaptar a SystemHealthWidget (G11) |
| `ThemeSelect.tsx` | **borrar** (decision G1) |
| `UpdateBanner.tsx` | mantener (autoupdater es infra F0-F8) |
| `Simulator.tsx` | conservar para G11 (rediseñar como SimulatorDialog modal) |

---

## 10. Limpieza adicional detectada

### `apps/desktop/src/renderer/routes/Dashboard.tsx`
- Revisar: si es solo placeholder o contenido inventado, evaluar
  si se reemplaza por el contenido real del MainLayout en G1.

### `apps/desktop/src/renderer/routes/Settings.tsx`
- Sin ThemeSelect queda casi vacía.
- Decision G1: convertir en modal de settings global o eliminar.

---

## Order de ejecución sugerido

```
1. Borrar themes Aurora + Cyberpunk (sección 1)
   → tokens CSS aislados, riesgo bajo, deps mínimas

2. Borrar Welcome page (sección 2)
   → independiente, riesgo bajo

3. Quitar Simulator inline de /connection (sección 3)
   → mantener componente

4. Decidir con usuario: Opción A (sin rutas) o Opción B (con rutas)

   --- Si Opción A ---
5. Borrar /donations + /tts + /welcome routes (secciones 4 + 5)
6. Rediseñar AppShell → MainLayout con 3 columnas (G1 será trabajo principal)
7. Rediseñar Sidebar con 7 GroupBoxes
8. Convertir resto de routes en modales (G3-G13 progresivamente)

   --- Si Opción B (no recomendada) ---
   Mantener routes pero borrar las páginas inventadas y reemplazarlas
   por wrappers a los modales en G3-G13.

9. Revertir versiones a 0.5.0-alpha (sección 6)
10. Update CHANGELOG.md con entry honesta
11. Commit: "G0 audit complete + pre-G1 cleanup"
```

---

## Validación final del cleanup (antes de empezar G1)

- [ ] `grep -ri "aurora\|cyberpunk" apps packages` → 0 hits.
- [ ] `grep -ri "welcome" apps/desktop/src` → 0 hits relevantes.
- [ ] `grep -rn "Simulator" routes/Connection.tsx` → 0 hits.
- [ ] `routes/Tts.tsx`, `routes/Welcome.tsx`, `components/ThemeSelect.tsx` → no existen.
- [ ] `package.json` (4) → `"version": "0.5.0-alpha"`.
- [ ] `CHANGELOG.md` → primera entry es 0.5.0-alpha con notice de revert.
- [ ] `pnpm typecheck` → verde (sin errores TS por imports rotos).
- [ ] `pnpm dev` → app arranca, muestra (lo que quede del) layout actual.
- [ ] **Decisión Opción A vs B documentada en commit message.**

---

## Estimación de esfuerzo

| Paso | Esfuerzo |
|------|----------|
| Borrar 2 temas + ThemeSelect | ~30 min |
| Borrar Welcome + ajustar App.tsx | ~15 min |
| Quitar Simulator inline | ~5 min |
| Borrar Donations + Tts mock | ~10 min |
| Revertir versiones + CHANGELOG | ~10 min |
| **Si Opción A**: rediseño AppShell + Sidebar | ~3-5 días (parte de G1) |

**Total cleanup pre-G1 puro** (sin redesign): **~1 hora de trabajo**.

**Total con rediseño Opción A**: **3-5 días** (que en realidad ES la
fase G1 entera).

---

## Compromiso pre-G1

> Esta limpieza se ejecuta como **paso 0 de G1** apenas el usuario
> confirme arranque. NO se mezcla con feature work — primero borrar lo
> inventado, después portar features de la matriz.
>
> El commit de cleanup queda separado del commit de features para que
> el git log sea legible: "pre-G1 cleanup" → "G1 visual identity tokens"
> → "G1 sidebar with 7 GroupBoxes" → ...
