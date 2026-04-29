import { useEffect, useMemo, useState } from 'react';
import { ImageOff, Search } from 'lucide-react';
import { Button, Dialog, Empty, Input, Spinner } from '@maru/ui';
import type { DonationGift } from '@maru/shared';
import { useGifts } from '../../../lib/use-gifts.js';
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
  const [picked, setPicked] = useState<string | null>(initialId);

  useEffect(() => {
    if (open) {
      setPicked(initialId);
      setSearch('');
    }
  }, [open, initialId]);

  const visible = useMemo(() => {
    const excluded = new Set(excludeIds);
    const q = search.trim().toLowerCase();
    let out = allGifts.filter((g) => !excluded.has(g.id));
    if (!showDisabled) out = out.filter((g) => !g.disabled);
    if (q) {
      out = out.filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          g.id.toLowerCase().includes(q),
      );
    }
    return out
      .slice()
      .sort((a, b) => b.coins - a.coins || a.name.localeCompare(b.name));
  }, [allGifts, excludeIds, search, showDisabled]);

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
      <div className="border-b border-border px-5 py-3 bg-bg-elev/30">
        <Input
          prefix={<Search className="h-3.5 w-3.5" />}
          placeholder="Buscar por nombre, id..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
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
