# Fase 0 — Monorepo + handshake sidecar

**Objetivo**: dejar listo el esqueleto del proyecto y el wiring mínimo
Electron ↔ Python con un método RPC `ping` end-to-end.

## Lo que quedó hecho

### Infraestructura del monorepo
- `package.json` raíz con workspaces `apps/*` y `packages/*` (pnpm 10.33).
- `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.prettierrc.json`,
  `.editorconfig`, `.gitignore`, `.npmrc`.

### `packages/tsconfig`
Presets reutilizables: `base`, `react-library`, `electron-main`, `electron-renderer`,
`node-app`. Todas las apps/packages extienden de aquí.

### `packages/shared`
Contrato JSON-RPC compartido (TS):
- `RpcMethodMap` — Fase 0 solo `ping`. Fase 1+ irá agregando grupos.
- `RpcPushEventMap` — eventos push del sidecar al main.
- `RpcRequest/Response/Notification` con tipado estricto.
- `RPC_ERROR_CODES`, `SIDECAR_READY_MARKER`, `APP_NAME`.

### `packages/ui`
Design system inicial:
- Preset Tailwind con tokens MARU (paleta Midnight con CSS vars para que las
  variantes Cyberpunk/etc. de F3 sean cambiar `data-theme`).
- `globals.css` con base + scrollbar consistente.
- Componentes: `Button` (4 variantes × 3 sizes), `Card / CardHeader / CardTitle / CardBody`,
  `StatusDot` (verde/amarillo pulsante/rojo).
- Helper `cn()` (clsx + tailwind-merge).

### `apps/desktop` (Electron + React 19 + Vite)
- `electron.vite.config.ts` con builds separados main/preload/renderer + alias `@`.
- `tsconfig.json` (renderer+preload) y `tsconfig.node.json` (main+config files).
- `tailwind.config.cjs` extendiendo el preset de `@maru/ui`.
- **Main process** (`src/main/`):
  - `runtime-config.ts` — paths y flags resueltos una vez.
  - `sidecar.ts` — `SidecarManager` con spawn, regex de ready, restart con
    backoff (3 intentos / 30s), shutdown SIGTERM→SIGKILL.
  - `rpc-client.ts` — JSON-RPC 2.0 sobre WebSocket: id correlation, timeouts
    (10s), push events vía EventEmitter, reconexión.
  - `ipc.ts` — handlers `rpc:call` y `app:get-version`. Reenvía `connected/disconnected`
    al renderer.
  - `index.ts` — ventana 1320×840, hardening básico (contextIsolation, sin
    nodeIntegration, openExternal en URLs http), boot del sidecar al `whenReady`,
    cleanup en `before-quit`.
- **Preload** (`src/preload/index.ts`): `contextBridge.exposeInMainWorld('maruApi', ...)`
  con `rpc.call`, `on(channel)`, `app.getVersion`. Tipado.
- **Renderer** (`src/renderer/`):
  - `globals.d.ts` con `Window.maruApi`.
  - `lib/app-state.ts` — store zustand (sidecarStatus, rpcStatus, lastPingMs).
  - `lib/rpc.ts` — wrapper tipado.
  - `App.tsx` — pantalla de Fase 0: cards de estado + botón "Probar ping".

### `apps/sidecar` (Python)
- `pyproject.toml` con `websockets>=12`, deps de dev (pytest/mypy/ruff).
- Paquete `maru_sidecar/`:
  - `logger.py` — logger central (no `print` en core; el handshake es la única
    excepción y vive en `__main__`).
  - `rpc/registry.py` — `MethodRegistry` con dispatch sync/async, `RpcError`,
    `RpcErrorCode` 1:1 con TS, método `ping` (devuelve pongAt + protocolVersion + echo).
  - `server.py` — `RpcServer` JSON-RPC 2.0 sobre `websockets`: parse, validate,
    dispatch, responder ok/error, broadcast (para push events de F1).
  - `__main__.py` — CLI con flags `--rpc-port`, `--log-level`, `--ready-stdout`.
    Imprime `MARU_SIDECAR_READY <port>` por stdout limpio cuando está listo.
- Tests:
  - `test_registry.py` — dispatch ok, echo, método inexistente → METHOD_NOT_FOUND.
  - `test_server_handshake.py` — levanta server en puerto libre, conecta WS,
    manda ping, verifica respuesta.

## Verificación

```bash
# Sidecar tests
cd apps/sidecar
python -m pytest tests -q
# 4 passed in 0.11s ✅

# Handshake real
python -m maru_sidecar --rpc-port 0 --ready-stdout
# stdout: "MARU_SIDECAR_READY 63722" ✅
```

## Decisiones arquitectónicas tomadas

1. **Marker de ready específico de MARU**: `MARU_SIDECAR_READY` (no
   `KORUGAMES_SIDECAR_READY`) para evitar colisión si los dos sidecars
   convivieran en una misma máquina.
2. **Puerto default 8770** (KoruGames usa 8766/8765). Distinto rango → sin choque.
3. **Toda comunicación renderer↔sidecar va por main** (IPC + WS). El renderer
   nunca abre WS directo. CSP en `index.html` lo refuerza.
4. **Shared types como source of truth**: el contrato vive en
   `packages/shared/src/rpc/`. Cuando F1 agregue métodos, primero se actualiza
   TS y luego se implementa en Python.
5. **Sin `print` en módulos**: regla heredada del refactor de MARU. Excepción
   única documentada: `__main__` para el handshake.

## Pendiente para Fase 1

- Importar `core/` del repo original como dependencia editable del sidecar.
- Crear `backend/` con adapters: tiktok, rules, games, social, spotify, ia,
  overlays, settings, tts.
- Definir push events: `tiktok:event`, `tiktok:gift`, `tiktok:like`, `social:update`.
- Validación de params con Pydantic (o TypedDict + jsonschema generado desde TS).
- Test de integración: spawn sidecar real desde un cliente JS y golpear cada grupo.
