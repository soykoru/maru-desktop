/**
 * `useSpotify` (G14) — hook completo para Spotify.
 *
 * Provee status + now-playing + queue + devices + accounts + config +
 * mutations (connect/disconnect/play/skip/toggle/cuentas/queue/priority).
 *
 * Auto-load opcional + poll de now-playing cuando conectado (intervalo
 * conservador 45s — paridad MARU dev mode rate-limit safe).
 */

import { useCallback, useEffect } from 'react';
import type {
  SpotifyConfig,
} from '@maru/shared';
import { rpcCall } from './rpc.js';
import { useAppStore } from './store/index.js';

export function useSpotify(options?: {
  autoLoad?: boolean;
  pollNowPlayingMs?: number;
}) {
  const autoLoad = options?.autoLoad ?? true;
  const pollMs = options?.pollNowPlayingMs ?? 0;

  const status = useAppStore((s) => s.spotifyStatus);
  const now = useAppStore((s) => s.spotifyNow);
  const queue = useAppStore((s) => s.spotifyQueue);
  const devices = useAppStore((s) => s.spotifyDevices);
  const accounts = useAppStore((s) => s.spotifyAccounts);
  const config = useAppStore((s) => s.spotifyConfig);
  const loadStatus = useAppStore((s) => s.spotifyLoadStatus);

  const setStatus = useAppStore((s) => s.setSpotifyStatus);
  const setNow = useAppStore((s) => s.setSpotifyNow);
  const setQueue = useAppStore((s) => s.setSpotifyQueue);
  const setDevices = useAppStore((s) => s.setSpotifyDevices);
  const setAccounts = useAppStore((s) => s.setSpotifyAccounts);
  const setConfig = useAppStore((s) => s.setSpotifyConfig);
  const patchConfigLocal = useAppStore((s) => s.patchSpotifyConfig);
  const setLoadStatus = useAppStore((s) => s.setSpotifyLoadStatus);

  const refreshStatus = useCallback(async () => {
    const s = await rpcCall('spotify.status', {});
    setStatus(s);
  }, [setStatus]);

  const refreshNow = useCallback(async () => {
    try {
      const n = await rpcCall('spotify.now-playing', {});
      setNow(n);
    } catch {
      /* swallow */
    }
  }, [setNow]);

  const refreshQueue = useCallback(async () => {
    try {
      const r = await rpcCall('spotify.queue.list', {});
      setQueue(r.items);
    } catch {
      setQueue([]);
    }
  }, [setQueue]);

  const refreshDevices = useCallback(async () => {
    try {
      const r = await rpcCall('spotify.devices', {});
      setDevices(r.devices);
    } catch {
      setDevices([]);
    }
  }, [setDevices]);

  const refreshAccounts = useCallback(async () => {
    try {
      const r = await rpcCall('spotify.accounts.list', {});
      setAccounts(r.accounts);
    } catch {
      setAccounts([]);
    }
  }, [setAccounts]);

  const loadConfig = useCallback(async () => {
    const r = await rpcCall('spotify.config.get', {});
    setConfig(r.config);
  }, [setConfig]);

  const loadAll = useCallback(async () => {
    setLoadStatus('loading');
    try {
      await Promise.all([
        refreshStatus().catch(() => undefined),
        loadConfig().catch(() => undefined),
        refreshAccounts().catch(() => undefined),
      ]);
      // Solo si conectado, cargar now/queue/devices.
      const s = await rpcCall('spotify.status', {}).catch(() => null);
      if (s?.connected) {
        await Promise.all([
          refreshNow().catch(() => undefined),
          refreshQueue().catch(() => undefined),
          refreshDevices().catch(() => undefined),
        ]);
      }
      setLoadStatus('ready');
    } catch {
      setLoadStatus('error');
    }
  }, [
    setLoadStatus,
    refreshStatus,
    loadConfig,
    refreshAccounts,
    refreshNow,
    refreshQueue,
    refreshDevices,
  ]);

  useEffect(() => {
    if (!autoLoad) return;
    if (loadStatus === 'idle') void loadAll();
  }, [autoLoad, loadStatus, loadAll]);

  // Poll de now-playing cuando conectado.
  useEffect(() => {
    if (!pollMs || pollMs < 100) return;
    if (!status.connected) return;
    void refreshNow();
    const id = window.setInterval(() => void refreshNow(), pollMs);
    return () => window.clearInterval(id);
  }, [pollMs, status.connected, refreshNow]);

  // ── Mutations ──────────────────────────────────────────────────────

  const saveConfig = useCallback(
    async (patch: Partial<SpotifyConfig>) => {
      patchConfigLocal(patch);
      const r = await rpcCall('spotify.config.set', { patch });
      if (!r.ok) throw new Error('config_set falló');
      setConfig(r.config);
    },
    [patchConfigLocal, setConfig],
  );

  const connect = useCallback(
    async (clientId?: string, clientSecret?: string) => {
      const r = await rpcCall('spotify.connect', { clientId, clientSecret });
      await refreshStatus();
      return r;
    },
    [refreshStatus],
  );

  const disconnect = useCallback(async () => {
    await rpcCall('spotify.disconnect', {});
    await refreshStatus();
    setNow({ isPlaying: false });
    setQueue([]);
    setDevices([]);
  }, [refreshStatus, setNow, setQueue, setDevices]);

  const playRequest = useCallback(
    async (user: string, query: string, priority = false) => {
      return rpcCall('spotify.play-request', { user, query, priority });
    },
    [],
  );

  const skip = useCallback(async () => rpcCall('spotify.skip', {}), []);
  const togglePlayback = useCallback(
    async () => rpcCall('spotify.toggle-playback', {}),
    [],
  );

  const queueClear = useCallback(async () => {
    if (!confirm('¿Vaciar la cola de reproducción?')) return;
    const r = await rpcCall('spotify.queue.clear', {});
    await refreshQueue();
    return r;
  }, [refreshQueue]);

  const queueRemove = useCallback(
    async (trackId: string) => {
      const r = await rpcCall('spotify.queue.remove', { trackId });
      await refreshQueue();
      return r;
    },
    [refreshQueue],
  );

  const accountSave = useCallback(
    async (name: string) => {
      const r = await rpcCall('spotify.accounts.save', { name });
      await refreshAccounts();
      return r;
    },
    [refreshAccounts],
  );

  const accountLoad = useCallback(
    async (name: string) => {
      const r = await rpcCall('spotify.accounts.load', { name });
      await refreshAccounts();
      await refreshStatus();
      return r;
    },
    [refreshAccounts, refreshStatus],
  );

  const accountDelete = useCallback(
    async (name: string) => {
      if (!confirm(`¿Eliminar la cuenta "${name}"?`)) return;
      const r = await rpcCall('spotify.accounts.delete', { name });
      await refreshAccounts();
      return r;
    },
    [refreshAccounts],
  );

  const priorityUserSet = useCallback(
    async (username: string, uses: number) => {
      const r = await rpcCall('spotify.priority-user.set', { username, uses });
      await loadConfig();
      return r;
    },
    [loadConfig],
  );

  const priorityUserRemove = useCallback(
    async (username: string) => {
      const r = await rpcCall('spotify.priority-user.remove', { username });
      await loadConfig();
      return r;
    },
    [loadConfig],
  );

  return {
    // state
    status,
    now,
    queue,
    devices,
    accounts,
    config,
    loadStatus,
    // loaders
    loadAll,
    refreshStatus,
    refreshNow,
    refreshQueue,
    refreshDevices,
    refreshAccounts,
    loadConfig,
    // mutations
    saveConfig,
    connect,
    disconnect,
    playRequest,
    skip,
    togglePlayback,
    queueClear,
    queueRemove,
    accountSave,
    accountLoad,
    accountDelete,
    priorityUserSet,
    priorityUserRemove,
  };
}
