/**
 * `useMinigames` (G10) — hook con catálogo + config + start/stop.
 */

import { useCallback, useEffect } from 'react';
import type {
  MinigameId,
  MinigamesConfig,
  WordBombConfig,
  WordSearchConfig,
} from '@maru/shared';
import { rpcCall } from './rpc.js';
import { useAppStore } from './store/index.js';

export function useMinigames(options?: { autoLoad?: boolean }) {
  const autoLoad = options?.autoLoad ?? true;

  const meta = useAppStore((s) => s.minigamesMeta);
  const config = useAppStore((s) => s.minigamesConfig);
  const state = useAppStore((s) => s.minigamesState);
  const status = useAppStore((s) => s.minigamesStatus);

  const setMeta = useAppStore((s) => s.setMinigamesMeta);
  const setConfig = useAppStore((s) => s.setMinigamesConfig);
  const patchConfig = useAppStore((s) => s.patchMinigamesConfig);
  const setState = useAppStore((s) => s.setMinigamesState);
  const setStatus = useAppStore((s) => s.setMinigamesStatus);

  const loadAll = useCallback(async () => {
    setStatus('loading');
    try {
      const [m, c, s] = await Promise.all([
        rpcCall('minigames.meta', {}),
        rpcCall('minigames.config.get', {}),
        rpcCall('minigames.state', {}),
      ]);
      setMeta(m);
      setConfig(c.config);
      setState(s);
    } catch {
      setStatus('error');
    }
  }, [setMeta, setConfig, setState, setStatus]);

  useEffect(() => {
    if (!autoLoad) return;
    if (status === 'idle') void loadAll();
  }, [autoLoad, status, loadAll]);

  const saveConfig = useCallback(
    async (patch: Partial<MinigamesConfig>) => {
      const res = await rpcCall('minigames.config.set', { patch });
      setConfig(res.config);
      return res.config;
    },
    [setConfig],
  );

  const start = useCallback(
    async (id: MinigameId, configOverride?: WordSearchConfig | WordBombConfig) => {
      const res = await rpcCall('minigames.start', {
        id,
        config: configOverride,
      });
      const newState = await rpcCall('minigames.state', {});
      setState(newState);
      return res;
    },
    [setState],
  );

  const stop = useCallback(async () => {
    const res = await rpcCall('minigames.stop', {});
    setState({ active: false });
    return res;
  }, [setState]);

  return {
    meta,
    config,
    state,
    status,
    loadAll,
    patchConfig,
    saveConfig,
    start,
    stop,
  };
}
