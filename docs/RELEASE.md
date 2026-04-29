# Release flow — MARU Desktop

## Requisitos

1. **Repo en GitHub** (privado o público) configurado en `electron-builder.yml`
   bajo `publish.owner` / `publish.repo`.
2. **`GH_TOKEN`** con permiso `repo` en ese repo:
   - Settings → Developer settings → Personal access tokens → "Fine-grained" o
     classic con scope `repo`.
   - Guardalo en `.env` local (NO commitearlo) o expórtalo como variable de
     entorno antes de cada release.
3. **Sidecar empaquetado**: el script asume que `pnpm --filter @maru/sidecar build`
   genera `apps/sidecar/dist/sidecar/` (PyInstaller `--onedir`). El detalle
   queda definido en F7.
4. (Opcional) **Firma de código**:
   - Windows: certificado SignTool (`CSC_LINK` + `CSC_KEY_PASSWORD`).
   - macOS: certificado Developer ID (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
     `APPLE_TEAM_ID`).
   Si no hay certificados, `electron-builder` produce builds sin firmar; el
   updater igual funciona pero Windows muestra SmartScreen warning.

## Comandos

```bash
# Bump patch (1.2.3 → 1.2.4) + build + publish
GH_TOKEN=ghp_xxx node scripts/release.mjs patch

# Minor / major
GH_TOKEN=ghp_xxx node scripts/release.mjs minor
GH_TOKEN=ghp_xxx node scripts/release.mjs major

# Versión exacta
GH_TOKEN=ghp_xxx node scripts/release.mjs 1.2.3

# Build local sin publicar (smoke test antes del release real)
MARU_SKIP_PUBLISH=1 node scripts/release.mjs patch
```

En Windows con `cmd`:
```cmd
set GH_TOKEN=ghp_xxx
scripts\release.bat patch
```

## Qué hace el script

1. Verifica que el árbol git esté limpio (si hay repo).
2. Bumpea `apps/desktop/package.json` con la regla pedida.
3. `pnpm --filter @maru/sidecar build` → genera el binario PyInstaller.
4. `pnpm --filter @maru/desktop build` → builda main + preload + renderer.
5. `electron-builder --publish always` → empaqueta y sube a GitHub Releases.

## Auto-update en clientes ya instalados

- Cuando publicás, `electron-builder` genera `latest.yml` (Windows),
  `latest-mac.yml` y `latest-linux.yml` en el release.
- Cada cliente con la app instalada checa esos `latest.yml` cada **6 horas**
  (configurado en `auto-updater.ts`) y al boot.
- Si hay nueva versión:
  1. Descarga en background.
  2. Cuando termina, muestra banner azul arriba con "Reiniciar e instalar".
  3. El usuario decide cuándo reiniciar (o se aplica al próximo `quit`).

## Troubleshooting

- **"Cannot find module '@sentry/electron'"** al boot: la dep es opcional.
  Si activaste telemetría sin instalarla, desactiva el flag.
- **Update falla con 404**: el `latest.yml` no se publicó. Verificá en el
  release de GitHub que estén los 3 archivos (instalador + blockmap + yml).
- **SmartScreen bloquea el instalador**: builds sin firmar. Configurá
  `CSC_LINK` o pedile al user "Más info" → "Ejecutar de todos modos".
- **El updater dice "disabled" en producción**: revisá que la app esté
  empaquetada (`app.isPackaged === true`). En modo `electron-vite preview`
  sigue siendo dev.

## Rollback

Para retirar una versión publicada:
1. GitHub → Releases → Edit → "Mark as pre-release" o eliminar.
2. El cliente al hacer su próximo check ya no la verá como `latest`.
3. Para forzar un downgrade hay que publicar una versión nueva con número
   mayor pero contenido viejo (electron-updater no soporta downgrade
   automático).
