import type { StateCreator } from 'zustand';
import type { ConnectionStatus, TikTokEvent, TikTokStats } from '@maru/shared';

const MAX_FEED = 200;

export interface TikTokSlice {
  tiktokStatus: ConnectionStatus;
  tiktokUsername: string | null;
  tiktokStats: TikTokStats;
  tiktokFeed: TikTokEvent[];
  tiktokError: string | null;
  setTikTokStatus: (status: ConnectionStatus, username?: string | null) => void;
  pushTikTokEvent: (event: TikTokEvent) => void;
  setTikTokStats: (stats: TikTokStats) => void;
  setTikTokError: (message: string | null) => void;
  clearTikTokFeed: () => void;
}

const emptyStats: TikTokStats = { viewers: 0, likes: 0, diamonds: 0, followers: 0, shares: 0 };

export const createTikTokSlice: StateCreator<TikTokSlice, [], [], TikTokSlice> = (set) => ({
  tiktokStatus: 'disconnected',
  tiktokUsername: null,
  tiktokStats: emptyStats,
  tiktokFeed: [],
  tiktokError: null,
  setTikTokStatus: (status, username) =>
    set((s) => ({
      tiktokStatus: status,
      tiktokUsername: username !== undefined ? username : s.tiktokUsername,
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
