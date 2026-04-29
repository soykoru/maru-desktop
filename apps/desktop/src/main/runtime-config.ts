/**
 * Configuración de runtime resuelta una sola vez al arrancar el main process.
 * Centraliza paths y flags para no esparcir literales por el código.
 */

import { app } from 'electron';
import { resolve } from 'node:path';

const isDev = !app.isPackaged;

export const RUNTIME_CONFIG = {
  isDev,
  appVersion: app.getVersion(),
  /** Raíz del repo cuando corre en dev (electron-vite ejecuta desde apps/desktop) */
  repoRoot: resolve(__dirname, '../../../..'),
  /** Path al sidecar Python en dev. En prod, F7 lo reemplaza por el binario empaquetado. */
  sidecarDevRoot: resolve(__dirname, '../../../sidecar'),
  /**
   * Carpeta runtime_data del sidecar — DEBE coincidir con
   * `RUNTIME_DIR` en `apps/sidecar/maru_sidecar/runtime.py`. En dev,
   * ambos resuelven a `apps/runtime_data`. En prod usa userData.
   */
  sidecarRuntimeDataRoot: isDev
    ? resolve(__dirname, '../../../runtime_data')
    : '', // empty → image-protocol cae al fallback userData en prod
  /** Marker que el sidecar imprime cuando está listo */
  sidecarReadyMarker: 'MARU_SIDECAR_READY',
  /** Puerto JSON-RPC default — el sidecar puede tomar otro libre y reportarlo */
  defaultRpcPort: 8770,
} as const;

export type RuntimeConfig = typeof RUNTIME_CONFIG;
