/**
 * `useGifts` — hook que cablea el slice `gifts` con el sidecar via JSON-RPC.
 *
 * Provee:
 *   - Listado filtrado/ordenado derivado del catálogo cacheado.
 *   - Refresh manual contra el sidecar.
 *   - CRUD optimista: upsert / remove / resetCounters.
 *   - Auto-descarga: scanFolder + importFromFolder.
 *   - Auto-load la primera vez que se monta (si `giftsStatus === 'idle'`).
 *
 * Patrón optimista: las mutaciones aplican local primero (`upsertGiftLocal`
 * / `removeGiftLocal`), luego confirman vía RPC. Si el RPC falla, hacemos
 * un refresh para recuperar el estado consistente (más simple que rollback
 * manual y Plan G prioriza simplicidad sobre micro-optimizaciones).
 */

import { useCallback, useEffect, useMemo } from 'react';
import type { DonationGift } from '@maru/shared';
import { rpcCall } from './rpc.js';
import { useAppStore } from './store/index.js';
import type { GiftSortBy } from './store/gifts-slice.js';

export interface UseGiftsResult {
  /** Lista filtrada + ordenada según `search/sortBy/showDisabled`. */
  visibleGifts: DonationGift[];
  /** Catálogo crudo (sin filtros). */
  allGifts: DonationGift[];
  /** Estado de la última carga. */
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Mensaje de error si `status === 'error'`. */
  error: string | null;
  /** Recarga el catálogo desde el sidecar. */
  refresh: () => Promise<void>;
  /** Crear o actualizar un gift (optimista). */
  upsert: (gift: DonationGift) => Promise<void>;
  /** Eliminar un gift (optimista). */
  remove: (id: string) => Promise<void>;
  /** Resetear todos los `receivedCount` a 0. */
  resetCounters: () => Promise<void>;
  /** Lee `donaciones/` y devuelve catálogo con metadata `tEXt` PNG. */
  scanFolder: () => Promise<DonationGift[]>;
  /** Importa al `gifts.json` los PNGs huérfanos del catálogo. */
  importFromFolder: (overwriteExisting?: boolean) => Promise<{
    imported: number;
    updated: number;
    skipped: number;
  }>;

  // Filtros (re-export para conveniencia desde la slice).
  search: string;
  setSearch: (q: string) => void;
  sortBy: GiftSortBy;
  setSortBy: (s: GiftSortBy) => void;
  showDisabled: boolean;
  setShowDisabled: (v: boolean) => void;
}

/**
 * Aplica filtros + orden al catálogo en memoria. Pure function para que
 * `useMemo` la pueda cachear sin recalcular en cada render.
 */
function deriveVisible(
  gifts: DonationGift[],
  search: string,
  sortBy: GiftSortBy,
  showDisabled: boolean,
): DonationGift[] {
  const q = search.trim().toLowerCase();
  let out = showDisabled ? gifts : gifts.filter((g) => !g.disabled);
  if (q) {
    out = out.filter((g) => {
      return (
        g.name.toLowerCase().includes(q) ||
        g.id.toLowerCase().includes(q) ||
        (g.icon ?? '').includes(q)
      );
    });
  }
  out = out.slice();
  switch (sortBy) {
    case 'coins-desc':
      out.sort(
        (a, b) =>
          (Number(a.disabled) - Number(b.disabled)) ||
          b.coins - a.coins ||
          a.name.localeCompare(b.name),
      );
      break;
    case 'coins-asc':
      out.sort(
        (a, b) =>
          (Number(a.disabled) - Number(b.disabled)) ||
          a.coins - b.coins ||
          a.name.localeCompare(b.name),
      );
      break;
    case 'name-asc':
      out.sort(
        (a, b) =>
          (Number(a.disabled) - Number(b.disabled)) ||
          a.name.localeCompare(b.name),
      );
      break;
    case 'received-desc':
      out.sort(
        (a, b) =>
          (Number(a.disabled) - Number(b.disabled)) ||
          (b.receivedCount ?? 0) - (a.receivedCount ?? 0) ||
          b.coins - a.coins,
      );
      break;
  }
  return out;
}

export function useGifts(options?: { autoLoad?: boolean }): UseGiftsResult {
  const autoLoad = options?.autoLoad ?? true;

  const gifts = useAppStore((s) => s.gifts);
  const status = useAppStore((s) => s.giftsStatus);
  const error = useAppStore((s) => s.giftsError);
  const search = useAppStore((s) => s.giftsSearch);
  const sortBy = useAppStore((s) => s.giftsSortBy);
  const showDisabled = useAppStore((s) => s.giftsShowDisabled);

  const setGifts = useAppStore((s) => s.setGifts);
  const setGiftsStatus = useAppStore((s) => s.setGiftsStatus);
  const setGiftsError = useAppStore((s) => s.setGiftsError);
  const upsertGiftLocal = useAppStore((s) => s.upsertGiftLocal);
  const removeGiftLocal = useAppStore((s) => s.removeGiftLocal);
  const setSearch = useAppStore((s) => s.setGiftsSearch);
  const setSortBy = useAppStore((s) => s.setGiftsSortBy);
  const setShowDisabled = useAppStore((s) => s.setGiftsShowDisabled);

  const refresh = useCallback(async () => {
    setGiftsStatus('loading');
    try {
      const res = await rpcCall('donations.list', { includeDisabled: true });
      setGifts(res.gifts);
    } catch (ex) {
      setGiftsError(ex instanceof Error ? ex.message : String(ex));
    }
  }, [setGifts, setGiftsError, setGiftsStatus]);

  const upsert = useCallback(
    async (gift: DonationGift) => {
      upsertGiftLocal(gift);
      try {
        const res = await rpcCall('donations.upsert', { gift });
        upsertGiftLocal(res.gift);
      } catch (ex) {
        setGiftsError(ex instanceof Error ? ex.message : String(ex));
        await refresh();
      }
    },
    [upsertGiftLocal, setGiftsError, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      removeGiftLocal(id);
      try {
        await rpcCall('donations.delete', { id });
      } catch (ex) {
        setGiftsError(ex instanceof Error ? ex.message : String(ex));
        await refresh();
      }
    },
    [removeGiftLocal, setGiftsError, refresh],
  );

  const resetCounters = useCallback(async () => {
    try {
      await rpcCall('donations.reset-counters', {});
      await refresh();
    } catch (ex) {
      setGiftsError(ex instanceof Error ? ex.message : String(ex));
    }
  }, [refresh, setGiftsError]);

  const scanFolder = useCallback(async () => {
    const res = await rpcCall('donations.scan-folder', {});
    return res.catalog;
  }, []);

  const importFromFolder = useCallback(
    async (overwriteExisting?: boolean) => {
      const res = await rpcCall('donations.import-from-folder', {
        overwriteExisting,
      });
      await refresh();
      return res;
    },
    [refresh],
  );

  // Auto-load primera vez.
  useEffect(() => {
    if (!autoLoad) return;
    if (status === 'idle') void refresh();
  }, [autoLoad, status, refresh]);

  const visibleGifts = useMemo(
    () => deriveVisible(gifts, search, sortBy, showDisabled),
    [gifts, search, sortBy, showDisabled],
  );

  return {
    visibleGifts,
    allGifts: gifts,
    status,
    error,
    refresh,
    upsert,
    remove,
    resetCounters,
    scanFolder,
    importFromFolder,
    search,
    setSearch,
    sortBy,
    setSortBy,
    showDisabled,
    setShowDisabled,
  };
}
