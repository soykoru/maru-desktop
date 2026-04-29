/**
 * `useGames` — hook que cablea el slice `games` con el sidecar via JSON-RPC.
 *
 * Provee:
 *   - Auto-load on mount.
 *   - CRUD optimista: createCustom / updateGame / deleteCustom / duplicate.
 *   - Configure de connection (atajo a games.configure).
 *   - Test connection (con o sin override de connection ad-hoc).
 *   - Helpers derivados: predefinidos, custom, lookup por id.
 */

import { useCallback, useEffect, useMemo } from 'react';
import type {
  CreateCustomGameInput,
  GameConnection,
  GameId,
  GameProfile,
  UpdateGameInput,
} from '@maru/shared';
import { rpcCall } from './rpc.js';
import { useAppStore } from './store/index.js';

export interface UseGamesResult {
  games: GameProfile[];
  predefined: GameProfile[];
  custom: GameProfile[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  byId: (id: GameId) => GameProfile | null;

  refresh: () => Promise<void>;
  configure: (id: GameId, connection: GameConnection) => Promise<GameProfile>;
  updateGame: (id: GameId, patch: UpdateGameInput) => Promise<GameProfile>;
  createCustom: (input: CreateCustomGameInput) => Promise<GameProfile>;
  duplicate: (
    sourceId: GameId | 'empty',
    newId: GameId,
    newName: string,
    shareSounds: boolean,
    shareVoices: boolean,
  ) => Promise<GameProfile>;
  deleteCustom: (id: GameId) => Promise<{ ok: true; deletedFiles: string[] }>;
  testConnection: (
    id: GameId,
    connection?: GameConnection,
  ) => Promise<{ ok: boolean; message: string }>;

  selectedId: GameId | null;
  setSelectedId: (id: GameId | null) => void;
}

export function useGames(options?: { autoLoad?: boolean }): UseGamesResult {
  const autoLoad = options?.autoLoad ?? true;

  const games = useAppStore((s) => s.games);
  const status = useAppStore((s) => s.gamesStatus);
  const error = useAppStore((s) => s.gamesError);
  const selectedId = useAppStore((s) => s.selectedGameId);

  const setGames = useAppStore((s) => s.setGames);
  const setStatus = useAppStore((s) => s.setGamesStatus);
  const setError = useAppStore((s) => s.setGamesError);
  const upsertLocal = useAppStore((s) => s.upsertGameLocal);
  const removeLocal = useAppStore((s) => s.removeGameLocal);
  const setSelectedId = useAppStore((s) => s.setSelectedGameId);

  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await rpcCall('games.list', {});
      setGames(res.games);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    }
  }, [setGames, setError, setStatus]);

  const configure = useCallback(
    async (id: GameId, connection: GameConnection) => {
      const res = await rpcCall('games.configure', { gameId: id, connection });
      upsertLocal(res.profile);
      return res.profile;
    },
    [upsertLocal],
  );

  const updateGame = useCallback(
    async (id: GameId, patch: UpdateGameInput) => {
      const res = await rpcCall('games.update', { gameId: id, patch });
      upsertLocal(res.profile);
      return res.profile;
    },
    [upsertLocal],
  );

  const createCustom = useCallback(
    async (input: CreateCustomGameInput) => {
      const res = await rpcCall('games.create-custom', { profile: input });
      upsertLocal(res.profile);
      return res.profile;
    },
    [upsertLocal],
  );

  const duplicate = useCallback(
    async (
      sourceId: GameId | 'empty',
      newId: GameId,
      newName: string,
      shareSounds: boolean,
      shareVoices: boolean,
    ) => {
      const res = await rpcCall('games.duplicate', {
        sourceId,
        newId,
        newName,
        shareSounds,
        shareVoices,
      });
      upsertLocal(res.profile);
      return res.profile;
    },
    [upsertLocal],
  );

  const deleteCustom = useCallback(
    async (id: GameId) => {
      removeLocal(id);
      try {
        return await rpcCall('games.delete-custom', { gameId: id });
      } catch (ex) {
        await refresh();
        throw ex;
      }
    },
    [removeLocal, refresh],
  );

  const testConnection = useCallback(
    async (id: GameId, connection?: GameConnection) => {
      return rpcCall('games.test', { gameId: id, connection });
    },
    [],
  );

  useEffect(() => {
    if (!autoLoad) return;
    if (status === 'idle') void refresh();
  }, [autoLoad, status, refresh]);

  const predefined = useMemo(
    () => games.filter((g) => g.isStandard),
    [games],
  );
  const custom = useMemo(
    () => games.filter((g) => !g.isStandard),
    [games],
  );

  const byId = useCallback(
    (id: GameId): GameProfile | null =>
      games.find((g) => g.id === id) ?? null,
    [games],
  );

  return {
    games,
    predefined,
    custom,
    status,
    error,
    byId,
    refresh,
    configure,
    updateGame,
    createCustom,
    duplicate,
    deleteCustom,
    testConnection,
    selectedId,
    setSelectedId,
  };
}
