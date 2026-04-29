# Fase 7 — Empaquetado + primera prueba

**Objetivo**: dejar el sidecar empaquetable como binario standalone, el
proyecto pulido para compartir, y una guía paso-a-paso de primera prueba.

## Lo que quedó hecho

### Empaquetado del sidecar
- **`apps/sidecar/sidecar.spec`** — spec PyInstaller con:
  - `--onedir` (más rápido que onefile, no extrae cada arranque).
  - 22 hidden imports explícitos (websockets + maru_sidecar + backends).
  - 10 excludes (tkinter, matplotlib, PIL, test, doctest, setuptools…).
  - `console=True` — stdout libre para el handshake `MARU_SIDECAR_READY`.
  - Sin UPX (compatible con AVs corporativos).
- **`apps/sidecar/build.py`** — script Python con 6 pasos:
  1. Verifica que PyInstaller esté instalado.
  2. Limpia `build/` y `dist/sidecar/`.
  3. Corre PyInstaller con `--noconfirm --clean`.
  4. Verifica que el binario exista.
  5. Reporta tamaño total del bundle.
  6. **Smoke test**: arranca el binario, espera el handshake, lo mata.
- **`pnpm build:sidecar`** ya cableado al script.

### Pulido cross-cutting
- **`.env.example`** documentando todas las variables relevantes:
  - `MARU_CORE_ROOT`, `MARU_RUNTIME_DIR`, `MARU_PYTHON`, `MARU_TRACEMALLOC`
  - `MARU_DEVTOOLS`, `MARU_FORCE_HARDENING`, `MARU_DISABLE_UPDATER`
  - `MARU_SENTRY_DSN`, `GH_TOKEN`, `MARU_SKIP_PUBLISH`
- **`scripts/quickcheck.mjs`** — health check del repo:
  - 17 paths obligatorios.
  - 6 `package.json` válidos.
  - `pytest` verde.
  - Smoke test del sidecar (handshake real).
- **`pnpm quickcheck`** + `pnpm test` + `pnpm test:sidecar` añadidos al root.
- **README maestro** rehecho con tabla de scripts, estado por fase y links
  a documentación.
- **`requirements-dev.txt`** sumó `pyinstaller>=6.10` y `psutil>=5.9`.
- Versión root bumpeada a **0.7.0**.

### Guía de primera prueba (`docs/FIRST_RUN.md`)
Documento autocontenido con 8 pasos numerados:
1. Verificar entorno (node/pnpm/python).
2. Instalar deps JS + Python.
3. Health check (`pnpm quickcheck`).
4. Configurar bridge al `core/` original.
5. `pnpm dev` con descripción de lo que se debe ver.
6. Tour de funcionalidad: temas, reglas, datos, profiles, logs, métricas, TikTok, idle pause.
7. Build local del sidecar.
8. Build local del desktop completo (skip publish).

Incluye **troubleshooting** con 7 síntomas comunes + fixes, y lista de
"lo que NO hace falta" para tranquilidad del primer usuario.

## Verificación

`pnpm quickcheck` pasa **todos los chequeos**:
- 17/17 paths obligatorios presentes.
- 6/6 packages válidos.
- 35/35 tests Python.
- Sidecar emite `MARU_SIDECAR_READY <port>` correctamente.

## Decisiones tomadas en F7

1. **`--onedir` vs `--onefile`**: onedir es ~3× más rápido al arrancar
   porque no extrae cada vez. El cliente Electron tampoco se beneficia
   visiblemente del onefile (la carpeta vive en `resources/sidecar/`).
2. **Sin UPX**: comprime ~30% el binario pero es la causa #1 de falsos
   positivos en antivirus en 2024+. No vale la pena.
3. **`console=True`**: necesario para que el handshake llegue por stdout.
   En prod no se ve porque Electron consume el stdio del child process.
4. **Hidden imports explícitos en lugar de `--collect-submodules`**: lista
   pequeña y mantenible es mejor que un wildcard que arrastra todo el
   paquete (incluyendo tests). Si en F8 falta algo, se agrega.
5. **`quickcheck.mjs` sin deps externas**: usa solo Node stdlib + spawn
   `python`. Funciona tras un `pnpm install` limpio sin necesitar nada más.
6. **README como single source of truth**: cualquier persona que clone
   el repo entiende todo desde el README. FIRST_RUN.md es para el ritual
   de probarlo realmente; los `PHASE_*.md` son contexto histórico.

## Próximo paso (F8)

Comparar empíricamente MARU Desktop vs el original PyQt6 con un stream real:
- RAM idle / live.
- CPU idle / live.
- Latencia de eventos TikTok → acción en juego.
- Verificar que las 11 pestañas funcionan al 100% en los 3 temas.
- Migrar el `data/*.json` real del original a `runtime_data/data/` y
  validar paridad funcional.
- Si todo verde, hacer el primer release v1.0.0 a GitHub.
