import { memo, useState, useCallback } from 'react';
import { ChevronRight } from 'lucide-react';
import type { LogBucket } from '../../lib/log-grouping.js';
import { LogEntryRow } from './LogEntryRow.js';
import { categoryMeta } from './log-meta.js';

/**
 * `LogBucketRow` (FASE V5 v1.0.40) — card colapsada de N eventos
 * consecutivos del mismo user (like/gift/share dentro de 60s).
 *
 * Cambios vs versión previa:
 *   - Card pill (kind-like / kind-gift / kind-share) en vez de fila plana.
 *   - Badge `×N` grande a la derecha en color de la categoría.
 *   - Chevron pequeño que rota al expandir.
 *   - Hijos expandidos heredan el `LogEntryRow` (consistencia visual).
 *
 * Estado expand/collapse vive LOCAL al componente — la identidad estable
 * del bucket (`id` derivado del primer entry) preserva el estado entre
 * re-renders mientras la racha exista.
 */

const KIND_LABEL: Record<string, { sing: string; plur: string }> = {
  like: { sing: 'like', plur: 'likes' },
  gift: { sing: 'regalo', plur: 'regalos' },
  share: { sing: 'compartido', plur: 'compartidos' },
  follow: { sing: 'follow', plur: 'follows' },
  comment: { sing: 'comentario', plur: 'comentarios' },
  command: { sing: 'comando', plur: 'comandos' },
  sound: { sing: 'sonido', plur: 'sonidos' },
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
  const label = KIND_LABEL[bucket.category] ?? { sing: 'evento', plur: 'eventos' };
  const word = bucket.count === 1 ? label.sing : label.plur;
  const range = fmtRange(bucket.firstTs, bucket.lastTs);

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
        className={`maru-bucket-card kind-${bucket.category}`}
        title={`${bucket.count} ${word} de @${bucket.user} · ${range}`}
        data-cv-auto-row
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-fg-subtle transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
        <span className="maru-bucket-icon" aria-hidden="true">
          {meta.emoji}
        </span>

        <div className="flex-1 min-w-0">
          <div className="maru-event-line">
            <span className="who">@{bucket.user}</span>
            <span className="what">
              {bucket.count} {word}
            </span>
          </div>
          {showTimestamp && (
            <div className="maru-event-meta">{range}</div>
          )}
        </div>

        <span className="maru-bucket-count">×{bucket.count}</span>
      </div>

      {open && (
        <div className="ml-3 border-l border-border/40 pl-1 flex flex-col gap-1.5 my-1">
          {bucket.entries.map((e) => (
            <LogEntryRow key={e.id} entry={e} showTimestamp={showTimestamp} />
          ))}
        </div>
      )}
    </>
  );
});
