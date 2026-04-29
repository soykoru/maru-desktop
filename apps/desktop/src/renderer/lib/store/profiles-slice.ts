import type { StateCreator } from 'zustand';
import type { ProfileSnapshot } from '@maru/shared';

export interface ProfilesSlice {
  profiles: ProfileSnapshot[];
  profilesStatus: 'idle' | 'loading' | 'ready' | 'error';
  profilesError: string | null;
  selectedProfileId: string | null;

  setProfiles: (list: ProfileSnapshot[]) => void;
  setProfilesStatus: (s: ProfilesSlice['profilesStatus']) => void;
  setProfilesError: (e: string | null) => void;
  setSelectedProfileId: (id: string | null) => void;
  upsertProfileLocal: (p: ProfileSnapshot) => void;
  removeProfileLocal: (id: string) => void;
}

export const createProfilesSlice: StateCreator<
  ProfilesSlice,
  [],
  [],
  ProfilesSlice
> = (set) => ({
  profiles: [],
  profilesStatus: 'idle',
  profilesError: null,
  selectedProfileId: null,
  setProfiles: (list) =>
    set({ profiles: list, profilesStatus: 'ready', profilesError: null }),
  setProfilesStatus: (profilesStatus) => set({ profilesStatus }),
  setProfilesError: (profilesError) =>
    set({ profilesError, profilesStatus: profilesError ? 'error' : 'ready' }),
  setSelectedProfileId: (selectedProfileId) => set({ selectedProfileId }),
  upsertProfileLocal: (p) =>
    set((s) => {
      const idx = s.profiles.findIndex((x) => x.id === p.id);
      const next =
        idx === -1
          ? [...s.profiles, p]
          : s.profiles.map((x, i) => (i === idx ? p : x));
      return { profiles: next };
    }),
  removeProfileLocal: (id) =>
    set((s) => ({
      profiles: s.profiles.filter((p) => p.id !== id),
      selectedProfileId:
        s.selectedProfileId === id ? null : s.selectedProfileId,
    })),
});
