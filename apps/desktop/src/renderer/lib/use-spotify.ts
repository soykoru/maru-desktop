/**
 * `useSpotify` (G14) — hook completo para Spotify.
 *
 * Provee status + now-playing + queue + devices + accounts + config +
 * mutations (connect/disconnect/play/skip/toggle/cuentas/queue/priority).
 *
 * Auto-load opcional + poll de now-playing cuando conectado (intervalo
 * conservador 45s — paridad MARU dev mode rate-limit safe).
 */

import { useCallback, useEffect, useState } from 'react';
import type {
  SpotifyConfig,
  SpotifySuperFan,
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

  // ── Super fans (sync auto desde TikTok is_super_fan) ───────────────

  const [superFans, setSuperFansState] = useState<SpotifySuperFan[]>([]);
  const [defaultUses, setDefaultUses] = useState<number>(5);

  const refreshSuperFans = useCallback(async () => {
    try {
      const r = await rpcCall('spotify.super-fans.list', {});
      setSuperFansState((r.items as SpotifySuperFan[]) ?? []);
      if (typeof r.defaultUses === 'number') setDefaultUses(r.defaultUses);
    } catch {
      setSuperFansState([]);
    }
  }, []);

  const setSuperFanUses = useCallback(
    async (username: string, uses: number) => {
      // Optimistic local update — recalculamos `remaining` con el nuevo
      // tope para que el badge "X/Y" no muestre un máximo desfasado.
      setSuperFansState((prev) =>
        prev.map((sf) =>
          sf.username === username
            ? { ...sf, uses, remaining: Math.max(0, uses - sf.usedToday) }
            : sf,
        ),
      );
      try {
        const r = await rpcCall('spotify.super-fans.set-uses', {
          username,
          uses,
        });
        if (!r.ok) {
          await refreshSuperFans();
          throw new Error(r.message ?? 'no se pudo actualizar');
        }
        return r;
      } catch (e) {
        await refreshSuperFans();
        throw e;
      }
    },
    [refreshSuperFans],
  );

  const removeSuperFan = useCallback(
    async (username: string) => {
      // Optimistic local update — quitamos al user de la lista visible.
      setSuperFansState((prev) => prev.filter((sf) => sf.username !== username));
      try {
        const r = await rpcCall('spotify.super-fans.remove', { username });
        if (!r.ok) {
          await refreshSuperFans();
          throw new Error(r.message ?? 'no se pudo borrar');
        }
        return r;
      } catch (e) {
        await refreshSuperFans();
        throw e;
      }
    },
    [refreshSuperFans],
  );

  const setPlayfanDefaultUses = useCallback(async (uses: number) => {
    setDefaultUses(uses);
    const r = await rpcCall('spotify.playfan-default.set', { uses });
    if (!r.ok) throw new Error('no se pudo guardar default');
    if (typeof r.defaultUses === 'number') setDefaultUses(r.defaultUses);
    return r;
  }, []);

  // Auto-load + refresh periódico cuando el dialog está abierto.
  useEffect(() => {
    if (!autoLoad) return;
    void refreshSuperFans();
    // Re-poll cada 30s mientras el dialog esté abierto, así si el
    // sidecar detecta nuevos super fans en el live aparecen sin que
    // el usuario tenga que recargar.
    const id = window.setInterval(() => void refreshSuperFans(), 30_000);
    return () => window.clearInterval(id);
  }, [autoLoad, refreshSuperFans]);

  // Push event `spotify:playfan-state` — cuando un user gasta un
  // !playfan o se dispara el reset diario, el sidecar nos avisa para
  // repintar el contador sin esperar al próximo poll de 30s.
  useEffect(() => {
    if (!autoLoad) return;
    const off = window.maruApi.on(
      'spotify:playfan-state' as never,
      (payload: unknown) => {
        const p = (payload ?? {}) as { used?: Record<string, number> };
        const used = p.used ?? {};
        setSuperFansState((prev) =>
          prev.map((sf) => {
            const ut = Math.max(0, Number(used[sf.username] ?? 0));
            return {
              ...sf,
              usedToday: ut,
              remaining: Math.max(0, sf.uses - ut),
            };
          }),
        );
      },
    );
    return () => {
      try {
        off?.();
      } catch {
        /* swallow */
      }
    };
  }, [autoLoad]);

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
    // super fans
    superFans,
    defaultUses,
    refreshSuperFans,
    setSuperFanUses,
    removeSuperFan,
    setPlayfanDefaultUses,
  };
}
