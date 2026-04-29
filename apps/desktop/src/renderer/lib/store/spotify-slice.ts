import type { StateCreator } from 'zustand';
import type {
  SpotifyAccount,
  SpotifyConfig,
  SpotifyDevice,
  SpotifyNowPlaying,
  SpotifyQueueItem,
  SpotifyStatus,
} from '@maru/shared';

const DEFAULT_STATUS: SpotifyStatus = {
  connected: false,
  available: true,
  account: null,
  rateLimited: false,
};

const DEFAULT_NOW: SpotifyNowPlaying = { isPlaying: false };

const DEFAULT_CONFIG: SpotifyConfig = {
  enabled: false,
  max_queue: 5,
  tts_enabled: true,
  device_id: '',
  enabled_commands: ['play', 'skip', 'cola', 'pause', 'playfan'],
  priority_users: {},
};

export interface SpotifySlice {
  spotifyStatus: SpotifyStatus;
  spotifyNow: SpotifyNowPlaying;
  spotifyQueue: SpotifyQueueItem[];
  spotifyDevices: SpotifyDevice[];
  spotifyAccounts: SpotifyAccount[];
  spotifyConfig: SpotifyConfig;
  spotifyLoadStatus: 'idle' | 'loading' | 'ready' | 'error';

  setSpotifyStatus: (s: SpotifyStatus) => void;
  setSpotifyNow: (n: SpotifyNowPlaying) => void;
  setSpotifyQueue: (q: SpotifyQueueItem[]) => void;
  setSpotifyDevices: (d: SpotifyDevice[]) => void;
  setSpotifyAccounts: (a: SpotifyAccount[]) => void;
  setSpotifyConfig: (c: SpotifyConfig) => void;
  patchSpotifyConfig: (p: Partial<SpotifyConfig>) => void;
  setSpotifyLoadStatus: (s: SpotifySlice['spotifyLoadStatus']) => void;
}

export const createSpotifySlice: StateCreator<
  SpotifySlice,
  [],
  [],
  SpotifySlice
> = (set) => ({
  spotifyStatus: DEFAULT_STATUS,
  spotifyNow: DEFAULT_NOW,
  spotifyQueue: [],
  spotifyDevices: [],
  spotifyAccounts: [],
  spotifyConfig: DEFAULT_CONFIG,
  spotifyLoadStatus: 'idle',

  setSpotifyStatus: (spotifyStatus) => set({ spotifyStatus }),
  setSpotifyNow: (spotifyNow) => set({ spotifyNow }),
  setSpotifyQueue: (spotifyQueue) => set({ spotifyQueue }),
  setSpotifyDevices: (spotifyDevices) => set({ spotifyDevices }),
  setSpotifyAccounts: (spotifyAccounts) => set({ spotifyAccounts }),
  setSpotifyConfig: (spotifyConfig) =>
    set({ spotifyConfig, spotifyLoadStatus: 'ready' }),
  patchSpotifyConfig: (patch) =>
    set((s) => ({ spotifyConfig: { ...s.spotifyConfig, ...patch } })),
  setSpotifyLoadStatus: (spotifyLoadStatus) => set({ spotifyLoadStatus }),
});
