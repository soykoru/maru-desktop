/**
 * `useData` — hook que cablea el slice `data` con el sidecar.
 *
 * Provee CRUD optimista por (gameId, kind), search local + RPC,
 * import/export, test entry, tutorial.
 *
 * El hook es bucket-aware: cada combinación `(gameId, kind)` tiene su
 * propio bucket en memoria, así que se puede tener varios DataDialog
 * abiertos sin invalidarse entre sí.
 */

import { useCallback, useEffect, useMemo } from 'react';
import type { DataEntry, DataKind, GameId } from '@maru/shared';
import { rpcCall } from './rpc.js';
import { useAppStore } from './store/index.js';
import { dataKey } from './store/data-slice.js';

export interface UseDataResult {
  entries: DataEntry[];
  total: number;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  search: string;
  selectedName: string | null;
  selectedEntry: DataEntry | null;

  setSearch: (q: string) => void;
  setSelectedName: (name: string | null) => void;

  refresh: () => Promise<void>;
  upsert: (entry: DataEntry, previousName?: string) => Promise<DataEntry>;
  remove: (name: string) => Promise<void>;
  /** v1.0.91+ — borrado masivo atómico (1 backup + 1 write para N nombres). */
  bulkRemove: (names: string[]) => Promise<{
    removed: number;
    remaining: number;
    missing: string[];
  }>;
  importEntries: (
    entries: (DataEntry | string)[],
    replace?: boolean,
  ) => Promise<{ added: number; total: number }>;
  exportEntries: () => Promise<DataEntry[]>;

  /** Disparar acción real contra el juego (spawn/give_item/trigger_event). */
  testEntry: (entry: DataEntry) => Promise<{ ok: boolean; message: string }>;
  /** Lee tutorial declarado en games.json. */
  loadTutorial: () => Promise<string>;
}

export function useData(
  gameId: GameId | null,
  kind: DataKind,
  options?: { autoLoad?: boolean },
): UseDataResult {
  const autoLoad = options?.autoLoad ?? true;
  const key = gameId ? dataKey(gameId, kind) : null;

  const bucket = useAppStore((s) =>
    key ? s.dataBuckets[key] : undefined,
  );
  const setBucket = useAppStore((s) => s.setDataBucket);
  const setEntries = useAppStore((s) => s.setDataEntries);
  const upsertLocal = useAppStore((s) => s.upsertDataEntryLocal);
  const removeLocal = useAppStore((s) => s.removeDataEntryLocal);

  const status = bucket?.status ?? 'idle';
  const error = bucket?.error ?? null;
  const entries = bucket?.entries ?? [];
  const total = bucket?.total ?? 0;
  const search = bucket?.search ?? '';
  const selectedName = bucket?.selectedName ?? null;

  const refresh = useCallback(async () => {
    if (!gameId || !key) return;
    setBucket(key, { status: 'loading' });
    try {
      const res = await rpcCall('data.list', { gameId, kind });
      setEntries(key, res.entries, res.total);
    } catch (ex) {
      setBucket(key, {
        status: 'error',
        error: ex instanceof Error ? ex.message : String(ex),
      });
    }
  }, [gameId, kind, key, setBucket, setEntries]);

  const upsert = useCallback(
    async (entry: DataEntry, previousName?: string) => {
      if (!gameId || !key) throw new Error('gameId requerido');
      upsertLocal(key, entry, previousName);
      try {
        const res = await rpcCall('data.upsert', {
          gameId,
          kind,
          entry,
          previousName,
        });
        upsertLocal(key, res.entry, previousName);
        return res.entry;
      } catch (ex) {
        await refresh();
        throw ex;
      }
    },
    [gameId, kind, key, refresh, upsertLocal],
  );

  const remove = useCallback(
    async (name: string) => {
      if (!gameId || !key) return;
      removeLocal(key, name);
      try {
        await rpcCall('data.delete', { gameId, kind, name });
      } catch (ex) {
        await refresh();
        throw ex;
      }
    },
    [gameId, kind, key, refresh, removeLocal],
  );

  const bulkRemove = useCallback(
    /**
     * v1.0.91+ — borrado masivo atómico de N entries seleccionadas.
     * Hace UN solo backup + UN write en disco (vs N si llamamos `remove`
     * en loop). Optimista: actualiza el store local antes de la respuesta;
     * si falla, refrescamos el bucket entero.
     */
    async (names: string[]) => {
      if (!gameId || !key) {
        return { removed: 0, remaining: 0, missing: names };
      }
      const targets = Array.from(
        new Set(names.map((n) => n.trim()).filter(Boolean)),
      );
      if (targets.length === 0) {
        return { removed: 0, remaining: 0, missing: [] };
      }
      // Optimista: quitamos las entries del bucket local.
      for (const n of targets) removeLocal(key, n);
      try {
        const res = await rpcCall('data.bulk-delete', {
          gameId,
          kind,
          names: targets,
        });
        return res;
      } catch (ex) {
        await refresh();
        throw ex;
      }
    },
    [gameId, kind, key, refresh, removeLocal],
  );

  const importEntries = useCallback(
    async (input: (DataEntry | string)[], replace = false) => {
      if (!gameId) throw new Error('gameId requerido');
      const res = await rpcCall('data.import', {
        gameId,
        kind,
        entries: input,
        replace,
      });
      await refresh();
      return res;
    },
    [gameId, kind, refresh],
  );

  const exportEntries = useCallback(async () => {
    if (!gameId) return [];
    const res = await rpcCall('data.export', { gameId, kind });
    return res.entries;
  }, [gameId, kind]);

  const testEntry = useCallback(
    async (entry: DataEntry) => {
      if (!gameId) return { ok: false, message: 'gameId requerido' };
      // Mapear kind → método del juego.
      if (kind === 'items') {
        return rpcCall('games.give-item', {
          gameId,
          item: entry.command,
          amount: 1,
          user: 'TestUser',
        });
      }
      if (kind === 'events') {
        return rpcCall('games.trigger-event', {
          gameId,
          event: entry.command,
          user: 'TestUser',
        });
      }
      return rpcCall('games.spawn', {
        gameId,
        entity: entry.command,
        amount: 1,
        user: 'TestUser',
      });
    },
    [gameId, kind],
  );

  const loadTutorial = useCallback(async () => {
    if (!gameId) return '';
    const res = await rpcCall('data.tutorial', { gameId, kind });
    return res.text;
  }, [gameId, kind]);

  const setSearch = useCallback(
    (q: string) => key && setBucket(key, { search: q }),
    [key, setBucket],
  );
  const setSelectedName = useCallback(
    (name: string | null) =>
      key && setBucket(key, { selectedName: name }),
    [key, setBucket],
  );

  useEffect(() => {
    if (!autoLoad || !gameId || !key) return;
    if (status === 'idle') void refresh();
  }, [autoLoad, gameId, key, status, refresh]);

  const visibleEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.command.toLowerCase().includes(q),
    );
  }, [entries, search]);

  const selectedEntry = useMemo(
    () => entries.find((e) => e.name === selectedName) ?? null,
    [entries, selectedName],
  );

  return {
    entries: visibleEntries,
    total,
    status,
    error,
    search,
    selectedName,
    selectedEntry,
    setSearch,
    setSelectedName,
    refresh,
    upsert,
    remove,
    bulkRemove,
    importEntries,
    exportEntries,
    testEntry,
    loadTutorial,
  };
}
