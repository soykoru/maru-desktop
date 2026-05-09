import type { StateCreator } from 'zustand';
import type { GameProfile, GameId, GameHealthState } from '@maru/shared';

// Persistencia mínima de la última selección de juego en localStorage.
// El resto del store NO se persiste (logs, push events, etc. son
// efímeros). Sin esto, la app siempre arranca con el primer juego del
// array (Valheim).
const LAST_GAME_KEY = 'maru.lastGameId';

function readLastGameId(): GameId | null {
  try {
    const v = typeof localStorage !== 'undefined'
      ? localStorage.getItem(LAST_GAME_KEY)
      : null;
    return v && v.trim().length > 0 ? (v as GameId) : null;
  } catch {
    return null;
  }
}

function writeLastGameId(id: GameId | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (id) localStorage.setItem(LAST_GAME_KEY, String(id));
    else localStorage.removeItem(LAST_GAME_KEY);
  } catch {
    /* ignore quota / privacy mode */
  }
}

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

  /** v1.0.72: estado de salud por juego, alimentado por el push event
   *  `game:health` (cada 30s) + RPC `games.health.snapshot` al boot. */
  gameHealth: Record<string, GameHealthState>;

  setGames: (games: GameProfile[]) => void;
  upsertGameLocal: (profile: GameProfile) => void;
  removeGameLocal: (id: GameId) => void;
  setGamesStatus: (status: GamesSlice['gamesStatus']) => void;
  setGamesError: (msg: string | null) => void;
  setSelectedGameId: (id: GameId | null) => void;

  setGameHealth: (state: GameHealthState) => void;
  setGameHealthBulk: (states: Record<string, GameHealthState>) => void;
}

export const createGamesSlice: StateCreator<GamesSlice, [], [], GamesSlice> = (
  set,
) => ({
  games: [],
  gamesStatus: 'idle',
  gamesError: null,
  selectedGameId: readLastGameId(),
  gameHealth: {},

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
    set((s) => {
      const wasSelected = s.selectedGameId === id;
      if (wasSelected) writeLastGameId(null);
      return {
        games: s.games.filter((g) => g.id !== id),
        selectedGameId: wasSelected ? null : s.selectedGameId,
      };
    }),

  setGamesStatus: (gamesStatus) => set({ gamesStatus }),
  setGamesError: (gamesError) =>
    set({ gamesError, gamesStatus: gamesError ? 'error' : 'ready' }),
  setSelectedGameId: (selectedGameId) => {
    writeLastGameId(selectedGameId);
    set({ selectedGameId });
  },

  setGameHealth: (state) =>
    set((s) => ({ gameHealth: { ...s.gameHealth, [state.gameId]: state } })),
  setGameHealthBulk: (states) =>
    set((s) => ({ gameHealth: { ...s.gameHealth, ...states } })),
});
