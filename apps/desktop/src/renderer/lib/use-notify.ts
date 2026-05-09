/**
 * Hook `useConfirm` (v1.0.94+) — reemplazo de `window.confirm/.prompt`.
 *
 * Para toasts usar el singleton `toast` de `@maru/ui` directamente:
 *   import { toast } from '@maru/ui';
 *   toast.success('Perfil cargado');
 *   toast.error('Falló', 'detalle opcional');
 *
 * Uso del confirm:
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     title: '¿Eliminar?',
 *     message: 'No se puede deshacer.',
 *     variant: 'danger',
 *   });
 *   if (!ok) return;
 */

import { useCallback } from 'react';
import { useAppStore } from './store/index.js';
import type {
  ConfirmVariant,
  PendingConfirm,
} from './store/notify-slice.js';

export interface ConfirmOptions {
  title: string;
  message: string;
  /** Líneas adicionales como bullet list. */
  bullets?: string[];
  /** Texto pequeño debajo del mensaje. */
  footnote?: string;
  variant?: ConfirmVariant;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Emoji junto al título. */
  icon?: string;
}

let _confirmSeq = 0;
function nextConfirmId(): string {
  _confirmSeq += 1;
  return `c-${Date.now()}-${_confirmSeq}`;
}

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const setPending = useAppStore((s) => s._setPendingConfirm);
  return useCallback(
    (opts) =>
      new Promise<boolean>((resolve) => {
        const pending: PendingConfirm = {
          id: nextConfirmId(),
          title: opts.title,
          message: opts.message,
          bullets: opts.bullets,
          footnote: opts.footnote,
          variant: opts.variant ?? 'default',
          confirmLabel: opts.confirmLabel ?? 'Confirmar',
          cancelLabel: opts.cancelLabel ?? 'Cancelar',
          icon: opts.icon,
          _resolve: resolve,
        };
        setPending(pending);
      }),
    [setPending],
  );
}
