import { memo, useState, useCallback } from 'react';
import { ChevronRight } from 'lucide-react';
import type { LogBucket } from '../../lib/log-grouping.js';
import { LogEntryRow } from './LogEntryRow.js';
import { categoryMeta } from './log-meta.js';

/**
 * `LogBucketRow` — fila colapsada de un bucket de eventos consecutivos
 * del mismo user (like/gift/share dentro de 60s).
 *
 * Estado expand/collapse vive LOCAL al componente para evitar contaminar
 * el store global con un Set que cambia en cada click. La identidad del
 * bucket (`id` estable) preserva el estado entre re-renders mientras la
 * racha siga viva.
 *
 * Render colapsado: stripe de categoría + emoji + count compacto +
 * `@user × N` + rango temporal hover. Hover → fila completa highlightea.
 * Click cualquier parte de la fila → expande/colapsa.
 */

const STRIPE: Record<string, string> = {
  like: 'bg-accent-red',
  gift: 'bg-warning',
  share: 'bg-cyan-400',
};

const TINT: Record<string, string> = {
  like: 'bg-accent-red/[0.05] hover:bg-accent-red/[0.10]',
  gift: 'bg-warning/[0.07] hover:bg-warning/[0.12]',
  share: 'bg-cyan-400/[0.05] hover:bg-cyan-400/[0.10]',
};

const KIND_LABEL: Record<string, { sing: string; plur: string }> = {
  like: { sing: 'like', plur: 'likes' },
  gift: { sing: 'regalo', plur: 'regalos' },
  share: { sing: 'compartido', plur: 'compartidos' },
};

function fmtTime(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 8);
}

function fmtRange(firstMs: number, lastMs: number): string {
  const a = fmtTime(firstMs);
  const b = fmtTime(lastMs);
  return a === b ? a : `${a} → ${b}`;
}

export interface LogBucketRowProps {
  bucket: LogBucket;
  showTimestamp?: boolean;
}

export const LogBucketRow = memo(function LogBucketRow({
  bucket,
  showTimestamp = true,
}: LogBucketRowProps) {
  const [open, setOpen] = useState(false);
  const meta = categoryMeta(bucket.category);
  const stripe = STRIPE[bucket.category] ?? 'bg-fg-muted';
  const tint = TINT[bucket.category] ?? 'hover:bg-fg/5';
  const label = KIND_LABEL[bucket.category] ?? { sing: 'evento', plur: 'eventos' };
  const word = bucket.count === 1 ? label.sing : label.plur;

  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
        aria-expanded={open}
        aria-label={`${bucket.count} ${word} de @${bucket.user}, ${open ? 'colapsar' : 'expandir'}`}
        className={`group flex items-baseline gap-2 px-2 py-[3px] text-[11px] font-mono leading-snug rounded-sm relative pl-3 cursor-pointer select-none ${tint}`}
        title={`${bucket.count} ${word} de @${bucket.user} · ${fmtRange(bucket.firstTs, bucket.lastTs)}`}
      >
        <span
          className={`absolute left-0 top-1 bottom-1 w-[2px] rounded-full ${stripe}`}
          aria-hidden="true"
        />
        {showTimestamp && (
          <span className="text-fg-subtle shrink-0 tabular-nums opacity-90 group-hover:opacity-100">
            {fmtTime(bucket.lastTs)}
          </span>
        )}
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-fg-subtle group-hover:text-fg transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
        <span className={`shrink-0 ${meta.color}`} title={bucket.category}>
          {meta.emoji}
        </span>
        <span className="text-fg break-words flex-1 min-w-0">
          <span className="text-accent font-semibold">@{bucket.user}</span>{' '}
          <span className="text-fg-subtle">×</span>{' '}
          <span className="font-semibold tabular-nums">{bucket.count}</span>{' '}
          <span className="text-fg-subtle">{word}</span>
        </span>
        <span className="hidden group-hover:inline text-[9px] text-fg-subtle tabular-nums shrink-0">
          {fmtRange(bucket.firstTs, bucket.lastTs)}
        </span>
      </div>
      {open && (
        <div className="ml-3 border-l border-border/40 pl-1">
          {bucket.entries.map((e) => (
            <LogEntryRow key={e.id} entry={e} showTimestamp={showTimestamp} />
          ))}
        </div>
      )}
    </>
  );
});
