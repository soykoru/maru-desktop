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

// Persistencia de los filtros del LogPanel en localStorage. Sin esto,
// cada vez que el user reabría MARU se resetan a "todos activos" y
// perdía las desmarcas (típicamente quitar `audio` o `sistema`).
const LS_KEY_ACTIVE = 'maru.logPanel.activeGroups.v2';
const LS_KEY_TIMESTAMPS = 'maru.logPanel.showTimestamps.v2';

function loadPersistedActive(): Set<LogGroup> {
  try {
    const raw = window.localStorage.getItem(LS_KEY_ACTIVE);
    if (!raw) return new Set<LogGroup>(ALL_GROUPS);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<LogGroup>(ALL_GROUPS);
    const valid = new Set<LogGroup>(ALL_GROUPS);
    return new Set<LogGroup>(
      parsed.filter((g): g is LogGroup => valid.has(g as LogGroup)),
    );
  } catch {
    return new Set<LogGroup>(ALL_GROUPS);
  }
}

function savePersistedActive(s: Set<LogGroup>): void {
  try {
    window.localStorage.setItem(LS_KEY_ACTIVE, JSON.stringify(Array.from(s)));
  } catch {
    /* swallow — quota / privacy mode */
  }
}

function loadPersistedTimestamps(): boolean {
  try {
    const raw = window.localStorage.getItem(LS_KEY_TIMESTAMPS);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

function savePersistedTimestamps(v: boolean): void {
  try {
    window.localStorage.setItem(LS_KEY_TIMESTAMPS, v ? '1' : '0');
  } catch {
    /* swallow */
  }
}

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
  logActiveGroups: loadPersistedActive(),
  logSearch: '',
  logAutoScroll: true,
  logUnreadCount: 0,
  logShowTimestamps: loadPersistedTimestamps(),

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
      savePersistedActive(next);
      return { logActiveGroups: next };
    }),

  setLogActiveGroups: (groups) => {
    savePersistedActive(groups);
    set({ logActiveGroups: groups });
  },
  setLogSearch: (logSearch) => set({ logSearch }),
  setLogAutoScroll: (logAutoScroll) =>
    set((s) => ({
      logAutoScroll,
      logUnreadCount: logAutoScroll ? 0 : s.logUnreadCount,
    })),
  resetLogUnread: () => set({ logUnreadCount: 0 }),
  setShowTimestamps: (logShowTimestamps) => {
    savePersistedTimestamps(logShowTimestamps);
    set({ logShowTimestamps });
  },
});
