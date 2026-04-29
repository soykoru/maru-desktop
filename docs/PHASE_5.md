# Fase 5 — Auto-update + telemetría + hardening

**Objetivo**: dejar el producto listo para publicar y mantener — actualización
automática desde GitHub Releases, hardening de producción y telemetría
opcional.

## Lo que quedó hecho

### AutoUpdater (`src/main/auto-updater.ts`)
- `electron-updater` configurado con GitHub Releases (público o privado).
- Check inmediato + cada 6 horas en producción.
- Auto-download en background, **install diferido** — el usuario decide
  cuándo reiniciar.
- Estados tipados (`UpdateState`) que el renderer consume:
  `idle / disabled / checking / available / not-available / downloading /
  ready / error`.
- API: `init()`, `checkNow()`, `installAndRestart()`, `disable()`, `getState()`.
- En dev (`!app.isPackaged`) o con `MARU_DISABLE_UPDATER=1` queda en
  `phase: 'disabled'` sin tocar nada.

### Configuración de empaquetado (`apps/desktop/electron-builder.yml`)
- AppId `lat.korugames.maru`.
- Targets:
  - **Windows**: NSIS x64 con instalador customizable.
  - **macOS**: DMG arm64+x64.
  - **Linux**: AppImage.
- `extraResources` empaqueta el binario PyInstaller del sidecar en
  `resources/sidecar/` (lo genera F7).
- `publish: github` con `releaseType: release` y `publishAutoUpdate: true`.

### Hardening de producción (`src/main/hardening.ts`)
- DevTools bloqueadas: cierre automático + intercepción de F12,
  Ctrl/Cmd+Shift+I/J, Ctrl+U, Ctrl+R en `before-input-event`.
- `will-navigate` bloqueado para URLs externas → abren en browser via
  `shell.openExternal`.
- `setWindowOpenHandler` siempre `deny` (mismo patrón).
- Permisos de webContents (camera/mic/geolocation) negados por default.
- `will-attach-webview` bloqueado.
- Activable manualmente en dev con `MARU_FORCE_HARDENING=1` (útil para
  validar antes de release).

### Telemetría opt-in (`src/main/telemetry.ts`)
- Por default desactivada. El usuario la activa en Settings → Privacidad.
- Sentry como **dep opcional** — se carga dinámicamente solo si:
  - El flag está activo (`localStorage.maru.telemetry = '1'`), y
  - `@sentry/electron` está instalado, y
  - `MARU_SENTRY_DSN` está seteado.
- Sanitización: nunca envía contexto de TikTok/Spotify, ni datos del usuario.
- API: `initTelemetry(version)`, `captureException(err)`, `addBreadcrumb(msg, data?)`.
- Hooks instalados en `process.uncaughtException` y `unhandledRejection`.

### IPC + preload del updater
- Canales: `updater:state` (push), `updater:check-now`, `updater:install-and-restart`,
  `updater:disable`.
- Preload expone `window.maruApi.updater.*` con tipos.
- `event-wire.ts` cablea el push event al store global.

### UI de actualizaciones
- **Banner global** en `<AppShell>`:
  - Modo `ready`: barra accent con versión + botón "Reiniciar e instalar"
    + dismiss.
  - Modo `downloading`: barra info delgada con porcentaje + velocidad +
    progress bar.
- **Sección Settings → Avanzado → Actualizaciones**:
  - Switch auto-actualización (deshabilita el updater on-demand).
  - Estado del updater (con badge de color por phase).
  - Botón "Buscar ahora" (manual check).
  - Card destacado cuando hay versión `ready`.
- **Settings → Privacidad**:
  - Switch telemetría con persistencia en localStorage.
  - Toast "reiniciá la app" tras toggle.

### Release pipeline
- `scripts/release.mjs` — script Node con tres pasos: bump → build sidecar →
  build electron → publish.
- `scripts/release.bat` — wrapper Windows.
- `pnpm release patch|minor|major|x.y.z` desde root.
- Validaciones: árbol git limpio, `GH_TOKEN` presente.
- Flag `MARU_SKIP_PUBLISH=1` para smoke tests sin publicar.
- Documentación completa en `docs/RELEASE.md`.

## Verificación

- **32/32 tests** Python siguen pasando.
- Tipos del contrato updater/main/preload/store consistentes.
- Hardening probable manualmente con `MARU_FORCE_HARDENING=1`.

## Decisiones tomadas en F5

1. **Install diferido por defecto**: descargamos en background pero NO
   reiniciamos sin acción del usuario. Streamer no quiere que se le caiga
   la app a mitad de live.
2. **Errores con toast persistente** ya estaban desde F2 — el banner del
   updater es informativo, no bloqueante.
3. **Telemetría como dep opcional**: `@sentry/electron` no entra en el
   bundle por default → ahorro de ~1 MB en cada instalador. Se carga sólo
   si el user la activa y la dep está.
4. **Hardening sólo en `app.isPackaged`**: dev workflow intacto, prod
   blindado. Override con `MARU_FORCE_HARDENING=1` para QA.
5. **`disable()` no es persistente**: si el user desactiva auto-update,
   reiniciar la app la vuelve a habilitar. Justificación: si tu nueva
   versión arregla un bug crítico, no queremos que un user con auto-update
   desactivado quede atrás indefinidamente. F8 puede repensar esto.
6. **Bump por script, no manual**: `release.mjs` controla el bump y el
   publish atómicamente — imposible publicar sin bumpear.

## Pendiente para Fase 6

- Optimización RAM/CPU (lazy routes con `React.lazy`, profile del sidecar
  con `tracemalloc`, reducir workers ThreadPoolExecutor).
- Mediciones de baseline antes y después.
- Reemplazo de `QWebEngineView` (no aplica acá — no usamos PyQt en sidecar
  ya).
