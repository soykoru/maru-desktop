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

// Lista canónica de grupos. DEBE estar 1:1 con `LOG_GROUPS` en
// `components/log/log-meta.ts` y con el type `LogGroup` en shared.
// Si agregás un nuevo grupo, hay que tocar los 3 lugares (y el setAll
// del LogPanel.tsx) — sino el grupo nuevo no se persiste y se pierde
// al cerrar la app, o no se incluye en el botón "todos".
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
  'fortune',
  'joins',
  'audio',
  'sistema',
  'errores',
];

// Persistencia de los filtros del LogPanel en localStorage. Sin esto,
// cada vez que el user reabría MARU se resetan a "todos activos" y
// perdía las desmarcas (típicamente quitar `audio` o `sistema`).
//
// Nota v1.0.66: bump a v3 porque la versión v2 olvidó persistir
// `fortune`/`joins` (no estaban en ALL_GROUPS) — al migrar, el user
// recupera los grupos nuevos como activos por default sin perder los
// que tenía ya desactivados.
const LS_KEY_ACTIVE = 'maru.logPanel.activeGroups.v3';
const LS_KEY_ACTIVE_LEGACY_V2 = 'maru.logPanel.activeGroups.v2';
const LS_KEY_TIMESTAMPS = 'maru.logPanel.showTimestamps.v2';
const LS_KEY_SEARCH = 'maru.logPanel.search.v1';

function loadPersistedActive(): Set<LogGroup> {
  try {
    let raw = window.localStorage.getItem(LS_KEY_ACTIVE);
    let migratedFromV2 = false;
    if (!raw) {
      // Migración desde v2: usar el snapshot viejo y completar los
      // grupos nuevos como activos (asumimos que el user no los había
      // visto antes, así que tienen el default "todos activos").
      const legacy = window.localStorage.getItem(LS_KEY_ACTIVE_LEGACY_V2);
      if (legacy) {
        raw = legacy;
        migratedFromV2 = true;
      }
    }
    if (!raw) return new Set<LogGroup>(ALL_GROUPS);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<LogGroup>(ALL_GROUPS);
    const valid = new Set<LogGroup>(ALL_GROUPS);
    const set = new Set<LogGroup>(
      parsed.filter((g): g is LogGroup => valid.has(g as LogGroup)),
    );
    if (migratedFromV2) {
      // Sumar los grupos nuevos que el storage v2 no conocía. Los que
      // están en ALL_GROUPS pero no aparecen en `parsed` se asumen
      // activos (default histórico) — el user puede desactivarlos a
      // mano si los molesta.
      const knownInV2 = new Set<string>(parsed);
      for (const g of ALL_GROUPS) {
        if (!knownInV2.has(g)) set.add(g);
      }
      // Persistir snapshot fresco en la key nueva.
      try {
        window.localStorage.setItem(LS_KEY_ACTIVE, JSON.stringify(Array.from(set)));
      } catch {
        /* swallow */
      }
    }
    return set;
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

function loadPersistedSearch(): string {
  try {
    return window.localStorage.getItem(LS_KEY_SEARCH) ?? '';
  } catch {
    return '';
  }
}

function savePersistedSearch(q: string): void {
  try {
    if (q) window.localStorage.setItem(LS_KEY_SEARCH, q);
    else window.localStorage.removeItem(LS_KEY_SEARCH);
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
  /** v1.1.3 — actualiza una entry existente (count + ts) y la mueve
   * al final del buffer. Llamado desde el push event `log:entry:updated`
   * cuando el sidecar dedupea un mensaje (ej. taps repetidos del mismo
   * user). Si el id no existe, hace fallback agregando entry sintética. */
  updateLogEntry: (update: { id: string; ts: number; count: number }) => void;
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
  logSearch: loadPersistedSearch(),
  logAutoScroll: true,
  logUnreadCount: 0,
  logShowTimestamps: loadPersistedTimestamps(),

  setLogEntries: (entries) => {
    // Dedupe por id en el snapshot — defensa contra fuentes que puedan
    // emitir el mismo entry 2 veces (raro, pero barato). React requiere
    // keys únicas, sin esto crash en mount con 2 entries de mismo id.
    const seen = new Set<string>();
    const deduped: LogEntry[] = [];
    for (const e of entries.slice(-MAX_BUFFER)) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      deduped.push(e);
    }
    set({ logEntries: deduped, logUnreadCount: 0 });
  },

  pushLogEntry: (entry) => {
    pendingEntries.push(entry);
    // Configurar flusher la primera vez (closure sobre `set`).
    if (!flusher) {
      flusher = (batch: LogEntry[]) =>
        set((s) => {
          // Dedupe por id: el snapshot inicial via `logs.list` puede
          // traer entries que también llegan via push event `log:entry`
          // (race entre snapshot RPC y subscribe al bus). Sin dedupe,
          // React reportaba "Encountered two children with the same key
          // l-XXX" y los entries duplicados quedaban en el panel.
          const seen = new Set<string>();
          for (const e of s.logEntries) seen.add(e.id);
          const fresh = batch.filter((e) => {
            if (seen.has(e.id)) return false;
            seen.add(e.id);
            return true;
          });
          if (fresh.length === 0) {
            // Todo el batch era duplicado — no actualizamos state.
            return s;
          }
          const next =
            s.logEntries.length + fresh.length > MAX_BUFFER
              ? [...s.logEntries, ...fresh].slice(-MAX_BUFFER)
              : [...s.logEntries, ...fresh];
          // Stats incrementales por categoría (1 sola pasada). Solo
          // contamos los `fresh` (no-duplicados), si no, las stats
          // aumentaban por entries que ya fueron contados al snapshot.
          const statsDelta: Record<string, number> = {};
          for (const e of fresh) {
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
            logStatsTotal: s.logStatsTotal + fresh.length,
            logUnreadCount: s.logAutoScroll
              ? 0
              : s.logUnreadCount + fresh.length,
          };
        });
    }
    scheduleFlush();
  },

  updateLogEntry: (update) =>
    set((s) => {
      const idx = s.logEntries.findIndex((e) => e.id === update.id);
      if (idx === -1) {
        // La entry referenciada no está en el buffer — puede haber
        // sido trimmeada por MAX_BUFFER. Nada que actualizar.
        return s;
      }
      const original = s.logEntries[idx]!;
      const updated: LogEntry = {
        ...original,
        ts: update.ts,
        count: update.count,
      };
      // Mover al final: remover de su posición + concatenar al final.
      const next = [
        ...s.logEntries.slice(0, idx),
        ...s.logEntries.slice(idx + 1),
        updated,
      ];
      return {
        logEntries: next,
        // No incrementar logUnreadCount — es UPDATE, no un mensaje nuevo.
      };
    }),

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
  setLogSearch: (logSearch) => {
    savePersistedSearch(logSearch);
    set({ logSearch });
  },
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
