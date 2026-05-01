import type { StateCreator } from 'zustand';
import type { LogCategory, LogEntry, LogGroup } from '@maru/shared';

/**
 * Micro-batch buffer: replica el `BATCH_INTERVAL=50ms` del MARU original
 * (`gui/widgets/log_widget.py:58`). Bajo carga (ráfagas de 100+ likes/s)
 * coalescemos los pushes para evitar 100 re-renders y 100 clones del array.
 */
const BATCH_INTERVAL_MS = 50;
let pendingEntries: LogEntry[] = [];
let flushScheduled = false;
let flusher: ((entries: LogEntry[]) => void) | null = null;

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    const batch = pendingEntries;
    pendingEntries = [];
    flushScheduled = false;
    if (batch.length && flusher) flusher(batch);
  }, BATCH_INTERVAL_MS);
}

/**
 * Slice de log (G11) — buffer max 500 + stats por categoría + filtros.
 *
 * Se actualiza tanto desde polling de `logs.list` (snapshot inicial)
 * como desde push events `log:entry` del sidecar. El trim a 500 evita
 * crecer indefinidamente.
 */
const MAX_BUFFER = 500;

const ALL_GROUPS: LogGroup[] = [
  'comments',
  'commands',
  'gifts',
  'emotes',
  'follows',
  'likes',
  'shares',
  'subs',
  'rules',
  'social',
  'music',
  'ia',
  'audio',
  'sistema',
  'errores',
];

export interface LogSlice {
  logEntries: LogEntry[];
  /** Stats por categoría — incrementadas cada push event. */
  logStats: Record<string, number>;
  logStatsTotal: number;
  /** Filtros activos (sets). Vacío = ninguno excluido. */
  logActiveGroups: Set<LogGroup>;
  logSearch: string;
  /** True si el usuario hizo scroll-up — pausa el auto-scroll. */
  logAutoScroll: boolean;
  /** Cuenta unread cuando autoScroll=false. */
  logUnreadCount: number;
  logShowTimestamps: boolean;

  setLogEntries: (entries: LogEntry[]) => void;
  pushLogEntry: (entry: LogEntry) => void;
  clearLog: () => void;
  setLogStats: (stats: Record<string, number>, total: number) => void;
  toggleLogGroup: (g: LogGroup) => void;
  setLogActiveGroups: (groups: Set<LogGroup>) => void;
  setLogSearch: (q: string) => void;
  setLogAutoScroll: (v: boolean) => void;
  resetLogUnread: () => void;
  setShowTimestamps: (v: boolean) => void;
}

export const createLogSlice: StateCreator<LogSlice, [], [], LogSlice> = (set) => ({
  logEntries: [],
  logStats: {},
  logStatsTotal: 0,
  logActiveGroups: new Set<LogGroup>(ALL_GROUPS),
  logSearch: '',
  logAutoScroll: true,
  logUnreadCount: 0,
  logShowTimestamps: true,

  setLogEntries: (entries) =>
    set({
      logEntries: entries.slice(-MAX_BUFFER),
      logUnreadCount: 0,
    }),

  pushLogEntry: (entry) => {
    pendingEntries.push(entry);
    // Configurar flusher la primera vez (closure sobre `set`).
    if (!flusher) {
      flusher = (batch: LogEntry[]) =>
        set((s) => {
          const next =
            s.logEntries.length + batch.length > MAX_BUFFER
              ? [...s.logEntries, ...batch].slice(-MAX_BUFFER)
              : [...s.logEntries, ...batch];
          // Stats incrementales por categoría (1 sola pasada).
          const statsDelta: Record<string, number> = {};
          for (const e of batch) {
            const cat = e.category as LogCategory;
            statsDelta[cat] = (statsDelta[cat] ?? 0) + 1;
          }
          const newStats: Record<string, number> = { ...s.logStats };
          for (const [k, v] of Object.entries(statsDelta)) {
            newStats[k] = (newStats[k] ?? 0) + v;
          }
          return {
            logEntries: next,
            logStats: newStats,
            logStatsTotal: s.logStatsTotal + batch.length,
            logUnreadCount: s.logAutoScroll
              ? 0
              : s.logUnreadCount + batch.length,
          };
        });
    }
    scheduleFlush();
  },

  clearLog: () =>
    set({
      logEntries: [],
      logStats: {},
      logStatsTotal: 0,
      logUnreadCount: 0,
    }),

  setLogStats: (logStats, logStatsTotal) => set({ logStats, logStatsTotal }),

  toggleLogGroup: (g) =>
    set((s) => {
      const next = new Set(s.logActiveGroups);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return { logActiveGroups: next };
    }),

  setLogActiveGroups: (groups) => set({ logActiveGroups: groups }),
  setLogSearch: (logSearch) => set({ logSearch }),
  setLogAutoScroll: (logAutoScroll) =>
    set((s) => ({
      logAutoScroll,
      logUnreadCount: logAutoScroll ? 0 : s.logUnreadCount,
    })),
  resetLogUnread: () => set({ logUnreadCount: 0 }),
  setShowTimestamps: (logShowTimestamps) => set({ logShowTimestamps }),
});
