import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../utils/cn.js';
import { IconButton } from './IconButton.js';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  footer?: ReactNode;
  children: ReactNode;
  /**
   * Si true, el contenido principal ocupa toda la altura disponible y
   * el body usa flex-col. Útil para diálogos con grid + preview que
   * necesitan altura fija (e.g. GiftsDialog 750px).
   */
  bodyFlush?: boolean;
  /**
   * Si true, hay cambios sin guardar — al click-afuera/Escape/X
   * pedimos confirmación antes de cerrar (window.confirm). Usalo
   * cuando el dialog tiene un draft local que se perdería con
   * `onClose`. Default: false (compat — cierre directo).
   */
  unsavedChanges?: boolean;
  /**
   * Si true, el click sobre el backdrop NO cierra el dialog. Útil para
   * formularios que el user solo debe cerrar con un botón explícito
   * (Save / Cancel). Default: false.
   */
  dismissOnBackdrop?: boolean;
}

const DEFAULT_DISMISS_BACKDROP = true;
const UNSAVED_CONFIRM_MSG =
  'Tenés cambios sin guardar. ¿Cerrar igual y perderlos?';

export function Dialog({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  children,
  bodyFlush = false,
  unsavedChanges = false,
  dismissOnBackdrop,
}: Props) {
  // Si hay cambios sin guardar, NUNCA cerrar por click-afuera (ni con
  // confirm) — el riesgo de pérdida accidental es muy alto. Forzamos
  // que el user use Cancel/Save explícito o la X / Escape (con
  // confirmación). Compat: si `dismissOnBackdrop` se pasa explícito,
  // se respeta.
  const allowBackdropDismiss = dismissOnBackdrop ?? (
    unsavedChanges ? false : DEFAULT_DISMISS_BACKDROP
  );

  function attemptClose() {
    if (unsavedChanges) {
      const ok = window.confirm(UNSAVED_CONFIRM_MSG);
      if (!ok) return;
    }
    onClose();
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      attemptClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unsavedChanges, onClose]);

  if (!open) return null;

  const widths = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-3xl',
    xl: 'max-w-[960px]',
    '2xl': 'max-w-[1120px]',
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-fade-in"
      onClick={() => {
        if (allowBackdropDismiss) attemptClose();
      }}
    >
      <div className="absolute inset-0 bg-bg-overlay/70 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'relative flex flex-col w-full overflow-hidden rounded-2xl border border-border bg-bg-surface shadow-lg animate-scale-in',
          widths[size],
          bodyFlush && 'h-[80vh] max-h-[800px]',
        )}
      >
        <header className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-fg">{title}</h2>
            {description && <p className="mt-1 text-xs text-fg-muted">{description}</p>}
          </div>
          <IconButton aria-label="Cerrar" variant="ghost" size="sm" onClick={attemptClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </header>
        <div
          className={cn(
            bodyFlush
              ? 'flex flex-col flex-1 min-h-0 max-h-[80vh] overflow-hidden'
              : 'px-5 py-4 max-h-[75vh] overflow-y-auto',
          )}
        >
          {children}
        </div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-border bg-bg-base/50 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
