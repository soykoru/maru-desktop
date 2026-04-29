import type { StateCreator } from 'zustand';
import type {
  MinigamesConfig,
  MinigamesMeta,
  MinigameState,
} from '@maru/shared';

const EMPTY_CONFIG: MinigamesConfig = {
  wordSearch: { category: 'animales', wordCount: 8, rows: 10, cols: 10 },
  wordSearchLite: { category: 'animales', wordCount: 8, rows: 10, cols: 10 },
  wordBomb: { turnTime: 15, lives: 3 },
};

const EMPTY_META: MinigamesMeta = {
  minigames: [],
  wordSearchCategories: [],
  ranges: {
    wordSearch: { wordCount: [4, 12], rows: [8, 15], cols: [8, 15] },
    wordBomb: { turnTime: [5, 30], lives: [1, 5] },
  },
};

export interface MinigamesSlice {
  minigamesMeta: MinigamesMeta;
  minigamesConfig: MinigamesConfig;
  minigamesState: MinigameState;
  minigamesStatus: 'idle' | 'loading' | 'ready' | 'error';

  setMinigamesMeta: (meta: MinigamesMeta) => void;
  setMinigamesConfig: (cfg: MinigamesConfig) => void;
  patchMinigamesConfig: (patch: Partial<MinigamesConfig>) => void;
  setMinigamesState: (state: MinigameState) => void;
  setMinigamesStatus: (s: MinigamesSlice['minigamesStatus']) => void;
}

export const createMinigamesSlice: StateCreator<
  MinigamesSlice,
  [],
  [],
  MinigamesSlice
> = (set) => ({
  minigamesMeta: EMPTY_META,
  minigamesConfig: EMPTY_CONFIG,
  minigamesState: { active: false },
  minigamesStatus: 'idle',
  setMinigamesMeta: (minigamesMeta) => set({ minigamesMeta }),
  setMinigamesConfig: (minigamesConfig) =>
    set({ minigamesConfig, minigamesStatus: 'ready' }),
  patchMinigamesConfig: (patch) =>
    set((s) => ({
      minigamesConfig: { ...s.minigamesConfig, ...patch },
    })),
  setMinigamesState: (minigamesState) => set({ minigamesState }),
  setMinigamesStatus: (minigamesStatus) => set({ minigamesStatus }),
});
