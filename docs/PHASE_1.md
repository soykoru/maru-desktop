# Fase 1 — RPC + reuso de core + AppShell visual

**Objetivo**: cubrir todo el contrato JSON-RPC entre Electron y el sidecar
Python, reusar `core/` del refactor original sin tocarlo, y subir
drásticamente el listón visual con un AppShell profesional.

## Mejoras estructurales sobre el original

| Tema | Original | Nuevo |
|---|---|---|
| Marco de UI | PyQt6 monolítico (`gui.py` ~14 k líneas) | Electron + React 19 + Tailwind con design system |
| Comunicación con lógica | Acoplada a la UI (mismo proceso, mismas señales) | JSON-RPC sobre WebSocket → cualquier futuro frontend (web, móvil) puede hablarle al mismo sidecar |
| Backups | Copia con timestamp y acumulación | Atómico (`os.replace`), hash SHA-256, retención dual (edad + conteo), índice JSON, locks por scope |
| Settings | Read/write directo a JSON | Lectura/escritura atómica + validación, separación de scopes |
| Push events | Señales PyQt acopladas | EventBus thread→asyncio desacoplado, broadcast a todos los clientes WS |
| Title bar | Nativa Windows | Custom frameless con drag region + botones min/max/close |
| Sidebar | Pestañas QTabWidget | Sidebar colapsable con iconos lucide y rutas |
| Status | No había feedback global | StatusBar inferior con sidecar/rpc/tiktok + métricas live |
| Estado UI | Variables sueltas en QWidget | `zustand` con slices por dominio (connection / tiktok / ui) |

## Nuevo contrato RPC (`@maru/shared`)

Métodos por dominio (40+):
- `system.*` — ping, health, shutdown
- `tiktok.*` — connect, disconnect, status
- `rules.*` — list, upsert, delete, toggle, test
- `games.*` — list, configure, test, spawn, give-item, trigger-event
- `social.*` — command, config get/set
- `spotify.*` — status, now-playing, play-request, skip, toggle-playback
- `ia.*` — status, ask, config.set
- `tts.*` — speak, stop, queue-sizes
- `overlays.*` — list, update, test-event
- `settings.*` + `backups.*` — get, set, list, create, restore, delete

Push events:
- `sidecar:ready`, `sidecar:log`
- `tiktok:status`, `tiktok:event`, `tiktok:stats`, `tiktok:error`
- `rules:fired`
- `spotify:now-playing`
- `social:update`
- `window:state` (custom title bar)

## Sidecar (`apps/sidecar`)

Nuevos módulos:
- `runtime.py` — paths runtime separados del core original (RUNTIME_DIR,
  DATA_DIR, BACKUPS_DIR, etc). Auto-resolución dev vs frozen (PyInstaller).
  Override con `MARU_RUNTIME_DIR`.
- `core_bridge.py` — añade `LiveChaosEngine_Refactored/` a `sys.path` y
  parchea `core.paths` para usar las rutas nuevas. Lazy import. Override con
  `MARU_CORE_ROOT`.
- `event_bus.py` — `EventBus.publish` thread-safe → asyncio queue.
  Política FIFO con presión: drop del más viejo si se satura.
- `backend/` — adapters por dominio:
  - `system.py` — ping/health/shutdown.
  - `tiktok.py` — wrap del `TikTokWorker` PyQt sin importar Qt en sidecar
    (lazy import; conecta señales al EventBus).
  - `settings.py` — settings + backups façade.
  - `backups.py` — `BackupService` profesional.
  - `stubs.py` — implementaciones mínimas para que el contrato esté
    100% cubierto en F1; F4 las conecta al `core/` original.

`server.py` ahora tiene `pump_from_bus(bus)` que drena el EventBus y
broadcastea cada evento como notification a los clientes.

## Renderer (`apps/desktop/src/renderer`)

Nuevos componentes:
- `TitleBar.tsx` — frameless con drag region, botones nativos.
- `Sidebar.tsx` — colapsable, 8 rutas + ajustes, iconos lucide.
- `StatusBar.tsx` — estado de sidecar/rpc/tiktok + stats live.
- `AppShell.tsx` — layout principal.
- `PageHeader.tsx`, `StatCard.tsx` — primitivas reutilizables.

Rutas:
- `/` Dashboard — 4 stat cards (viewers, likes, diamantes, shares),
  feed de eventos recientes, panel de sistema con uptime.
- `/connection` Conexión TikTok — input @usuario, conectar/desconectar,
  feed en vivo con scroll virtualizado (max 200 eventos en memoria).
- 7 placeholders para resto de pestañas (cumplen el routing y se conectan
  en F4).

Store global con slices:
- `connection-slice` — sidecar/rpc status, last ping.
- `tiktok-slice` — status, username, stats, feed circular.
- `ui-slice` — sidebar collapsed, theme.

Wiring:
- `event-wire.ts` — registra todos los push events una vez al montar `<App>`.

## Tests

```
14 passed in 0.25s
```

- `test_registry.py` (3) — dispatch, echo, method-not-found.
- `test_server_handshake.py` (1) — roundtrip ping real por WS.
- `test_backups.py` (5) — create/list, retención, restore, delete,
  scope inválido.
- `test_event_bus.py` (2) — publish desde main + desde otro thread.
- `test_registry_expanded.py` (3) — todos los métodos del contrato
  están registrados, health responde con uptime, games.list devuelve los 4.

## Cómo verificar end-to-end

```bash
cd apps/sidecar && python -m pytest -q
# 14 passed

# Handshake
python -m maru_sidecar --rpc-port 0 --ready-stdout
# stdout: "MARU_SIDECAR_READY <port>"

# UI (requiere pnpm install)
cd ../.. && pnpm install
pnpm dev
# Ventana frameless con sidebar colapsable, dashboard, status bar live.
# Probar: Conexión → ingresar @usuario → conectar (requiere core con TikTokLive).
```

## Decisiones tomadas en F1

1. **`core/` se importa, no se copia**: bridge con `MARU_CORE_ROOT` env. Si
   el original cambia, el sidecar lo lee. F8 considerará si copiarlo.
2. **PyQt en el sidecar es lazy**: solo se carga si `tiktok.connect` se llama.
   Si nunca se conecta TikTok, el sidecar no carga Qt → bajo uso de RAM.
3. **EventBus FIFO con drop policy**: 1024 eventos bufer; si se satura se
   descarta el más viejo (mejor que bloquear el caller).
4. **Backups con scopes**: rules / data / social / config / full. Cada
   archivo solo está en su scope correspondiente; full hace match con `*.json`.
5. **Frameless window**: máximo control visual sobre title bar. `WebkitAppRegion: drag`
   en el contenedor con `no-drag` en los botones.
6. **HashRouter** (no BrowserRouter) — mejor con `file://` cuando se sirve
   estático en producción.

## Pendiente para Fase 2

- Mockups visuales completos (Figma o HTML estático) para acordar estilo
  final antes de poblar las 7 pestañas restantes.
- Stream Profiles, Logs, animaciones de microinteracciones.
- Toasts globales + sistema de notificaciones.
