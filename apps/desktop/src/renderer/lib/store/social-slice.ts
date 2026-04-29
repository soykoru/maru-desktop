import type { StateCreator } from 'zustand';
import type {
  SocialCategoryMeta,
  SocialConfig,
  SocialStats,
  SocialUser,
  TapsPeriod,
  TapsRankingEntry,
} from '@maru/shared';

/**
 * Slice de social (G7) — global (no buckets, hay un solo SocialSystem).
 */

const DEFAULT_CONFIG: SocialConfig = {
  enabled: true,
  require_register: true,
  cooldown_seconds: 5,
  timeout_seconds: 90,
  volume: 80,
  voice: '',
  enabled_commands: [],
};

const DEFAULT_STATS: SocialStats = {
  total_users: 0,
  registered_users: 0,
  total_duelos: 0,
  total_interacciones: 0,
  total_matrimonios: 0,
  total_divorcios: 0,
  total_noviazgos: 0,
  total_rupturas: 0,
  active_marriages: 0,
  active_partnerships: 0,
  active_friendships: 0,
  active_rivalries: 0,
  top_streak: null,
};

export interface SocialSlice {
  socialConfig: SocialConfig;
  socialUsers: SocialUser[];
  socialUsersStatus: 'idle' | 'loading' | 'ready' | 'error';
  socialUsersError: string | null;
  socialUsersSearch: string;
  socialSelectedUsername: string | null;
  socialStats: SocialStats;
  socialTapsPeriod: TapsPeriod;
  socialTapsRanking: TapsRankingEntry[];
  socialTapsTotal: number;
  socialCommandsMeta: Record<string, SocialCategoryMeta>;

  setSocialConfig: (cfg: SocialConfig) => void;
  patchSocialConfig: (patch: Partial<SocialConfig>) => void;
  setSocialUsers: (users: SocialUser[]) => void;
  setSocialUsersStatus: (s: SocialSlice['socialUsersStatus']) => void;
  setSocialUsersError: (e: string | null) => void;
  setSocialUsersSearch: (q: string) => void;
  setSocialSelectedUsername: (u: string | null) => void;
  upsertSocialUserLocal: (user: SocialUser) => void;
  removeSocialUserLocal: (username: string) => void;
  setSocialStats: (stats: SocialStats) => void;
  setSocialTaps: (period: TapsPeriod, total: number, ranking: TapsRankingEntry[]) => void;
  setSocialCommandsMeta: (m: Record<string, SocialCategoryMeta>) => void;
}

export const createSocialSlice: StateCreator<SocialSlice, [], [], SocialSlice> = (set) => ({
  socialConfig: DEFAULT_CONFIG,
  socialUsers: [],
  socialUsersStatus: 'idle',
  socialUsersError: null,
  socialUsersSearch: '',
  socialSelectedUsername: null,
  socialStats: DEFAULT_STATS,
  socialTapsPeriod: 'total',
  socialTapsRanking: [],
  socialTapsTotal: 0,
  socialCommandsMeta: {},

  setSocialConfig: (socialConfig) => set({ socialConfig }),
  patchSocialConfig: (patch) =>
    set((s) => ({ socialConfig: { ...s.socialConfig, ...patch } })),

  setSocialUsers: (users) =>
    set({ socialUsers: users, socialUsersStatus: 'ready', socialUsersError: null }),
  setSocialUsersStatus: (socialUsersStatus) => set({ socialUsersStatus }),
  setSocialUsersError: (socialUsersError) =>
    set({ socialUsersError, socialUsersStatus: socialUsersError ? 'error' : 'ready' }),
  setSocialUsersSearch: (socialUsersSearch) => set({ socialUsersSearch }),
  setSocialSelectedUsername: (socialSelectedUsername) => set({ socialSelectedUsername }),

  upsertSocialUserLocal: (user) =>
    set((s) => {
      const idx = s.socialUsers.findIndex((u) => u.username === user.username);
      const next =
        idx === -1
          ? [...s.socialUsers, user]
          : s.socialUsers.map((u, i) => (i === idx ? user : u));
      return { socialUsers: next };
    }),

  removeSocialUserLocal: (username) =>
    set((s) => ({
      socialUsers: s.socialUsers.filter((u) => u.username !== username),
      socialSelectedUsername:
        s.socialSelectedUsername === username ? null : s.socialSelectedUsername,
    })),

  setSocialStats: (socialStats) => set({ socialStats }),
  setSocialTaps: (socialTapsPeriod, socialTapsTotal, socialTapsRanking) =>
    set({ socialTapsPeriod, socialTapsTotal, socialTapsRanking }),
  setSocialCommandsMeta: (socialCommandsMeta) => set({ socialCommandsMeta }),
});
