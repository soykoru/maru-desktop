/**
 * `useTts` — hook que cablea el slice TTS con el sidecar.
 *
 * Provee load parallel + saveConfig + user voices CRUD optimista +
 * test/speak/stop + clearCache + opcional poll de queueSizes.
 */

import { useCallback, useEffect, useMemo } from 'react';
import type { TtsConfig, TtsVoice } from '@maru/shared';
import { rpcCall } from './rpc.js';
import { useAppStore } from './store/index.js';

export interface UseTtsOptions {
  autoLoad?: boolean;
  /** Si true, polea queue-sizes cada N ms mientras la pestaña esté visible. */
  pollQueueMs?: number;
}

export function useTts(options?: UseTtsOptions) {
  const autoLoad = options?.autoLoad ?? true;
  const pollMs = options?.pollQueueMs ?? 0;

  const voices = useAppStore((s) => s.ttsVoices);
  const families = useAppStore((s) => s.ttsFamilies);
  const voicesStatus = useAppStore((s) => s.ttsVoicesStatus);
  const config = useAppStore((s) => s.ttsConfig);
  const userVoices = useAppStore((s) => s.ttsUserVoices);
  const queueSizes = useAppStore((s) => s.ttsQueueSizes);

  const setVoices = useAppStore((s) => s.setTtsVoices);
  const setVoicesStatus = useAppStore((s) => s.setTtsVoicesStatus);
  const setConfig = useAppStore((s) => s.setTtsConfig);
  const patchConfigLocal = useAppStore((s) => s.patchTtsConfig);
  const setUserVoices = useAppStore((s) => s.setTtsUserVoices);
  const upsertUserVoiceLocal = useAppStore((s) => s.upsertTtsUserVoiceLocal);
  const removeUserVoiceLocal = useAppStore((s) => s.removeTtsUserVoiceLocal);
  const setQueueSizes = useAppStore((s) => s.setTtsQueueSizes);

  const loadVoices = useCallback(async () => {
    setVoicesStatus('loading');
    try {
      const res = await rpcCall('tts.list-voices', {});
      setVoices(res.voices, res.families);
    } catch {
      setVoicesStatus('error');
    }
  }, [setVoices, setVoicesStatus]);

  const loadConfig = useCallback(async () => {
    const res = await rpcCall('tts.config.get', {});
    setConfig(res.config);
  }, [setConfig]);

  const loadUserVoices = useCallback(async () => {
    const res = await rpcCall('tts.user-voices.list', {});
    setUserVoices(res.userVoices);
  }, [setUserVoices]);

  const loadQueueSizes = useCallback(async () => {
    try {
      const res = await rpcCall('tts.queue-sizes', {});
      setQueueSizes(res);
    } catch {
      /* swallow */
    }
  }, [setQueueSizes]);

  const loadAll = useCallback(async () => {
    await Promise.all([
      loadVoices().catch(() => undefined),
      loadConfig().catch(() => undefined),
      loadUserVoices().catch(() => undefined),
    ]);
  }, [loadVoices, loadConfig, loadUserVoices]);

  useEffect(() => {
    if (!autoLoad) return;
    if (voicesStatus === 'idle') void loadAll();
  }, [autoLoad, voicesStatus, loadAll]);

  // Poll opcional de queueSizes.
  useEffect(() => {
    if (!pollMs || pollMs < 100) return;
    void loadQueueSizes();
    const id = window.setInterval(() => void loadQueueSizes(), pollMs);
    return () => window.clearInterval(id);
  }, [pollMs, loadQueueSizes]);

  // ── Mutations ───────────────────────────────────────────────────────

  const saveConfig = useCallback(
    async (patch: Partial<TtsConfig>) => {
      patchConfigLocal(patch);
      const res = await rpcCall('tts.config.set', { patch });
      if (!res.ok) throw new Error('config_set falló');
      setConfig(res.config);
      return res.config;
    },
    [patchConfigLocal, setConfig],
  );

  const assignUserVoice = useCallback(
    async (username: string, voice: string) => {
      const res = await rpcCall('tts.user-voices.upsert', { username, voice });
      upsertUserVoiceLocal({ username: res.username, voice: res.voice });
      return res;
    },
    [upsertUserVoiceLocal],
  );

  const removeUserVoice = useCallback(
    async (username: string) => {
      removeUserVoiceLocal(username);
      try {
        await rpcCall('tts.user-voices.delete', { username });
      } catch (ex) {
        await loadUserVoices();
        throw ex;
      }
    },
    [removeUserVoiceLocal, loadUserVoices],
  );

  const clearAllUserVoices = useCallback(async () => {
    if (!confirm('¿Eliminar TODAS las asignaciones user→voz?')) return 0;
    const res = await rpcCall('tts.user-voices.clear', {});
    setUserVoices([]);
    return res.removed;
  }, [setUserVoices]);

  const test = useCallback(
    async (params: { voice?: string; text?: string; username?: string }) => {
      return rpcCall('tts.test', params);
    },
    [],
  );

  const speak = useCallback(
    async (params: {
      text: string;
      channel?: 'chat' | 'social' | 'fortune';
      voice?: string;
      user?: string;
    }) => {
      return rpcCall('tts.speak', params);
    },
    [],
  );

  const stop = useCallback(async () => {
    return rpcCall('tts.stop', {});
  }, []);

  const clearCache = useCallback(async () => {
    return rpcCall('tts.clear-cache', {});
  }, []);

  // ── Selectores ──────────────────────────────────────────────────────

  const voicesByFamily = useMemo(() => {
    const out: Record<string, TtsVoice[]> = {};
    for (const v of voices) {
      const fam = v.family || 'other';
      (out[fam] ??= []).push(v);
    }
    return out;
  }, [voices]);

  function findVoice(id: string): TtsVoice | null {
    return voices.find((v) => v.id === id) ?? null;
  }

  return {
    // state
    voices,
    voicesByFamily,
    families,
    voicesStatus,
    config,
    userVoices,
    queueSizes,
    // helpers
    findVoice,
    // loaders
    loadAll,
    loadVoices,
    loadConfig,
    loadUserVoices,
    loadQueueSizes,
    // mutations
    saveConfig,
    assignUserVoice,
    removeUserVoice,
    clearAllUserVoices,
    test,
    speak,
    stop,
    clearCache,
  };
}
