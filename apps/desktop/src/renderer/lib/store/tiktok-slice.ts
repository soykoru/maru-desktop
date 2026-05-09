import type { StateCreator } from 'zustand';
import type { ConnectionStatus, TikTokStats } from '@maru/shared';

export interface TikTokSlice {
  tiktokStatus: ConnectionStatus;
  tiktokUsername: string | null;
  /** Avatar URL del streamer (host del live). Llega del sidecar via
   *  `tiktok:status` cuando el handshake recupera `room_info`. Vacío
   *  hasta que conecte. */
  tiktokAvatarUrl: string;
  tiktokStats: TikTokStats;
  tiktokError: string | null;
  setTikTokStatus: (
    status: ConnectionStatus,
    username?: string | null,
    avatarUrl?: string,
  ) => void;
  setTikTokStats: (stats: TikTokStats) => void;
  setTikTokError: (message: string | null) => void;
}

const emptyStats: TikTokStats = { viewers: 0, likes: 0, diamonds: 0, followers: 0, shares: 0 };

export const createTikTokSlice: StateCreator<TikTokSlice, [], [], TikTokSlice> = (set) => ({
  tiktokStatus: 'disconnected',
  tiktokUsername: null,
  tiktokAvatarUrl: '',
  tiktokStats: emptyStats,
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
  setTikTokStats: (stats) => set({ tiktokStats: stats }),
  setTikTokError: (message) => set({ tiktokError: message, tiktokStatus: message ? 'error' : 'disconnected' }),
});
