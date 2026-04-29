/**
 * `StatsCounters` — 6 contadores compactos del MARU original.
 *
 * Suma categorías relacionadas para tener counts visibles en el header
 * del LogPanel sin ocupar mucho espacio.
 */
export interface StatsCountersProps {
  stats: Record<string, number>;
}

const COUNTERS: { emoji: string; color: string; cats: string[]; title: string }[] = [
  { emoji: '🎁', color: 'text-warning', cats: ['gift'], title: 'Gifts' },
  { emoji: '👤', color: 'text-info', cats: ['follow'], title: 'Follows' },
  { emoji: '📤', color: 'text-success', cats: ['share'], title: 'Shares' },
  { emoji: '❤️', color: 'text-accent-red', cats: ['like'], title: 'Likes' },
  { emoji: '💬', color: 'text-info', cats: ['comment', 'command'], title: 'Chat' },
  { emoji: '🎮', color: 'text-accent', cats: ['rule', 'action'], title: 'Acciones' },
];

export function StatsCounters({ stats }: StatsCountersProps) {
  return (
    <div className="grid grid-cols-6 gap-1 text-[11px] font-bold text-center">
      {COUNTERS.map((c) => {
        const total = c.cats.reduce((acc, k) => acc + (stats[k] ?? 0), 0);
        return (
          <div key={c.title} className={c.color} title={c.title}>
            {c.emoji} {total}
          </div>
        );
      })}
    </div>
  );
}
