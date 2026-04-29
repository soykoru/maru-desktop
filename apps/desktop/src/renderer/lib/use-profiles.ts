/**
 * `useProfiles` (G10) — hook con CRUD de stream profiles.
 */

import { useCallback, useEffect } from 'react';
import type { ProfileSnapshot } from '@maru/shared';
import { rpcCall } from './rpc.js';
import { useAppStore } from './store/index.js';

export function useProfiles(options?: { autoLoad?: boolean }) {
  const autoLoad = options?.autoLoad ?? true;

  const profiles = useAppStore((s) => s.profiles);
  const status = useAppStore((s) => s.profilesStatus);
  const error = useAppStore((s) => s.profilesError);
  const selectedId = useAppStore((s) => s.selectedProfileId);

  const setProfiles = useAppStore((s) => s.setProfiles);
  const setStatus = useAppStore((s) => s.setProfilesStatus);
  const setError = useAppStore((s) => s.setProfilesError);
  const setSelectedId = useAppStore((s) => s.setSelectedProfileId);
  const upsertLocal = useAppStore((s) => s.upsertProfileLocal);
  const removeLocal = useAppStore((s) => s.removeProfileLocal);

  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await rpcCall('profiles.list', {});
      setProfiles(res.profiles);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    }
  }, [setProfiles, setError, setStatus]);

  const save = useCallback(
    async (name: string, description?: string) => {
      const res = await rpcCall('profiles.save', { name, description });
      upsertLocal(res.profile);
      return res.profile;
    },
    [upsertLocal],
  );

  const load = useCallback(async (id: string) => {
    return rpcCall('profiles.load', { id });
  }, []);

  const duplicate = useCallback(
    async (id: string, name: string) => {
      const res = await rpcCall('profiles.duplicate', { id, name });
      upsertLocal(res.profile);
      return res.profile;
    },
    [upsertLocal],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      const res = await rpcCall('profiles.rename', { id, name });
      upsertLocal(res.profile);
      return res.profile;
    },
    [upsertLocal],
  );

  const remove = useCallback(
    async (id: string) => {
      removeLocal(id);
      try {
        await rpcCall('profiles.delete', { id });
      } catch (ex) {
        await refresh();
        throw ex;
      }
    },
    [removeLocal, refresh],
  );

  const exportProfile = useCallback(
    async (id: string): Promise<string> => {
      const res = await rpcCall('profiles.export', { id });
      return res.json;
    },
    [],
  );

  const importProfile = useCallback(
    async (json: string, name?: string): Promise<ProfileSnapshot> => {
      const res = await rpcCall('profiles.import', { json, name });
      upsertLocal(res.profile);
      return res.profile;
    },
    [upsertLocal],
  );

  useEffect(() => {
    if (!autoLoad) return;
    if (status === 'idle') void refresh();
  }, [autoLoad, status, refresh]);

  return {
    profiles,
    status,
    error,
    selectedId,
    setSelectedId,
    refresh,
    save,
    load,
    duplicate,
    rename,
    remove,
    exportProfile,
    importProfile,
  };
}
