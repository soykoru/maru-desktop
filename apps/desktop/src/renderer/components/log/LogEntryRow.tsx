import { memo } from 'react';
import type { LogEntry } from '@maru/shared';
import { categoryMeta } from './log-meta.js';

/**
 * `LogEntryRow` — fila compacta del log con timestamp opcional + badge
 * de categoría + level + source + message.
 */
export interface LogEntryRowProps {
  entry: LogEntry;
  showTimestamp?: boolean;
}

const LEVEL_COLOR: Record<string, string> = {
  ERROR: 'text-danger',
  CRITICAL: 'text-danger',
  WARNING: 'text-warning',
  WARN: 'text-warning',
  INFO: 'text-fg-muted',
  DEBUG: 'text-fg-subtle',
};

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return d.toTimeString().slice(0, 8);
}

export const LogEntryRow = memo(function LogEntryRow({
  entry,
  showTimestamp = true,
}: LogEntryRowProps) {
  const meta = categoryMeta(entry.category);
  const levelClass = LEVEL_COLOR[entry.level] ?? 'text-fg-muted';

  return (
    <div className="flex items-baseline gap-2 px-2 py-0.5 text-[11px] font-mono leading-snug hover:bg-fg/5 rounded-sm">
      {showTimestamp && (
        <span className="text-fg-subtle shrink-0 tabular-nums">
          {fmtTime(entry.ts)}
        </span>
      )}
      <span className={`shrink-0 ${meta.color}`} title={entry.category}>
        {meta.emoji}
      </span>
      <span className={`shrink-0 text-[10px] uppercase ${levelClass}`}>
        {entry.level.slice(0, 4)}
      </span>
      <span
        className="text-fg break-words flex-1 min-w-0"
        title={`[${entry.source}] ${entry.message}`}
      >
        {entry.message}
      </span>
    </div>
  );
});
