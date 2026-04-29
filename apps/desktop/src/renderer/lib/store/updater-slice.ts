import type { StateCreator } from 'zustand';

/** Espejo en runtime del tipo `UpdateState` del main (sin importar para
 *  evitar cruces de bundle). */
export type UpdaterState =
  | { phase: 'idle' }
  | { phase: 'disabled'; reason: string }
  | { phase: 'checking' }
  | { phase: 'available'; version: string; releaseNotes?: string }
  | { phase: 'not-available'; current: string }
  | {
      phase: 'downloading';
      percent: number;
      transferredBytes: number;
      totalBytes: number;
      bytesPerSecond: number;
    }
  | { phase: 'ready'; version: string }
  | { phase: 'error'; message: string };

export interface UpdaterSlice {
  updater: UpdaterState;
  bannerDismissed: boolean;
  setUpdaterState: (s: UpdaterState) => void;
  dismissBanner: () => void;
}

export const createUpdaterSlice: StateCreator<UpdaterSlice, [], [], UpdaterSlice> = (set) => ({
  updater: { phase: 'idle' },
  bannerDismissed: false,
  setUpdaterState: (s) => set({ updater: s, bannerDismissed: s.phase === 'ready' ? false : undefined as never }),
  dismissBanner: () => set({ bannerDismissed: true }),
});
