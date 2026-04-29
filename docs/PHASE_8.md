# Fase 8 — Cierre · MARU Desktop v1.0.0

**Objetivo**: dejar el producto cerrado como reemplazo total del MARU
original — paridad funcional documentada, asistente de migración para
mover la data del original sin pérdida, y documentación de usuario final.

## Lo que quedó hecho

### Asistente de migración
- **`backend/migrations.py`** — `MigrationService` con `status` (dry-run) y
  `apply` (atómico).
- Detección automática del original en 3 paths estándar + override via
  `originalPath` o `MARU_CORE_ROOT`.
- 8 patrones de archivos migrables (`rules_*.json`, `data_*.json`,
  `config.json`, `games.json`, `profiles.json`, `social_*.json`, `gifts.json`).
- **Backup automático full** del runtime antes de pisar nada.
- **Validación JSON** por archivo: los corruptos van a `errors`, no
  contaminan el destino.
- **Escritura atómica**: `.migrating` tmp → `os.replace` final.
- **5 tests** del migrator: detección, dry-run, apply, archivo corrupto,
  paths explícitos.

### Página Welcome
- **`routes/Welcome.tsx`** — primera pantalla al instalación nueva.
- Auto-redirect en boot si nunca vio la welcome (`localStorage.maru.welcomeSeen`).
- Lista los archivos del original con tamaños y badge "ya existe".
- Botón único "Importar N archivos" → backup + copia + report con toast.
- Card lateral "Lo nuevo" con 7 features destacadas.
- Botón "Más tarde" / "Empezar desde cero" si no hay original o no querés migrar.

### Métricas en Dashboard
- Polling unificado (`system.health` + `system.metrics` en una sola pasada
  cada 5s) → menos IPC.
- Card Sistema ahora tiene **4 mini-tiles** (RAM/CPU/Threads/Bus) además
  de los datos generales.
- La tab **Settings → Sistema** sigue existiendo para vista detallada.

### Bump v1.0.0 + paridad
- Versiones consistentes: monorepo / desktop / sidecar / `__init__.py` /
  `pyproject.toml` → `1.0.0`.
- Sidebar muestra "v1.0.0".
- **`docs/PARITY.md`** — tabla completa de paridad funcional original ↔
  Desktop, mejoras estructurales, equivalencias 1:1 y lo no portado
  (con justificación).

### Documentación de usuario final
- **`docs/USAGE.md`** — manual del streamer: instalación, primer uso,
  flujo diario, atajos, troubleshooting.

### Verificación
- **40/40 tests** Python pasan (5 nuevos del migrator).
- `pnpm quickcheck` verde: estructura, packages, tests, handshake.
- Sidebar reporta v1.0.0.
- Welcome se enseña al primer arranque y luego redirige al Dashboard.

## Decisiones tomadas en F8

1. **Welcome auto-redirect via hash**: usamos `localStorage` flag y un
   componente `InitialRedirect` que apunta el hash una sola vez. Si el
   user navega manualmente a `/welcome` después, también funciona.
2. **Backup pre-migración full**, no por scope: queremos máxima seguridad
   en la operación que pisa más cosas. Si algo sale mal, restaurar el
   backup full devuelve todo el runtime al estado anterior.
3. **El migrator NO toca el original**: sólo lee. Permite probar
   migraciones repetidas sin destruir la fuente.
4. **JSON inválidos van a `errors`, no a `applied`**: si tu original tiene
   un JSON corrupto, no contamina el destino. La UI puede mostrarte qué
   archivos saltaron.
5. **Dashboard métricas comparten polling**: `system.health` y
   `system.metrics` se piden con `Promise.all` en cada tick → 1 round-trip
   en lugar de 2.
6. **v1.0.0 en todos lados**: consistencia para que el AutoUpdater detecte
   correctamente upgrades a v1.0.1 cuando publiques el primer fix.

## Estado final del proyecto

| Aspecto | Estado |
|---|---|
| Fases completadas | 8/8 (F3 absorbido en F1) |
| Tests Python | 40/40 verdes |
| Quickcheck | ✓ Todo OK |
| Métodos RPC en contrato | 50+ |
| Páginas funcionales | 12 (Welcome + Dashboard + 10 dominios) |
| Temas operativos | 3 (Midnight, Aurora, Cyberpunk) |
| Componentes UI | 16 primitivas |
| Documentación | 9 archivos en `docs/` |
| Versión | **1.0.0** |

## Para hacer la primera prueba real

Ver **`docs/FIRST_RUN.md`** (8 pasos numerados) y **`docs/USAGE.md`**
(manual de uso real).

## Lo que queda fuera del alcance del proyecto

- **Code-signing certs** Windows/macOS: opcional, requiere comprar
  certificados. Sin ellos, el instalador funciona pero muestra
  SmartScreen warning. Documentado en `docs/RELEASE.md`.
- **CI/CD GitHub Actions**: el `release.mjs` corre local. Migrarlo a
  GH Actions es 1 día de trabajo cuando lo necesites.
- **Telemetría real**: `@sentry/electron` no está instalado por default.
  Si lo querés activo, `pnpm add -D @sentry/electron` en `apps/desktop`
  y seteás `MARU_SENTRY_DSN`.
- **i18n**: la app está 100% en español. Internacionalización es F9 si
  alguna vez lo necesitás.
