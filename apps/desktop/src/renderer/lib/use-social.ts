/**
 * `useSocial` — hook que cablea el slice `social` con el sidecar.
 *
 * Provee:
 *   - `loadAll`: hace un fetch parallel de config + users + stats + meta.
 *   - CRUD admin de usuarios (register/unregister/delete/set_racha/...).
 *   - Activación/desactivación auto-racha.
 *   - Refresh de taps con period.
 *   - Reset all (con confirm).
 *   - Save config con patch.
 */

import { useCallback, useEffect, useMemo } from 'react';
import type {
  RelationshipType,
  SocialConfig,
  SocialUser,
  TapsPeriod,
} from '@maru/shared';
import { rpcCall } from './rpc.js';
import { useAppStore } from './store/index.js';

export function useSocial(options?: { autoLoad?: boolean }) {
  const autoLoad = options?.autoLoad ?? true;

  const config = useAppStore((s) => s.socialConfig);
  const users = useAppStore((s) => s.socialUsers);
  const usersStatus = useAppStore((s) => s.socialUsersStatus);
  const usersError = useAppStore((s) => s.socialUsersError);
  const search = useAppStore((s) => s.socialUsersSearch);
  const selectedUsername = useAppStore((s) => s.socialSelectedUsername);
  const stats = useAppStore((s) => s.socialStats);
  const tapsPeriod = useAppStore((s) => s.socialTapsPeriod);
  const tapsRanking = useAppStore((s) => s.socialTapsRanking);
  const tapsTotal = useAppStore((s) => s.socialTapsTotal);
  const commandsMeta = useAppStore((s) => s.socialCommandsMeta);

  const setConfig = useAppStore((s) => s.setSocialConfig);
  const patchConfig = useAppStore((s) => s.patchSocialConfig);
  const setUsers = useAppStore((s) => s.setSocialUsers);
  const setUsersStatus = useAppStore((s) => s.setSocialUsersStatus);
  const setUsersError = useAppStore((s) => s.setSocialUsersError);
  const setSearch = useAppStore((s) => s.setSocialUsersSearch);
  const setSelectedUsername = useAppStore((s) => s.setSocialSelectedUsername);
  const upsertUserLocal = useAppStore((s) => s.upsertSocialUserLocal);
  const removeUserLocal = useAppStore((s) => s.removeSocialUserLocal);
  const setStats = useAppStore((s) => s.setSocialStats);
  const setTaps = useAppStore((s) => s.setSocialTaps);
  const setCommandsMeta = useAppStore((s) => s.setSocialCommandsMeta);

  const loadConfig = useCallback(async () => {
    const res = await rpcCall('social.config.get', {});
    setConfig(res.config);
  }, [setConfig]);

  const loadUsers = useCallback(async () => {
    setUsersStatus('loading');
    try {
      const res = await rpcCall('social.users.list', {});
      setUsers(res.users);
    } catch (ex) {
      setUsersError(ex instanceof Error ? ex.message : String(ex));
    }
  }, [setUsers, setUsersStatus, setUsersError]);

  const loadStats = useCallback(async () => {
    const res = await rpcCall('social.stats', {});
    setStats(res.stats);
  }, [setStats]);

  const loadTaps = useCallback(
    async (period: TapsPeriod) => {
      const res = await rpcCall('social.taps.top', { period });
      setTaps(res.period, res.totalTaps, res.ranking);
    },
    [setTaps],
  );

  const loadCommandsMeta = useCallback(async () => {
    const res = await rpcCall('social.commands.meta', {});
    setCommandsMeta(res.categories);
  }, [setCommandsMeta]);

  const loadAll = useCallback(async () => {
    await Promise.all([
      loadConfig().catch(() => undefined),
      loadCommandsMeta().catch(() => undefined),
      loadStats().catch(() => undefined),
      loadUsers(),
      loadTaps(tapsPeriod).catch(() => undefined),
    ]);
  }, [loadConfig, loadCommandsMeta, loadStats, loadUsers, loadTaps, tapsPeriod]);

  useEffect(() => {
    if (!autoLoad) return;
    if (usersStatus === 'idle') void loadAll();
  }, [autoLoad, usersStatus, loadAll]);

  // ── Mutations ──────────────────────────────────────────────────────

  const saveConfig = useCallback(
    async (patch: Partial<SocialConfig>) => {
      patchConfig(patch);
      const res = await rpcCall('social.config.set', { patch });
      if (!res.ok) throw new Error(res.error || 'config_set falló');
      await loadConfig();
    },
    [patchConfig, loadConfig],
  );

  async function reloadUserLocal(username: string) {
    try {
      const res = await rpcCall('social.users.get', { username });
      upsertUserLocal(res.user);
    } catch {
      /* swallow */
    }
  }

  const registerUser = useCallback(
    async (username: string) => {
      const res = await rpcCall('social.users.register', { username });
      if (!res.ok) throw new Error(res.error || 'register falló');
      await reloadUserLocal(username);
    },
    [],
  );

  const unregisterUser = useCallback(async (username: string) => {
    const res = await rpcCall('social.users.unregister', { username });
    if (!res.ok) throw new Error(res.error || 'unregister falló');
    await reloadUserLocal(username);
  }, []);

  const deleteUser = useCallback(
    async (username: string) => {
      removeUserLocal(username);
      try {
        const res = await rpcCall('social.users.delete', { username });
        if (!res.ok) {
          await loadUsers();
          throw new Error(res.error || 'delete falló');
        }
      } catch (ex) {
        await loadUsers();
        throw ex;
      }
    },
    [loadUsers, removeUserLocal],
  );

  const setRacha = useCallback(async (username: string, days: number) => {
    const res = await rpcCall('social.users.set-racha', { username, days });
    if (!res.ok) throw new Error(res.error || 'set-racha falló');
    await reloadUserLocal(username);
  }, []);

  const resetRacha = useCallback(async (username: string) => {
    const res = await rpcCall('social.users.reset-racha', { username });
    if (!res.ok) throw new Error(res.error || 'reset-racha falló');
    await reloadUserLocal(username);
  }, []);

  const resetRelaciones = useCallback(async (username: string) => {
    const res = await rpcCall('social.users.reset-relaciones', { username });
    if (!res.ok) throw new Error(res.error || 'reset-relaciones falló');
    await reloadUserLocal(username);
  }, []);

  const removeMarriage = useCallback(async (username: string) => {
    const res = await rpcCall('social.users.remove-marriage', { username });
    if (!res.ok) throw new Error(res.error || 'remove-marriage falló');
    await reloadUserLocal(username);
  }, []);

  const removeRelationship = useCallback(
    async (username: string, relType: RelationshipType) => {
      const res = await rpcCall('social.users.remove-relationship', {
        username,
        relType,
      });
      if (!res.ok) throw new Error(res.error || 'remove-relationship falló');
      await reloadUserLocal(username);
    },
    [],
  );

  const activateAutoRacha = useCallback(
    async (
      username: string,
      days: number,
      kind: 'manual' | 'super_fan' = 'manual',
    ) => {
      const res = await rpcCall('social.users.activate-auto-racha', {
        username,
        days,
        kind,
      });
      if (!res.ok) throw new Error(res.message);
      await reloadUserLocal(username);
      return res.message;
    },
    [],
  );

  const deactivateAutoRacha = useCallback(async (username: string) => {
    const res = await rpcCall('social.users.deactivate-auto-racha', {
      username,
    });
    if (!res.ok) throw new Error(res.message);
    await reloadUserLocal(username);
    return res.message;
  }, []);

  const cleanupTaps = useCallback(async () => {
    const res = await rpcCall('social.taps.cleanup', {});
    await loadTaps(tapsPeriod);
    return res.removed;
  }, [loadTaps, tapsPeriod]);

  const resetAll = useCallback(async () => {
    const res = await rpcCall('social.reset-all', { confirm: 'DELETE' });
    if (!res.ok) throw new Error(res.message || 'reset-all falló');
    await loadAll();
    return res.resetAt;
  }, [loadAll]);

  // ── Selectors ───────────────────────────────────────────────────────

  const visibleUsers = useMemo<SocialUser[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.username.toLowerCase().includes(q));
  }, [users, search]);

  const selectedUser = useMemo<SocialUser | null>(
    () => users.find((u) => u.username === selectedUsername) ?? null,
    [users, selectedUsername],
  );

  return {
    // state
    config,
    users,
    visibleUsers,
    usersStatus,
    usersError,
    search,
    selectedUsername,
    selectedUser,
    stats,
    tapsPeriod,
    tapsRanking,
    tapsTotal,
    commandsMeta,
    // setters
    setSearch,
    setSelectedUsername,
    // loaders
    loadAll,
    loadConfig,
    loadUsers,
    loadStats,
    loadTaps,
    loadCommandsMeta,
    // mutations
    saveConfig,
    registerUser,
    unregisterUser,
    deleteUser,
    setRacha,
    resetRacha,
    resetRelaciones,
    removeMarriage,
    removeRelationship,
    activateAutoRacha,
    deactivateAutoRacha,
    cleanupTaps,
    resetAll,
  };
}
