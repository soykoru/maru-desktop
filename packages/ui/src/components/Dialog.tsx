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
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  children,
  bodyFlush = false,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

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
      onClick={onClose}
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
          <IconButton aria-label="Cerrar" variant="ghost" size="sm" onClick={onClose}>
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
