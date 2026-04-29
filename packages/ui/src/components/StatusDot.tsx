import type { ConnectionStatus } from '@maru/shared';
import { cn } from '../utils/cn.js';

const colorByStatus: Record<ConnectionStatus, string> = {
  disconnected: 'bg-fg-subtle',
  connecting: 'bg-warning animate-pulse',
  connected: 'bg-success',
  error: 'bg-danger',
};

export function StatusDot({ status, label }: { status: ConnectionStatus; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-fg-muted">
      <span className={cn('h-2 w-2 rounded-full', colorByStatus[status])} />
      {label ?? status}
    </span>
  );
}
