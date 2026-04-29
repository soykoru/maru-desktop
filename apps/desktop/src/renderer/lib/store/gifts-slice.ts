import type { StateCreator } from 'zustand';
import type { DonationGift } from '@maru/shared';

/**
 * Slice de gifts (G3) — fuente de verdad del catálogo de donaciones
 * en el renderer.
 *
 * Responsabilidades:
 *   - Mantener el `gifts: DonationGift[]` cacheado en memoria.
 *   - Estado de carga (`loading`, `error`) para feedback en UI.
 *   - Estado de filtrado de la lista (`search`, `sortBy`, `showDisabled`).
 *   - Selección actual para el preview panel del `GiftsDialog`.
 *
 * Las operaciones que tocan disco (upsert/delete/reset/scan/import) viven
 * en el hook `useGifts()` — esta slice solo guarda estado UI.
 */

export type GiftSortBy = 'coins-desc' | 'coins-asc' | 'name-asc' | 'received-desc';

export interface GiftsSlice {
  /** Catálogo cacheado. Mutar solo via setGifts() o aplicar desde RPC. */
  gifts: DonationGift[];
  /** Última carga: `idle` | `loading` | `ready` | `error`. */
  giftsStatus: 'idle' | 'loading' | 'ready' | 'error';
  /** Mensaje de error de la última operación, o null. */
  giftsError: string | null;
  /** Texto del search box (filtro fuzzy por nombre/id). */
  giftsSearch: string;
  /** Orden actual del grid. */
  giftsSortBy: GiftSortBy;
  /** Si true, incluye gifts con `disabled=true`. Default true. */
  giftsShowDisabled: boolean;
  /** ID del gift actualmente seleccionado en el dialog (preview). */
  selectedGiftId: string | null;

  setGifts: (gifts: DonationGift[]) => void;
  upsertGiftLocal: (gift: DonationGift) => void;
  removeGiftLocal: (id: string) => void;
  setGiftsStatus: (status: GiftsSlice['giftsStatus']) => void;
  setGiftsError: (message: string | null) => void;
  setGiftsSearch: (q: string) => void;
  setGiftsSortBy: (s: GiftSortBy) => void;
  setGiftsShowDisabled: (v: boolean) => void;
  setSelectedGiftId: (id: string | null) => void;
}

export const createGiftsSlice: StateCreator<GiftsSlice, [], [], GiftsSlice> = (
  set,
) => ({
  gifts: [],
  giftsStatus: 'idle',
  giftsError: null,
  giftsSearch: '',
  giftsSortBy: 'coins-desc',
  giftsShowDisabled: true,
  selectedGiftId: null,

  setGifts: (gifts) =>
    set({ gifts, giftsStatus: 'ready', giftsError: null }),

  upsertGiftLocal: (gift) =>
    set((s) => {
      const idx = s.gifts.findIndex((g) => g.id === gift.id);
      if (idx === -1) return { gifts: [...s.gifts, gift] };
      const next = s.gifts.slice();
      next[idx] = gift;
      return { gifts: next };
    }),

  removeGiftLocal: (id) =>
    set((s) => ({
      gifts: s.gifts.filter((g) => g.id !== id),
      selectedGiftId: s.selectedGiftId === id ? null : s.selectedGiftId,
    })),

  setGiftsStatus: (giftsStatus) => set({ giftsStatus }),
  setGiftsError: (giftsError) =>
    set({ giftsError, giftsStatus: giftsError ? 'error' : 'ready' }),

  setGiftsSearch: (giftsSearch) => set({ giftsSearch }),
  setGiftsSortBy: (giftsSortBy) => set({ giftsSortBy }),
  setGiftsShowDisabled: (giftsShowDisabled) => set({ giftsShowDisabled }),
  setSelectedGiftId: (selectedGiftId) => set({ selectedGiftId }),
});
