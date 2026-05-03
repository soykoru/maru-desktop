import type { StateCreator } from 'zustand';
import type { ConnectionStatus, TikTokEvent, TikTokStats } from '@maru/shared';

const MAX_FEED = 200;

export interface TikTokSlice {
  tiktokStatus: ConnectionStatus;
  tiktokUsername: string | null;
  /** Avatar URL del streamer (host del live). Llega del sidecar via
   *  `tiktok:status` cuando el handshake recupera `room_info`. Vacío
   *  hasta que conecte. */
  tiktokAvatarUrl: string;
  tiktokStats: TikTokStats;
  tiktokFeed: TikTokEvent[];
  tiktokError: string | null;
  setTikTokStatus: (
    status: ConnectionStatus,
    username?: string | null,
    avatarUrl?: string,
  ) => void;
  pushTikTokEvent: (event: TikTokEvent) => void;
  setTikTokStats: (stats: TikTokStats) => void;
  setTikTokError: (message: string | null) => void;
  clearTikTokFeed: () => void;
}

const emptyStats: TikTokStats = { viewers: 0, likes: 0, diamonds: 0, followers: 0, shares: 0 };

export const createTikTokSlice: StateCreator<TikTokSlice, [], [], TikTokSlice> = (set) => ({
  tiktokStatus: 'disconnected',
  tiktokUsername: null,
  tiktokAvatarUrl: '',
  tiktokStats: emptyStats,
  tiktokFeed: [],
  tiktokError: null,
  setTikTokStatus: (status, username, avatarUrl) =>
    set((s) => ({
      tiktokStatus: status,
      tiktokUsername: username !== undefined ? username : s.tiktokUsername,
      tiktokAvatarUrl:
        avatarUrl !== undefined
          ? avatarUrl
          : status === 'disconnected'
            ? ''
            : s.tiktokAvatarUrl,
      tiktokError: status === 'connected' ? null : s.tiktokError,
    })),
  pushTikTokEvent: (event) =>
    set((s) => ({
      tiktokFeed: [event, ...s.tiktokFeed].slice(0, MAX_FEED),
    })),
  setTikTokStats: (stats) => set({ tiktokStats: stats }),
  setTikTokError: (message) => set({ tiktokError: message, tiktokStatus: message ? 'error' : 'disconnected' }),
  clearTikTokFeed: () => set({ tiktokFeed: [] }),
});
