/**
 * `useBackups` (G12) — hook con CRUD de backups + last info.
 *
 * Restore se ejecuta SIEMPRE con `autoPreBackup: true` por default
 * (defensa en profundidad — paridad MARU `prerestore`).
 */

import { useCallback, useEffect, useMemo } from 'react';
import type { BackupReason, BackupScope } from '@maru/shared';
import { rpcCall } from './rpc.js';
import { useAppStore } from './store/index.js';

export function useBackups(options?: { autoLoad?: boolean }) {
  const autoLoad = options?.autoLoad ?? true;

  const backups = useAppStore((s) => s.backups);
  const status = useAppStore((s) => s.backupsStatus);
  const error = useAppStore((s) => s.backupsError);
  const scopeFilter = useAppStore((s) => s.backupsScopeFilter);
  const selectedId = useAppStore((s) => s.selectedBackupId);
  const lastBackup = useAppStore((s) => s.lastBackup);

  const setBackups = useAppStore((s) => s.setBackups);
  const setStatus = useAppStore((s) => s.setBackupsStatus);
  const setError = useAppStore((s) => s.setBackupsError);
  const setScopeFilter = useAppStore((s) => s.setBackupsScopeFilter);
  const setSelectedId = useAppStore((s) => s.setSelectedBackupId);
  const setLastBackup = useAppStore((s) => s.setLastBackup);
  const upsertLocal = useAppStore((s) => s.upsertBackupLocal);
  const removeLocal = useAppStore((s) => s.removeBackupLocal);

  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      const [list, last] = await Promise.all([
        rpcCall('backups.list', {}),
        rpcCall('backups.last', {}),
      ]);
      setBackups(list.backups);
      setLastBackup(last.backup);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    }
  }, [setBackups, setLastBackup, setStatus, setError]);

  const create = useCallback(
    async (
      scope: BackupScope,
      label?: string,
      reason: BackupReason = 'manual',
    ) => {
      const res = await rpcCall('backups.create', { scope, label, reason });
      upsertLocal(res.backup);
      setLastBackup(res.backup);
      return res.backup;
    },
    [upsertLocal, setLastBackup],
  );

  const restore = useCallback(
    async (id: string, autoPreBackup = true) => {
      const res = await rpcCall('backups.restore', { id, autoPreBackup });
      if (res.preBackup) {
        upsertLocal(res.preBackup);
        setLastBackup(res.preBackup);
      }
      // Refrescar para reflejar el nuevo pre-backup creado.
      await refresh();
      return res;
    },
    [upsertLocal, setLastBackup, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      removeLocal(id);
      try {
        await rpcCall('backups.delete', { id });
      } catch (ex) {
        await refresh();
        throw ex;
      }
    },
    [removeLocal, refresh],
  );

  useEffect(() => {
    if (!autoLoad) return;
    if (status === 'idle') void refresh();
  }, [autoLoad, status, refresh]);

  // Filtrado por scope.
  const visible = useMemo(() => {
    let out =
      scopeFilter === 'all'
        ? backups
        : backups.filter((b) => b.scope === scopeFilter);
    out = out.slice().sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }, [backups, scopeFilter]);

  const selected = useMemo(
    () => backups.find((b) => b.id === selectedId) ?? null,
    [backups, selectedId],
  );

  return {
    backups,
    visible,
    status,
    error,
    scopeFilter,
    selectedId,
    selected,
    lastBackup,
    setScopeFilter,
    setSelectedId,
    refresh,
    create,
    restore,
    remove,
  };
}
