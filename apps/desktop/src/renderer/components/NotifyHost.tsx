import { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { Button, Dialog } from '@maru/ui';
import { useAppStore } from '../lib/store/index.js';
import type { ConfirmVariant } from '../lib/store/notify-slice.js';

/**
 * `NotifyHost` (v1.0.94+) — host único del Confirm dialog del store global.
 *
 * Reemplaza a `window.confirm/.prompt` que mostraban cuadros blancos del
 * SO, no respetaban el tema y se veían anticuados. Acá un Dialog custom
 * con icon variant + design system MARU.
 *
 * Se monta UNA sola vez en App, encima de ModalRoot, para que cualquier
 * componente pueda llamar `useConfirm()` y obtener una promise<boolean>.
 *
 * Para toasts ver el singleton `toast` de `@maru/ui` (ya existente, con
 * `<Toaster />` montado en App.tsx).
 */
export function NotifyHost() {
  const pending = useAppStore((s) => s.pendingConfirm);
  const setPending = useAppStore((s) => s._setPendingConfirm);

  if (!pending) return null;

  return (
    <ConfirmDialogHost
      variant={pending.variant}
      icon={pending.icon}
      title={pending.title}
      message={pending.message}
      bullets={pending.bullets}
      footnote={pending.footnote}
      confirmLabel={pending.confirmLabel}
      cancelLabel={pending.cancelLabel}
      onConfirm={() => {
        pending._resolve(true);
        setPending(null);
      }}
      onCancel={() => {
        pending._resolve(false);
        setPending(null);
      }}
    />
  );
}

const VARIANT_META: Record<
  ConfirmVariant,
  {
    Icon: typeof CheckCircle2;
    iconBg: string;
    iconColor: string;
    confirmVariant: 'primary' | 'danger';
  }
> = {
  default: {
    Icon: Info,
    iconBg: 'bg-accent/15',
    iconColor: 'text-accent',
    confirmVariant: 'primary',
  },
  danger: {
    Icon: XCircle,
    iconBg: 'bg-danger/15',
    iconColor: 'text-danger',
    confirmVariant: 'danger',
  },
  warning: {
    Icon: AlertTriangle,
    iconBg: 'bg-warning/15',
    iconColor: 'text-warning',
    confirmVariant: 'primary',
  },
  success: {
    Icon: CheckCircle2,
    iconBg: 'bg-success/15',
    iconColor: 'text-success',
    confirmVariant: 'primary',
  },
};

interface ConfirmDialogHostProps {
  variant: ConfirmVariant;
  icon?: string;
  title: string;
  message: string;
  bullets?: string[];
  footnote?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialogHost({
  variant,
  icon,
  title,
  message,
  bullets,
  footnote,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogHostProps) {
  const meta = VARIANT_META[variant];
  const { Icon } = meta;

  // ESC para cancelar, Enter para confirmar — UX teclado.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
      if (e.key === 'Enter') {
        // Solo confirmar con Enter si el target NO es un textarea/input
        // donde Enter podría ser parte del flujo natural.
        const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
        if (tag === 'textarea' || tag === 'input') return;
        e.preventDefault();
        onConfirm();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onConfirm, onCancel]);

  return (
    <Dialog open onClose={onCancel} size="sm" title="">
      <div className="space-y-4 px-1 py-1">
        {/* Icon + Title */}
        <div className="flex items-start gap-3">
          <div
            className={[
              'h-12 w-12 shrink-0 rounded-xl grid place-items-center text-2xl shadow-inner',
              meta.iconBg,
            ].join(' ')}
          >
            {icon ? (
              <span className="font-emoji">{icon}</span>
            ) : (
              <Icon className={`h-6 w-6 ${meta.iconColor}`} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-fg-default leading-tight">
              {title}
            </h3>
            <p className="mt-1 text-[13px] text-fg-muted leading-snug whitespace-pre-line">
              {message}
            </p>
          </div>
        </div>

        {/* Bullets opcionales */}
        {bullets && bullets.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-border/60 bg-bg-elev/40 px-3 py-2">
            {bullets.map((b, i) => (
              <li
                key={i}
                className="text-[12px] text-fg-default flex items-start gap-2 leading-snug"
              >
                <span className="text-accent mt-0.5">·</span>
                <span className="flex-1">{b}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Footnote */}
        {footnote && (
          <p className="text-[11px] text-fg-subtle italic leading-snug">
            {footnote}
          </p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="md" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={meta.confirmVariant} size="md" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
