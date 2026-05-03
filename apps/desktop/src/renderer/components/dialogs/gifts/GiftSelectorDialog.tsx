import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, ImageOff, Search } from 'lucide-react';
import { Button, Dialog, Empty, Input, Select, Spinner } from '@maru/ui';
import type { DonationGift } from '@maru/shared';
import { useGifts } from '../../../lib/use-gifts.js';
import { useDebouncedValue } from '../../../lib/hooks.js';
import { GiftCard } from './GiftCard.js';

/**
 * `GiftSelectorDialog` — picker reusable para flujos donde el usuario
 * elige UN gift (rules trigger, fortuna, sounds, etc.).
 *
 * Réplica de `gift_selector.py` (750×550 modal):
 *   - Grid 6 columnas (cards 110×135).
 *   - Search instantáneo.
 *   - Click → highlight; Doble-click o Enter → confirma.
 *   - Botón "Aceptar" sólo activo con selección.
 *
 * Mejoras sobre original:
 *   - `excludeIds` para esconder gifts ya usados (e.g. en otra regla).
 *   - `initialId` para posicionar la selección al abrir.
 *   - Maneja estado interno; el padre solo recibe `onSelect(gift)` o `onCancel`.
 */
export interface GiftSelectorDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (gift: DonationGift) => void;
  /** ID a preseleccionar al abrir. */
  initialId?: string | null;
  /** IDs a ocultar del grid. */
  excludeIds?: readonly string[];
  /** Título personalizable; default "Seleccionar Donación". */
  title?: string;
  /** Si false, oculta los gifts disabled. Default false. */
  showDisabled?: boolean;
}

export function GiftSelectorDialog({
  open,
  onClose,
  onSelect,
  initialId = null,
  excludeIds = [],
  title = '🎁 Seleccionar Donación',
  showDisabled = false,
}: GiftSelectorDialogProps) {
  const { allGifts, status, error, refresh } = useGifts({ autoLoad: open });
  const [search, setSearch] = useState('');
  // Debounce 200ms — el filtro corre sobre 1000+ gifts. Sin esto cada
  // keystroke recorre + ordena toda la lista. Input sigue typing inmediato.
  const debouncedSearch = useDebouncedValue(search, 200);
  const [picked, setPicked] = useState<string | null>(initialId);
  // v1.0.49: control explícito de orden. Default coins-desc (más caros
  // primero) que es lo que el user esperaba.
  type SortKey = 'coins-desc' | 'coins-asc' | 'name-asc';
  const [sortBy, setSortBy] = useState<SortKey>('coins-desc');

  useEffect(() => {
    if (open) {
      setPicked(initialId);
      setSearch('');
    }
  }, [open, initialId]);

  const visible = useMemo(() => {
    const excluded = new Set(excludeIds);
    const q = debouncedSearch.trim().toLowerCase();
    // Si el query es un número entero puro (ej. "100"), tratamos
    // también como filtro por coins exactos. Si trae texto, filtramos
    // por name/id como antes. Esto permite "1" → todas las que valen
    // 1 diamante, "5000" → las de 5000, etc.
    const qAsNumber =
      q && /^\d+$/.test(q) ? parseInt(q, 10) : null;
    let out = allGifts.filter((g) => !excluded.has(g.id));
    if (!showDisabled) out = out.filter((g) => !g.disabled);
    if (q) {
      out = out.filter((g) => {
        const matchesText =
          g.name.toLowerCase().includes(q) ||
          g.id.toLowerCase().includes(q);
        const matchesCoins =
          qAsNumber !== null && g.coins === qAsNumber;
        return matchesText || matchesCoins;
      });
    }
    const sorted = out.slice();
    if (sortBy === 'coins-desc') {
      sorted.sort((a, b) => b.coins - a.coins || a.name.localeCompare(b.name));
    } else if (sortBy === 'coins-asc') {
      sorted.sort((a, b) => a.coins - b.coins || a.name.localeCompare(b.name));
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }, [allGifts, excludeIds, debouncedSearch, showDisabled, sortBy]);

  const selected = visible.find((g) => g.id === picked) ?? null;

  const confirmCurrent = () => {
    if (selected) {
      onSelect(selected);
    }
  };

  if (!open) return null;

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      bodyFlush
      title={title}
      description={`${visible.length} regalos disponibles`}
    >
      <div className="border-b border-border px-5 py-3 bg-bg-elev/30 flex items-center gap-2">
        <Input
          prefix={<Search className="h-3.5 w-3.5" />}
          placeholder="Buscar por nombre, id, o costo en diamantes (ej. 100)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
          className="flex-1 min-w-0"
        />
        <div className="flex items-center gap-1.5 shrink-0">
          <ArrowDownUp className="h-3.5 w-3.5 text-fg-subtle" aria-hidden="true" />
          <Select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="!h-9 !text-xs w-[160px]"
            title="Ordenar regalos"
          >
            <option value="coins-desc">💎 Mayor a menor</option>
            <option value="coins-asc">💎 Menor a mayor</option>
            <option value="name-asc">🔤 Nombre A-Z</option>
          </Select>
        </div>
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto px-5 py-4"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && selected) {
            e.preventDefault();
            confirmCurrent();
          }
        }}
      >
        {status === 'loading' && allGifts.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : status === 'error' ? (
          <Empty
            icon={ImageOff}
            title="Error al cargar gifts"
            description={error ?? '—'}
            action={
              <Button size="sm" onClick={() => void refresh()}>
                Reintentar
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <Empty
            icon={ImageOff}
            title={search ? 'Sin resultados' : 'No hay regalos disponibles'}
            description={
              search
                ? `No hay regalos que coincidan con "${search}".`
                : 'Importá la carpeta o conectate al live primero.'
            }
          />
        ) : (
          <div
            className="grid gap-3 content-start"
            style={{
              gridTemplateColumns:
                'repeat(auto-fill, minmax(110px, 1fr))',
            }}
          >
            {visible.map((g) => (
              <GiftCard
                key={g.id}
                gift={g}
                selected={g.id === picked}
                onSelect={(gift) => setPicked(gift.id)}
                onConfirm={(gift) => onSelect(gift)}
              />
            ))}
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3 bg-bg-base/50">
        <p className="text-xs text-fg-subtle">
          Doble-click o Enter para aceptar.
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!selected}
            onClick={confirmCurrent}
          >
            {selected ? `Elegir ${selected.name}` : 'Aceptar'}
          </Button>
        </div>
      </footer>
    </Dialog>
  );
}
