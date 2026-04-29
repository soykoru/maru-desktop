import type { StateCreator } from 'zustand';
import type { DataEntry, DataKind, GameId } from '@maru/shared';

/**
 * Slice de catálogo de datos (G5).
 *
 * Estado por (gameId, kind) — la key compuesta `${gid}::${kind}` permite
 * tener varios catálogos abiertos en memoria sin invalidarse entre sí
 * cuando el usuario cambia de tab o de juego.
 */
export type DataKey = `${string}::${string}`;
export const dataKey = (gid: GameId, kind: DataKind): DataKey =>
  `${gid}::${kind}` as DataKey;

export interface DataBucket {
  entries: DataEntry[];
  total: number;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  search: string;
  selectedName: string | null;
}

const EMPTY_BUCKET: DataBucket = {
  entries: [],
  total: 0,
  status: 'idle',
  error: null,
  search: '',
  selectedName: null,
};

export interface DataSlice {
  /** Mapa por `${gameId}::${kind}` para soportar varios catálogos. */
  dataBuckets: Record<DataKey, DataBucket>;

  setDataBucket: (key: DataKey, patch: Partial<DataBucket>) => void;
  setDataEntries: (
    key: DataKey,
    entries: DataEntry[],
    total?: number,
  ) => void;
  upsertDataEntryLocal: (
    key: DataKey,
    entry: DataEntry,
    previousName?: string,
  ) => void;
  removeDataEntryLocal: (key: DataKey, name: string) => void;
}

function ensure(buckets: Record<DataKey, DataBucket>, key: DataKey): DataBucket {
  return buckets[key] ?? EMPTY_BUCKET;
}

export const createDataSlice: StateCreator<DataSlice, [], [], DataSlice> = (
  set,
) => ({
  dataBuckets: {},

  setDataBucket: (key, patch) =>
    set((s) => ({
      dataBuckets: {
        ...s.dataBuckets,
        [key]: { ...ensure(s.dataBuckets, key), ...patch },
      },
    })),

  setDataEntries: (key, entries, total) =>
    set((s) => ({
      dataBuckets: {
        ...s.dataBuckets,
        [key]: {
          ...ensure(s.dataBuckets, key),
          entries,
          total: total ?? entries.length,
          status: 'ready',
          error: null,
        },
      },
    })),

  upsertDataEntryLocal: (key, entry, previousName) =>
    set((s) => {
      const bucket = ensure(s.dataBuckets, key);
      const target = previousName ?? entry.name;
      const idx = bucket.entries.findIndex((e) => e.name === target);
      const next =
        idx === -1
          ? [...bucket.entries, entry]
          : bucket.entries.map((e, i) => (i === idx ? entry : e));
      return {
        dataBuckets: {
          ...s.dataBuckets,
          [key]: { ...bucket, entries: next, total: next.length },
        },
      };
    }),

  removeDataEntryLocal: (key, name) =>
    set((s) => {
      const bucket = ensure(s.dataBuckets, key);
      const next = bucket.entries.filter((e) => e.name !== name);
      return {
        dataBuckets: {
          ...s.dataBuckets,
          [key]: {
            ...bucket,
            entries: next,
            total: next.length,
            selectedName:
              bucket.selectedName === name ? null : bucket.selectedName,
          },
        },
      };
    }),
});
