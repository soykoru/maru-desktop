import type { LogGroup } from '@maru/shared';
import { LOG_GROUPS } from './log-meta.js';

/**
 * `FilterPills` — 8 grupos toggleables del log.
 *
 * Cuando todos están activos = ver todo. Cuando ninguno = ver nada
 * (lo que es útil para 'modo silencio').
 */
export interface FilterPillsProps {
  active: Set<LogGroup>;
  onToggle: (g: LogGroup) => void;
  onSetAll: (active: Set<LogGroup>) => void;
  /** Counts por group (sumadas de las categorías que agrupa). */
  counts?: Record<string, number>;
}

export function FilterPills({
  active,
  onToggle,
  onSetAll,
  counts = {},
}: FilterPillsProps) {
  const allOn = active.size === LOG_GROUPS.length;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {LOG_GROUPS.map((g) => {
        const on = active.has(g.id);
        const count = counts[g.id] ?? 0;
        return (
          <button
            key={g.id}
            type="button"
            onClick={() => onToggle(g.id)}
            title={`${g.label}${count ? ` (${count})` : ''}`}
            className={[
              'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
              'border transition-colors',
              on
                ? 'border-accent/40 bg-accent/10 text-fg'
                : 'border-border/50 bg-bg-elev/40 text-fg-subtle hover:border-fg-muted',
            ].join(' ')}
          >
            <span>{g.emoji}</span>
            <span>{g.label}</span>
            {count > 0 && (
              <span className="text-[9px] opacity-60">{count}</span>
            )}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() =>
          onSetAll(allOn ? new Set() : new Set(LOG_GROUPS.map((g) => g.id)))
        }
        className="ml-1 text-[10px] text-fg-subtle hover:text-fg uppercase tracking-wider"
        title={allOn ? 'Desactivar todos' : 'Activar todos'}
      >
        {allOn ? 'ninguno' : 'todos'}
      </button>
    </div>
  );
}
