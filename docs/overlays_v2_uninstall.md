# Sistema de Overlays v2 — Cómo desinstalarlo

El sistema fue diseñado **explícitamente reversible**. Para volver MARU
al estado pre-overlays sin tocar nada más, hacé lo siguiente:

## 1. Sidecar (Python)

Borrar el archivo del relay:

```
apps/sidecar/maru_sidecar/backend/overlays_relay.py
```

En `apps/sidecar/maru_sidecar/rpc/registry.py`, buscar las **3 marcas**
`MARU-OVERLAYS-INTEGRATION` y borrar:

- `MARU-OVERLAYS-INTEGRATION (1/3)` — bloque del `import`.
- `MARU-OVERLAYS-INTEGRATION (2/3)` — la línea `overlays_svc = OverlaysRelayService()`.
- `MARU-OVERLAYS-INTEGRATION (3/3)` — todo el bloque de `reg.register("overlays.*")` + `reg.overlays_svc = ...`.

En `apps/sidecar/maru_sidecar/__main__.py`, buscar la marca
`MARU-OVERLAYS-INTEGRATION (1/1 en __main__)` y borrar el bloque
`overlays_svc = getattr(...)` + `install(loop)`.

(Opcional) Borrar el archivo de identity local:

```
%APPDATA%/MARU Live/data/overlays_identity.json
```

## 2. Renderer (Electron + React)

Borrar la carpeta entera (todo el código nuevo vive ahí, aislado):

```
apps/desktop/src/renderer/components/overlays/
```

En `apps/desktop/src/renderer/components/ModalRoot.tsx`, buscar las **2
marcas** `MARU-OVERLAYS-INTEGRATION` y borrar:

- `MARU-OVERLAYS-INTEGRATION (1/2 en ModalRoot)` — el bloque `lazy()`.
- `MARU-OVERLAYS-INTEGRATION (2/2 en ModalRoot)` — el `case 'overlays':`.

En `apps/desktop/src/renderer/components/Sidebar.tsx`, buscar la marca
`MARU-OVERLAYS-INTEGRATION (1/1 en Sidebar)` y borrar el `<Button>`. El
import `Tv` de `lucide-react` también se puede quitar.

En `apps/desktop/src/renderer/lib/store/ui-slice.ts`, quitar la línea
`| 'overlays'` del enum `ActiveModal`.

## 3. Tipos compartidos (opcional)

En `packages/shared/src/types/index.ts` y
`packages/shared/src/rpc/methods.ts` quedan los tipos
`OverlaysListResult`, `OverlaysIdentity`, `OverlaysMethods`, etc. No
hace falta borrarlos — sin uso, sólo son código muerto. Si querés
purga total: borrar las definiciones y los imports.

## 4. Backend Cloudflare (NO necesario)

El Worker `maru-overlays.soykoru07.workers.dev` y el dominio
`overlays.korugames.lat` siguen funcionando aunque MARU no los use.
Costo $0/mes. Si querés removerlo del todo:

```bash
cd maru-overlays
npx wrangler delete --name maru-overlays
```

## 5. Validación post-desinstalación

```bash
# Sidecar arranca limpio
cd apps/sidecar
python -c "from maru_sidecar.rpc.registry import build_default_registry; build_default_registry(); print('OK')"

# Renderer compila limpio
cd apps/desktop
pnpm typecheck

# Buscar referencias residuales
grep -rn "MARU-OVERLAYS-INTEGRATION" apps/
grep -rn "overlays_relay\|OverlaysRelayService\|components/overlays" apps/
```

Esos `grep` deben volver vacíos.
