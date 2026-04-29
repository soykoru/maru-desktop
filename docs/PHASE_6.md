# Fase 6 — Optimización RAM/CPU

**Objetivo**: bajar el footprint de la app en runtime y a la vez instrumentar
todo lo necesario para medir y diagnosticar regresiones futuras.

## Optimizaciones aplicadas

### Renderer

#### Lazy routes con `React.lazy`
- `Dashboard` y `Connection` siguen **eager** (boot path crítico).
- Las otras 9 rutas (`Rules`, `Data`, `Social`, `Spotify`, `Ia`, `Overlays`,
  `Profiles`, `Logs`, `Settings`) se cargan on-demand con `Suspense + Spinner`.
- Resultado esperado en bundle inicial:

| Bundle | Antes | Ahora |
|---|---|---|
| Renderer eager (boot) | ~520 KB | ~340 KB |
| Cada ruta lazy | (incluida) | 30-90 KB on-demand |

#### Bundle optimizado en `electron.vite.config.ts`
- **Manual chunks** por dominio: `react-vendor`, `router`, `icons`,
  `state`, `cn`, `vendor`. El cache HTTP (file:// hash) se beneficia: si solo
  cambia un componente, la mayoría de chunks se reusan.
- **`drop: ['console', 'debugger']`** en producción (esbuild) — quita logs de
  debug del bundle final.
- `target: 'es2022'` en renderer — sin polyfills (Electron 33 usa
  Chromium 130, soporte completo).
- `cssMinify: true`, `legalComments: 'none'`, `reportCompressedSize: false`.
- `sourcemap: false` en prod → bundle final ~25% más liviano.

#### Selectores zustand granulares
- `Dashboard.tsx` consumía `s.tiktokFeed.slice(0, 8)` directo en el selector
  → cada llegada de evento creaba un array nuevo y forzaba re-render aunque
  los primeros 8 no hubieran cambiado. **Fix**: el selector ahora devuelve
  el feed completo y `useMemo` calcula el slice estable. Re-renders
  proporcionales solo a las visualizaciones reales.

#### Idle pause de polling (`lib/hooks.ts`)
- Hook `useDocumentVisible` que detecta `document.hidden` + focus/blur.
- Hook `usePollingInterval(tick, ms)` que **pausa el setInterval cuando la
  ventana no es visible** y dispara un catch-up al volver.
- Aplicado a:
  - **Dashboard** (`system.health` cada 5s)
  - **Spotify** (`spotify.status + now-playing` cada 5s)
  - **Logs** (`logs.tail` cada 2s)
  - **Settings → Sistema** (`system.metrics` cada 2s)
- Resultado: con la ventana minimizada o background → cero IPC, cero JSON,
  cero render del renderer. Útil sobre todo en streams largos donde MARU
  vive minimizada en bandeja.

### Sidecar

#### Thread pool reducido
- `games.py`: `max_workers` 4 → **2**. HTTP/RCON casi nunca tiene más de 1
  acción concurrente; 2 da headroom sin reservar threads ociosos.
- (Para referencia: el original tenía 50 workers en TTS — `tts_engine` está
  en core y mantiene su propia configuración; ese módulo se usa solo si TTS
  está activo, lazy-loaded.)

#### Event bus capeado
- `event_bus.py`: maxsize 1024 → **512**. En streams típicos vemos 20-50
  ev/s; 512 da 10-25 s de headroom antes de saturar. La política FIFO drop
  ya estaba: si se llena, descartamos el más viejo.

#### Métricas observables (`backend/metrics.py`)
Nuevo método RPC `system.metrics` que reporta cada 2 s:
- **rssMb** — Resident Set Size en MB. Usa `psutil` si está, fallback a
  `resource.getrusage` (Linux/Mac) o `psapi.dll` (Windows con ctypes).
- **cpuPercent** — % CPU promedio del proceso (0-100).
- **threadCount** — `threading.active_count()`.
- **busQueueSize** — backlog del EventBus (debería estar cerca de 0 casi siempre).
- **uptimeMs** — tiempo desde el boot del sidecar.
- **tracemallocEnabled** — true si `MARU_TRACEMALLOC=1`.
- **psutilAvailable** — true si la dep está.
- **topAlloc** — top 5 sitios de allocation (sólo si tracemalloc activo).

#### Profiling con tracemalloc
- Activable en cualquier dev session con `MARU_TRACEMALLOC=1`.
- Cero overhead si no se usa (`tracemalloc.start()` no se invoca).
- Las top allocations aparecen automáticamente en el panel "Sistema" de la app.

### UI de observabilidad
- Nueva tab **Settings → Sistema** con `<SystemMetricsCard />`:
  - 4 métricas grandes (RAM / CPU / Threads / Bus queue).
  - Uptime del sidecar.
  - Lista de top allocations cuando tracemalloc está activo.
  - Badges que indican si `psutil` está disponible o usa fallback.
  - Auto-refresh cada 2 s con idle pause.

## Verificación

- **35/35 tests** Python pasan (3 nuevos para `MetricsService`).
- Tipos consistentes (`SystemMetrics` en `@maru/shared`).
- IDLE polling: validable en dev con DevTools → tab Network → minimizar
  ventana → ver que las llamadas IPC se detienen.

## Baseline esperado (a medir post-build)

| Métrica | Original PyQt6 | Maru Desktop F6 |
|---|---|---|
| RAM (idle, sin TikTok conectado) | ~520 MB | ~180-220 MB |
| RAM (con TikTok activo) | ~640 MB | ~260-320 MB |
| CPU idle | 1-3% | <1% |
| CPU live (50 ev/s) | 8-12% | 4-7% |
| Bundle inicial renderer | n/a (PyQt) | ~340 KB |

Estos números son targets para validar empíricamente en F8 (QA).

## Decisiones tomadas en F6

1. **Polling con idle pause**, no WebSocket subscription para metrics.
   `system.metrics` es un poll de 2 s; convertirlo en push event ahorraría
   RTT pero complicaría el contrato sin beneficio real (la latencia no
   importa en métricas). Si en F8 vemos que el poll es caro, lo migramos.
2. **Manual chunks específicos**, no `splitVendorChunkPlugin` automático.
   Más control sobre qué se invalida cuando cambia una dep. `lucide-react`
   es ~75 KB tree-shaked y sale a un chunk dedicado.
3. **`useMemo` en lugar de `useShallow` de zustand**. Funciona igual sin
   agregar dep adicional, y el cálculo es trivial.
4. **`MARU_TRACEMALLOC=1` opt-in**, no default. Tracemalloc tiene overhead
   de 10-20% en allocations; sólo lo querés cuando estás cazando un leak.
5. **Mantener el sidecar liviano sin `psutil`**: dep opcional. Funcional
   sin ella usando APIs nativas (resource/psapi). En F7 `psutil` puede
   meterse al bundle PyInstaller si querés métricas más finas en prod.

## Pendiente para Fase 7

- Empaquetado real con PyInstaller (`--onedir`) y verificar el tamaño
  final del distributable.
- Smoke test: `pnpm release patch MARU_SKIP_PUBLISH=1` y validar que el
  installer se genera + arranca + las métricas aparecen.
- Code-signing certs (Windows + macOS) opcional.
