import { useMemo } from 'react';
import { CountUp } from '@maru/ui';
import type { LogEntry } from '@maru/shared';

/**
 * `StatsCounters` (v1.0.46) — 6 tiles compactos con emoji + número + label.
 *
 * Conteo (CRÍTICO v1.0.46):
 *   Suma `meta.count` de cada entry cuando existe, sino cuenta 1. Esto
 *   refleja el VOLUMEN REAL: un entry "❤️ @user dio 47 likes" cuenta
 *   como 47 (no como 1). Sin esto el contador "Likes" mostraba el N°
 *   de entries en el log, no la cantidad real de likes recibidos.
 *
 *   Aplica al campo Likes (donde el sidecar mete count del worker).
 *   Para gifts/follows/etc. la mayoría de entries no tienen meta.count
 *   y caen al default 1.
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
      // Sumamos meta.count si está, sino 1. Para likes el sidecar mete
      // el count real del batch (e.g. 47), entonces el contador refleja
      // los 47 likes — no las N entries del log.
      const meta = (e.meta ?? {}) as Record<string, unknown>;
      const raw = typeof meta.count === 'number' ? meta.count : Number(meta.count);
      const inc = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
      out[e.category] = (out[e.category] ?? 0) + inc;
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
