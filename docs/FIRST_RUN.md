# Primera prueba — MARU Desktop

Esta guía te lleva desde un repo recién clonado hasta la app funcionando
en pantalla, paso a paso. Si algo falla, cada paso te dice qué chequear.

---

## Paso 1 · Verificar entorno

Abrí una terminal en `C:\Users\User\Desktop\MARU PRO\maru-desktop\` y corré:

```bash
node --version          # debe ser 20.0.0 o mayor
pnpm --version          # debe ser 9.0.0 o mayor (10.x ideal)
python --version        # debe ser 3.10 o mayor
```

**Si falla alguno**:
- Node: descargá Node 20 LTS de https://nodejs.org y reinstalá.
- pnpm: `npm install -g pnpm`.
- Python: descargá 3.10+ de https://www.python.org. Marcá "Add Python to PATH".

---

## Paso 2 · Instalar dependencias

```bash
# Dependencias JavaScript (apps/desktop, packages/ui, packages/shared, etc.)
pnpm install
```

Tarda **2-4 minutos** la primera vez (descarga Electron 33, Vite, React, etc.).

```bash
# Dependencias Python del sidecar
cd apps/sidecar
python -m pip install -e ".[dev]"
cd ../..
```

Tarda **30-60 segundos**. Esto instala `websockets`, `pytest`, `pyinstaller`, `psutil`.

**Si falla `pip install -e .[dev]`** (typical en Windows con shells viejos):
```bash
python -m pip install -e ".[dev]"
```
(las comillas alrededor de `.[dev]` son la diferencia).

---

## Paso 3 · Health check del repo

```bash
pnpm quickcheck
```

Debe imprimir **`✓ Todo OK`** al final. Verifica:
- Estructura de archivos obligatoria (17 paths).
- 6 `package.json` válidos.
- Tests Python verdes (35 pasan).
- Sidecar arranca y emite `MARU_SIDECAR_READY <port>`.

**Si algún ítem falla**, lee el mensaje de error: te dice exactamente qué falta.

---

## Paso 4 · Configurar el bridge al `core/` original

El sidecar reusa `LiveChaosEngine_Refactored/core/` por importación. La
detección automática busca en `../../LiveChaosEngine/LiveChaosEngine_Refactored`.

**Si tu original está ahí, no hace falta hacer nada** (es el caso por
default en este desktop).

Para sobreescribir, copiá `.env.example` a `.env` y editá:
```
MARU_CORE_ROOT=C:\path\completo\a\LiveChaosEngine_Refactored
```

> ⚠️ Nota: Si el `core/` original NO está disponible, la app arranca igual,
> pero los servicios de `tiktok / spotify / ia / tts / overlays` quedan en
> modo "no configurado". Las páginas de **Reglas**, **Datos**, **Profiles**,
> **Logs**, **Settings** funcionan al 100% sin el core.

---

## Paso 5 · Levantar la app en modo dev

```bash
pnpm dev
```

Esto arranca **dos procesos en paralelo** vía Turborepo:
1. **Sidecar Python**: imprime `MARU_SIDECAR_READY 8770` (o un puerto similar).
2. **Electron + Vite**: abre la ventana frameless con la UI.

**La primera vez** Vite tarda ~5 s en compilar el renderer. Después de eso,
HMR es instantáneo en cambios.

### Lo que deberías ver

1. **Title bar custom** arriba: punto violeta + "MARU Live" + botones ─/▢/✕.
2. **Sidebar** a la izquierda con 11 ítems (Dashboard, Conexión, Reglas, Datos, Social, Spotify, IA, Overlays, Perfiles, Logs, Ajustes).
3. **Status bar** abajo: `sidecar ●` (verde), `rpc ●` (verde), `tiktok ○` (gris).
4. **Dashboard** con 4 stat cards (Espectadores / Likes / Diamantes / Shares) en 0.

### Si NO arranca

- **"sidecar not connected"**: el Python falló al arrancar. Mirá la
  terminal — debe imprimir `MARU_SIDECAR_READY <port>`. Si imprime un error
  de import, falta una dep (`pip install -e ".[dev]"` de nuevo).
- **Pantalla en blanco**: abrí DevTools con `MARU_DEVTOOLS=1 pnpm dev` y
  fijate qué dice la consola.
- **Puerto ocupado**: el puerto 8770 está en uso. El sidecar se reasigna
  automáticamente; reiniciá `pnpm dev`.

---

## Paso 6 · Tour de funcionalidad

Sin tener TikTok conectado podés probar **el 90% de las features**.

### 6.1 — Cambiar de tema
1. Click en **Ajustes** (sidebar abajo).
2. Tab **Apariencia** → segmented buttons: **Midnight / Aurora / Cyberpunk**.
3. Click en cada uno: la app cambia de paleta entera con transición suave.
4. Reiniciá la app: el tema persiste (localStorage).

### 6.2 — Crear una regla
1. Click en **Reglas** (sidebar).
2. Tab del juego (default Valheim).
3. Click **+ Nueva regla** arriba a la derecha.
4. En el editor de la derecha:
   - **Nombre**: "Spawn troll en gift rosa"
   - **Trigger** → **kind**: `gift`, **giftName**: `rosa`
   - **Acción** ya viene `spawn` con campos para entidad + cantidad
   - Llenalo: `Troll`, cantidad `1`
5. Click **Guardar** → debería aparecer toast verde "Regla guardada".
6. La regla queda en `apps/sidecar/runtime_data/data/rules_valheim.json`.
7. **Probá toggle**: click en el switch de la fila → cambia enabled.
8. **Probá reorder**: flechas ↑↓ en cada fila.
9. **Probá test**: botón Test (dry-run) → muestra info de la regla.
10. **Probá eliminar**: botón papelera → toast info "Regla eliminada".

### 6.3 — Catálogo de datos
1. Click en **Datos** (sidebar).
2. Click **+ Añadir**.
3. Llenar **Nombre visible**: "Troll Furioso", **Comando interno**: "Troll".
4. **Guardar** → aparece en la lista.
5. **Buscar**: escribir "troll" en el input → filtra server-side.
6. Click en una fila → editar inline.
7. **Exportar**: descarga `valheim_entities.json`.
8. **Importar**: levanta dialog de archivo, acepta el JSON exportado.

### 6.4 — Stream Profiles (snapshots)
1. Click en **Perfiles**.
2. Click **+ Guardar perfil actual**.
3. Nombre: "Test setup". Descripción opcional.
4. **Guardar** → aparece la card con SHA-256 truncado.
5. **Duplicar** lo crea con sufijo "(copia)".
6. **Exportar** → descarga `Test_setup.maru-profile.json` (JSON portable).
7. **Cargar** lo restaura (con confirm).

### 6.5 — Logs en vivo
1. Click en **Logs**.
2. Verás las últimas 500 líneas del sidecar.
3. **Filtros** por nivel (info/warning/error/debug).
4. **Buscar** texto → filtra cliente-side.
5. **Auto-scroll** al final + **Copiar** todo el contenido visible.
6. Las líneas vienen de `apps/sidecar/runtime_data/logs/sidecar.log`.

### 6.6 — Métricas del sistema
1. **Ajustes** → tab **Sistema**.
2. Verás 4 cards: **RAM / CPU / Threads / Bus queue**.
3. Refresca cada 2s automáticamente.
4. Si tenés `psutil` instalado (sí, viene en `[dev]`), aparece badge verde "psutil".
5. Para profiling de memoria: `MARU_TRACEMALLOC=1 pnpm dev` → aparece sección
   "Top allocations" con los 5 sitios que más memoria usan.

### 6.7 — Conectar TikTok (opcional, requiere `core/`)
1. Click en **Conexión**.
2. Ingresá tu @usuario en el input.
3. **Conectar** → toast "Conectando…".
4. Si el live está activo: status pasa a verde, eventos llegan al feed
   en tiempo real. Stats arriba se actualizan.

### 6.8 — Idle pause (validar la optimización)
1. Abrí DevTools en dev: `MARU_DEVTOOLS=1 pnpm dev`.
2. Tab **Network**.
3. Andá a Dashboard o Logs (que tienen polling).
4. Mirá las llamadas IPC cada 2-5s.
5. **Minimizá la ventana** → las llamadas se detienen.
6. **Restaurala** → vuelven con un catch-up inmediato.

---

## Paso 7 · Probar build local del sidecar (opcional)

Para validar que PyInstaller arma el binario correctamente:

```bash
pnpm build:sidecar
```

Tarda **30-90s** la primera vez. Al final imprime:
- Tamaño total del bundle.
- Smoke test arrancando el binario y esperando handshake.

Output queda en `apps/sidecar/dist/sidecar/sidecar.exe` (Windows).

---

## Paso 8 · Probar build local del desktop completo (opcional)

```bash
MARU_SKIP_PUBLISH=1 node scripts/release.mjs patch
```

Esto:
1. Bumpea `apps/desktop/package.json` de 0.1.0 → 0.1.1.
2. Builda el sidecar (PyInstaller).
3. Builda el desktop (electron-vite).
4. Empaqueta con electron-builder → instalador en `apps/desktop/release/`.
5. **NO publica** a GitHub (por el flag `MARU_SKIP_PUBLISH=1`).

> ⚠️ Tarda 5-10 minutos. Mac/Linux requieren config adicional. En Windows
> genera `MARU-Live-Setup-X.Y.Z.exe`.

---

## Troubleshooting rápido

| Síntoma | Causa probable | Fix |
|---|---|---|
| `pnpm: command not found` | pnpm no está | `npm install -g pnpm` |
| `python: command not found` | Python no en PATH | Reinstalá Python marcando "Add to PATH" |
| `sidecar not connected` | El Python crasheó al arrancar | Mirá la terminal: el error está ahí. Suele ser dep faltante |
| Pantalla blanca al abrir | Renderer falló | `MARU_DEVTOOLS=1 pnpm dev` y mirá la consola |
| `core no disponible` en Conexión | `LiveChaosEngine_Refactored/` no encontrado | Setear `MARU_CORE_ROOT` en `.env` |
| Botones de Spotify/IA dicen "no configurado" | Esperado sin `core/` | Conectar el bridge (paso 4) |
| Tests fallan | Algo se rompió | `cd apps/sidecar && python -m pytest -v` para ver qué |

---

## Lo que NO hace falta para esta primera prueba

- Conectar TikTok real (la app funciona casi entera sin él).
- Configurar Spotify (tab muestra "desconectado").
- Configurar IA (tab muestra "no configurado").
- Tener `GH_TOKEN` (solo para publicar releases).
- Firmar código (solo para producción real).

---

## Próximos pasos sugeridos

1. **Crear varias reglas** y un perfil completo. Verificá que el JSON
   guardado en `runtime_data/data/` tiene formato limpio.
2. **Cambiar entre los 3 temas** y revisar que todas las pantallas
   se ven bien en cada uno (los mockups en `docs/design/` son referencia).
3. **Build local** con `pnpm build:sidecar` para validar PyInstaller en
   tu máquina antes de pensar en releases.
4. **Cuando tengas todo OK**: F8 (QA + corte de cordón) compara MARU Desktop
   vs el original PyQt6 con un stream real.

---

## Reportar problemas

Si algo no funciona y no está en el troubleshooting:
1. `pnpm quickcheck` → dame el output completo.
2. Logs del sidecar: `apps/sidecar/runtime_data/logs/sidecar.log` (últimas 50 líneas).
3. DevTools console del renderer (si llegó a abrir).
