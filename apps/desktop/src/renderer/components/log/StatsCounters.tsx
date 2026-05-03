import { useMemo } from 'react';
import { CountUp } from '@maru/ui';
import type { LogEntry } from '@maru/shared';

/**
 * `StatsCounters` (v1.0.41) — 6 tiles compactos con emoji + número + label.
 *
 * Antes mostrábamos solo emoji + número, lo que hacía que "👤" pareciera
 * "Usuarios" cuando en realidad es Follows. Ahora cada tile lleva una
 * label corta visible debajo del número.
 *
 * Conteo:
 *   - Sumamos por las categorías declaradas en `cats`. Para "Likes"
 *     contamos también `like_milestone` si el sidecar lo loguea como
 *     categoría aparte (paridad MARU original donde llega en batches).
 *
 * Se mantiene `CountUp` (ease-out cubic 500ms) para la animación
 * incremental. memo implícito vía useMemo para evitar recálculo en cada
 * push.
 */
export interface StatsCountersProps {
  /** Entries actuales del log buffer (max 500). */
  entries: LogEntry[];
}

const COUNTERS: {
  emoji: string;
  color: string;
  cats: string[];
  label: string;
  title: string;
}[] = [
  { emoji: '🎁', color: 'text-warning',     cats: ['gift'],                           label: 'Regalos',  title: 'Gifts recibidos' },
  { emoji: '➕', color: 'text-success',     cats: ['follow'],                         label: 'Nuevos',   title: 'Follows nuevos' },
  { emoji: '📤', color: 'text-cyan-400',    cats: ['share'],                          label: 'Shares',   title: 'Compartidos' },
  { emoji: '❤️', color: 'text-accent-red',  cats: ['like', 'like_milestone'],         label: 'Likes',    title: 'Likes (incluye milestones)' },
  { emoji: '💬', color: 'text-info',        cats: ['comment', 'command'],             label: 'Chat',     title: 'Comentarios + comandos' },
  { emoji: '⚡', color: 'text-accent',      cats: ['rule', 'action'],                 label: 'Reglas',   title: 'Reglas ejecutadas' },
];

export function StatsCounters({ entries }: StatsCountersProps) {
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const e of entries) {
      out[e.category] = (out[e.category] ?? 0) + 1;
    }
    return out;
  }, [entries]);

  return (
    <div className="grid grid-cols-6 gap-1.5">
      {COUNTERS.map((c) => {
        const total = c.cats.reduce((acc, k) => acc + (counts[k] ?? 0), 0);
        return (
          <div
            key={c.label}
            className="maru-stat-tile flex flex-col items-center !py-1.5 !px-1"
            title={c.title}
          >
            <div className={`flex items-baseline gap-1 ${c.color}`}>
              <span className="text-[12px] leading-none" aria-hidden="true">
                {c.emoji}
              </span>
              <span className="font-mono font-bold text-[13px] leading-none tabular-nums">
                <CountUp value={total} durationMs={500} />
              </span>
            </div>
            <span className="mt-1 text-[8.5px] uppercase tracking-wider text-fg-subtle font-semibold leading-none">
              {c.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
