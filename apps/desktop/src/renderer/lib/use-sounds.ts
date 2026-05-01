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
   * Reproduce un sonido vía pygame del sidecar (RPC `sounds.play`).
   * Antes esto usaba `new Audio('file:///...')` desde el renderer,
   * pero en Electron empaquetado las restricciones de file:// + CSP
   * + sandbox hacían que la mayoría de los archivos no sonaran.
   * Ahora delegamos al sidecar que ya maneja audio confiablemente
   * con pygame (mismo motor que play_for_gift / play_for_event en
   * producción).
   */
  const playLocal = useCallback(
    async (path: string, volume?: number) => {
      if (!path) return;
      try {
        await rpcCall('sounds.play', {
          path,
          volume: volume ?? data.volume,
        });
      } catch {
        /* swallow */
      }
    },
    [data.volume],
  );

  /** Parar local — alias de stopAll del sidecar (pygame.mixer.stop). */
  const stopLocal = useCallback(async () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    try {
      await rpcCall('sounds.stop-all', {});
    } catch {
      /* swallow */
    }
  }, []);

  /**
   * Detener TODOS los sonidos en reproducción (sidecar pygame +
   * cualquier audio del renderer). Útil para el botón "⏹️ Detener
   * todo" del dialog y para cortar stickers que duran demasiado.
   */
  const stopAll = stopLocal;

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
    stopAll,
  };
}
