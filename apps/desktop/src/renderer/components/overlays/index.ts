/**
 * Barrel del panel de Overlays.
 *
 * ZONA AISLADA. Todo el código nuevo del sistema vive en esta carpeta.
 * La integración con el resto del renderer son SOLO 2 puntos marcados
 * con `MARU-OVERLAYS-INTEGRATION` en `ModalRoot.tsx` y `Sidebar.tsx`.
 *
 * Para desinstalar:
 *   1) Borrar esta carpeta entera.
 *   2) Quitar los 2 markers MARU-OVERLAYS-INTEGRATION.
 *   3) Quitar `'overlays'` del enum `ActiveModal` en `ui-slice.ts`.
 */
export { OverlaysDialog } from './OverlaysDialog.js';
