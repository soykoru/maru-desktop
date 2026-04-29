import type { StateCreator } from 'zustand';
import type { GameProfile, GameId } from '@maru/shared';

/**
 * Slice de juegos (G4) — fuente de verdad de los perfiles en el renderer.
 *
 * Responsabilidades:
 *   - Cachear `GameProfile[]` traído de `games.list`.
 *   - Estado de carga (`gamesStatus`, `gamesError`).
 *   - Selección actual (qué perfil edita el usuario).
 *
 *   Las operaciones contra el sidecar viven en `useGames()`.
 */
export interface GamesSlice {
  games: GameProfile[];
  gamesStatus: 'idle' | 'loading' | 'ready' | 'error';
  gamesError: string | null;
  selectedGameId: GameId | null;

  setGames: (games: GameProfile[]) => void;
  upsertGameLocal: (profile: GameProfile) => void;
  removeGameLocal: (id: GameId) => void;
  setGamesStatus: (status: GamesSlice['gamesStatus']) => void;
  setGamesError: (msg: string | null) => void;
  setSelectedGameId: (id: GameId | null) => void;
}

export const createGamesSlice: StateCreator<GamesSlice, [], [], GamesSlice> = (
  set,
) => ({
  games: [],
  gamesStatus: 'idle',
  gamesError: null,
  selectedGameId: null,

  setGames: (games) =>
    set({ games, gamesStatus: 'ready', gamesError: null }),

  upsertGameLocal: (profile) =>
    set((s) => {
      const idx = s.games.findIndex((g) => g.id === profile.id);
      if (idx === -1) return { games: [...s.games, profile] };
      const next = s.games.slice();
      next[idx] = profile;
      return { games: next };
    }),

  removeGameLocal: (id) =>
    set((s) => ({
      games: s.games.filter((g) => g.id !== id),
      selectedGameId: s.selectedGameId === id ? null : s.selectedGameId,
    })),

  setGamesStatus: (gamesStatus) => set({ gamesStatus }),
  setGamesError: (gamesError) =>
    set({ gamesError, gamesStatus: gamesError ? 'error' : 'ready' }),
  setSelectedGameId: (selectedGameId) => set({ selectedGameId }),
});
