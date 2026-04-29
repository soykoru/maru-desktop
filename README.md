# MARU Live Desktop

Reescritura profesional de **LiveChaos Engine / MARU Live** sobre arquitectura
moderna inspirada en KoruGames Desktop:

- **Electron + React 19 + Vite + Tailwind + zustand** para la UI.
- **Python sidecar** (JSON-RPC sobre WebSocket) que reusa la lógica
  original de TikTok / juegos / IA / TTS / Spotify intacta. Esto garantiza
  que la conexión con TikTok y los juegos no se rompe.
- **pnpm + Turborepo** como monorepo.
- **electron-updater + GitHub Releases** para auto-update.
- **PyInstaller** + **electron-builder** para empaquetado.

El proyecto original (`LiveChaosEngine_Refactored/`) **no se toca**. Esta
carpeta es paralela y reusa el código de `core/` por importación.

## Estructura

```
maru-desktop/
├── apps/
│   ├── desktop/          Electron main + preload + renderer (React)
│   │   ├── src/main/        sidecar manager, RPC client, hardening, updater
│   │   ├── src/preload/     contextBridge → maruApi
│   │   ├── src/renderer/    React 19 + Tailwind + 11 rutas
│   │   ├── electron.vite.config.ts
│   │   └── electron-builder.yml
│   └── sidecar/          Paquete Python `maru_sidecar`
│       ├── maru_sidecar/    server, rpc, backend/*
│       ├── tests/           35 tests
│       ├── sidecar.spec     PyInstaller --onedir
│       └── build.py
├── packages/
│   ├── shared/           Contrato RPC tipado (TS)
│   ├── ui/               Design system (16 primitivas + 3 temas)
│   └── tsconfig/         Presets TS
├── scripts/
│   ├── quickcheck.mjs    Health check
│   ├── release.mjs       Bump + build + publish
│   └── release.bat
├── docs/
│   ├── PHASE_0..7.md     Documentación por fase
│   ├── RELEASE.md        Guía de release
│   ├── FIRST_RUN.md      Cómo probar la app
│   └── design/           Mockups HTML navegables
├── CHANGELOG.md
└── README.md
```

## Requisitos

- **Node 20+** y **pnpm 9+** (`npm install -g pnpm`)
- **Python 3.10+**
- (Opcional) **PyInstaller** y **psutil** para builds y métricas más finas
- (Opcional para release) **`GH_TOKEN`** con scope `repo` y certificados de
  firma para Windows/macOS

## Setup rápido

```bash
# desde la carpeta del repo
pnpm install
cd apps/sidecar
python -m pip install -e ".[dev]"
cd ../..

# verificar salud del repo
pnpm quickcheck
```

## Scripts disponibles

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Levanta sidecar + desktop en paralelo (Turborepo) |
| `pnpm dev:desktop` | Solo Electron + Vite (con HMR) |
| `pnpm dev:sidecar` | Solo el sidecar Python |
| `pnpm test` | Corre `pytest` del sidecar |
| `pnpm typecheck` | TS de todo el monorepo |
| `pnpm quickcheck` | Health check completo (estructura + tests + handshake) |
| `pnpm build` | Build de todo (sidecar + desktop) |
| `pnpm release patch\|minor\|major` | Bump + build + publish a GitHub Releases |

## Estado por fase

| Fase | Estado | Resumen |
|---|---|---|
| F0 — monorepo + handshake | ✅ | pnpm + Turborepo, sidecar emite `MARU_SIDECAR_READY <port>` |
| F1 — RPC + reuso `core/` + AppShell | ✅ | 50+ métodos RPC, EventBus, frameless window, sidebar, statusbar |
| F2 — Design system + UX | ✅ | 3 temas, 16 primitivas, toasts, mockups en `docs/design/` |
| F3 — (absorbido en F1) | ⏭️ | AppShell + routing ya estaban hechos |
| F4 — pestañas reales | ✅ | Adapters reales para todos los dominios, 11 páginas funcionales |
| F5 — auto-update + telemetría + hardening | ✅ | electron-updater, banner global, hardening prod, telemetría opt-in |
| F6 — RAM/CPU + observabilidad | ✅ | Lazy routes, manual chunks, idle pause, `system.metrics` |
| F7 — empaquetado + primer prueba | ✅ | PyInstaller spec, build script, quickcheck, FIRST_RUN.md |
| F8 — Cierre v1.0.0 | ✅ | Asistente migración, Welcome page, paridad documentada, manual de uso |

## 🎉 v1.0.0 — proyecto cerrado

40/40 tests verdes · `pnpm quickcheck` verde · 12 páginas funcionales · 3 temas · 50+ métodos RPC · 10 documentos en `docs/`

## Probar la app por primera vez

Ver **[`docs/FIRST_RUN.md`](docs/FIRST_RUN.md)** — guía paso a paso.

## Documentación

- [`docs/PHASE_0.md`](docs/PHASE_0.md) … [`PHASE_7.md`](docs/PHASE_7.md) — detalle de cada fase.
- [`docs/RELEASE.md`](docs/RELEASE.md) — pipeline de release a GitHub.
- [`docs/FIRST_RUN.md`](docs/FIRST_RUN.md) — primera vez ejecutando la app.
- [`docs/design/index.html`](docs/design/index.html) — mockups navegables del producto en los 3 temas.
- [`CHANGELOG.md`](CHANGELOG.md) — registro versionado.
