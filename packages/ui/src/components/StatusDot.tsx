import type { ConnectionStatus } from '@maru/shared';
import { cn } from '../utils/cn.js';

const colorByStatus: Record<ConnectionStatus, string> = {
  disconnected: 'bg-fg-subtle',
  connecting: 'bg-warning animate-pulse',
  connected: 'bg-success shadow-[0_0_8px_rgb(46_204_113/0.6)]',
  error: 'bg-danger',
};

const ringByStatus: Record<ConnectionStatus, string> = {
  disconnected: '',
  connecting: '',
  connected: 'animate-live-ring',
  error: '',
};

export function StatusDot({ status, label }: { status: ConnectionStatus; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-fg-muted">
      <span className="relative inline-flex h-2 w-2">
        <span className={cn('absolute inset-0 rounded-full', colorByStatus[status])} />
        {ringByStatus[status] && (
          <span className={cn('absolute inset-0 rounded-full', ringByStatus[status])} aria-hidden />
        )}
      </span>
      {label ?? status}
    </span>
  );
}
