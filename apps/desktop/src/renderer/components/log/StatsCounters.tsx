import { useMemo } from 'react';
import type { LogEntry } from '@maru/shared';

/**
 * `StatsCounters` — 6 contadores compactos del MARU original.
 *
 * Cuenta DIRECTO desde las entries del buffer del log (más confiable
 * que un counter incremental que podía quedarse out-of-sync con el
 * server-side stats del sidecar). Esto significa que los stats
 * reflejan EXACTAMENTE lo que el user ve en el panel — si limpias
 * el log, vuelven a 0; si llega un evento, incrementa al instante.
 */
export interface StatsCountersProps {
  /** Entries actuales del log buffer (max 500). */
  entries: LogEntry[];
}

const COUNTERS: {
  emoji: string;
  color: string;
  cats: string[];
  title: string;
}[] = [
  { emoji: '🎁', color: 'text-warning', cats: ['gift'], title: 'Gifts' },
  { emoji: '👤', color: 'text-info', cats: ['follow'], title: 'Follows' },
  { emoji: '📤', color: 'text-success', cats: ['share'], title: 'Shares' },
  { emoji: '❤️', color: 'text-accent-red', cats: ['like'], title: 'Likes' },
  { emoji: '💬', color: 'text-info', cats: ['comment', 'command'], title: 'Chat' },
  { emoji: '🎮', color: 'text-accent', cats: ['rule', 'action'], title: 'Acciones' },
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
    <div className="grid grid-cols-6 gap-1 text-[11px] font-bold text-center">
      {COUNTERS.map((c) => {
        const total = c.cats.reduce((acc, k) => acc + (counts[k] ?? 0), 0);
        return (
          <div key={c.title} className={c.color} title={c.title}>
            {c.emoji} {total}
          </div>
        );
      })}
    </div>
  );
}
