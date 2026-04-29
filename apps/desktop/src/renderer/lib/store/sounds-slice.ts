import type { StateCreator } from 'zustand';
import type { SoundsConfig } from '@maru/shared';

const EMPTY: SoundsConfig = {
  scope: 'global',
  library: [],
  gifts: {},
  events: { follow: '', share: '', superfan: '' },
  volume: 80,
};

export interface SoundsSlice {
  /** Buckets por scope ('global' o gameId). */
  soundsBuckets: Record<string, SoundsConfig>;
  soundsStatus: Record<string, 'idle' | 'loading' | 'ready' | 'error'>;

  setSoundsBucket: (scope: string, cfg: SoundsConfig) => void;
  patchSoundsBucket: (scope: string, patch: Partial<SoundsConfig>) => void;
  setSoundsStatus: (
    scope: string,
    status: SoundsSlice['soundsStatus'][string],
  ) => void;
}

export const createSoundsSlice: StateCreator<
  SoundsSlice,
  [],
  [],
  SoundsSlice
> = (set) => ({
  soundsBuckets: {},
  soundsStatus: {},
  setSoundsBucket: (scope, cfg) =>
    set((s) => ({
      soundsBuckets: { ...s.soundsBuckets, [scope]: cfg },
      soundsStatus: { ...s.soundsStatus, [scope]: 'ready' },
    })),
  patchSoundsBucket: (scope, patch) =>
    set((s) => ({
      soundsBuckets: {
        ...s.soundsBuckets,
        [scope]: { ...(s.soundsBuckets[scope] ?? EMPTY), ...patch },
      },
    })),
  setSoundsStatus: (scope, status) =>
    set((s) => ({
      soundsStatus: { ...s.soundsStatus, [scope]: status },
    })),
});
