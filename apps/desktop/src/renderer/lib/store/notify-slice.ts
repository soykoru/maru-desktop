import type { StateCreator } from 'zustand';

/**
 * `notify-slice` (v1.0.94+) — ConfirmDialog en el store global.
 *
 * Reemplaza `window.confirm/.prompt` (cuadros blancos del SO, feos y
 * anticuados que no respetan el tema dark) por un Dialog custom del
 * design system MARU.
 *
 * Para Toasts ver `toast` singleton en `@maru/ui` (ya existente con
 * sistema premium de slide-in + progress bar + variants).
 *
 * Patrón de uso:
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     title: '¿Eliminar?',
 *     message: 'Esta acción no se puede deshacer.',
 *     variant: 'danger',
 *   });
 *   if (!ok) return;
 */

export type ConfirmVariant = 'default' | 'danger' | 'warning' | 'success';

export interface PendingConfirm {
  id: string;
  title: string;
  message: string;
  /** Líneas adicionales como bullet list (visualmente más claro). */
  bullets?: string[];
  /** Texto pequeño debajo del mensaje. */
  footnote?: string;
  variant: ConfirmVariant;
  confirmLabel: string;
  cancelLabel: string;
  /** Icon emoji al lado del título (sustituye al icon variant default). */
  icon?: string;
  /** Resolver de la promise — interno, no se setea desde fuera. */
  _resolve: (ok: boolean) => void;
}

export interface NotifySlice {
  pendingConfirm: PendingConfirm | null;
  /** Internal — el hook `useConfirm()` se encarga del resolver. */
  _setPendingConfirm: (p: PendingConfirm | null) => void;
}

export const createNotifySlice: StateCreator<NotifySlice, [], [], NotifySlice> = (
  set,
) => ({
  pendingConfirm: null,
  _setPendingConfirm: (pendingConfirm) => set({ pendingConfirm }),
});
