/**
 * `useSounds` (G10) — hook con CRUD de biblioteca + asignación a gifts/eventos.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { SoundEvent } from '@maru/shared';
import { rpcCall } from './rpc.js';
import { useAppStore } from './store/index.js';

const EMPTY_SOUNDS = {
  scope: 'global',
  library: [],
  gifts: {},
  events: { follow: '', share: '', superfan: '' } as Record<SoundEvent, string>,
  volume: 80,
};

export function useSounds(scope: string, options?: { autoLoad?: boolean }) {
  const autoLoad = options?.autoLoad ?? true;

  const buckets = useAppStore((s) => s.soundsBuckets);
  const status = useAppStore((s) => s.soundsStatus[scope] ?? 'idle');
  const setBucket = useAppStore((s) => s.setSoundsBucket);
  const patchBucket = useAppStore((s) => s.patchSoundsBucket);
  const setStatus = useAppStore((s) => s.setSoundsStatus);

  const data = buckets[scope] ?? EMPTY_SOUNDS;

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const refresh = useCallback(async () => {
    setStatus(scope, 'loading');
    try {
      const res = await rpcCall('sounds.list', { scope });
      setBucket(scope, res);
    } catch {
      setStatus(scope, 'error');
    }
  }, [scope, setBucket, setStatus]);

  useEffect(() => {
    if (!autoLoad) return;
    if (status === 'idle') void refresh();
  }, [autoLoad, status, refresh]);

  const addToLibrary = useCallback(
    async (paths: string[]) => {
      const res = await rpcCall('sounds.library.add', { scope, paths });
      patchBucket(scope, { library: res.library });
      return res;
    },
    [scope, patchBucket],
  );

  const removeFromLibrary = useCallback(
    async (path: string) => {
      await rpcCall('sounds.library.remove', { scope, path });
      await refresh();
    },
    [scope, refresh],
  );

  const assignGift = useCallback(
    async (giftId: string, path: string) => {
      const res = await rpcCall('sounds.assign-gift', { scope, giftId, path });
      patchBucket(scope, {
        gifts: { ...data.gifts, [giftId]: path },
      });
      return res;
    },
    [scope, patchBucket, data.gifts],
  );

  const assignEvent = useCallback(
    async (event: SoundEvent, path: string) => {
      const res = await rpcCall('sounds.assign-event', { scope, event, path });
      patchBucket(scope, {
        events: { ...data.events, [event]: path },
      });
      return res;
    },
    [scope, patchBucket, data.events],
  );

  const setVolume = useCallback(
    async (volume: number) => {
      patchBucket(scope, { volume });
      await rpcCall('sounds.set-volume', { scope, volume });
    },
    [scope, patchBucket],
  );

  /**
   * Reproduce un sonido localmente (renderer Web Audio).
   * Usa el `maru://` protocol no es necesario porque los paths son
   * absolutos al filesystem — los pasamos como `file:///...` a HTMLAudio.
   */
  const playLocal = useCallback(
    (path: string, volume?: number) => {
      if (!path) return;
      try {
        if (audioRef.current) {
          audioRef.current.pause();
        }
        const audio = new Audio(
          path.startsWith('file:') ? path : `file:///${path}`,
        );
        audio.volume = Math.max(
          0,
          Math.min(1, (volume ?? data.volume) / 100),
        );
        void audio.play().catch(() => undefined);
        audioRef.current = audio;
      } catch {
        /* swallow */
      }
    },
    [data.volume],
  );

  const stopLocal = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, []);

  return {
    scope,
    status,
    library: data.library,
    gifts: data.gifts,
    events: data.events,
    volume: data.volume,
    refresh,
    addToLibrary,
    removeFromLibrary,
    assignGift,
    assignEvent,
    setVolume,
    playLocal,
    stopLocal,
  };
}
