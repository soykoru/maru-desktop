import { useEffect, useMemo, useState } from 'react';
import { Package, Search, X } from 'lucide-react';
import {
  Button,
  Dialog,
  Empty,
  Input,
  Spinner,
} from '@maru/ui';
import type {
  DataCategoryBundle,
  DataEntry,
  GameId,
} from '@maru/shared';
import { rpcCall } from '../../../lib/rpc.js';
import { EntryCard } from './EntryCard.js';

/**
 * `EntitySelectorDialog` — picker reusable con tabs por categoría +
 * multi-select opcional con cantidad por item.
 *
 * Réplica de `entity_selector.py:EntitySelectorDialog` (614 líneas).
 *
 * Modos:
 *   - **single**: doble-click acepta una entrada (display_name + amount=1).
 *   - **multi**: cada click incrementa la cantidad. Panel lateral con
 *     spinbox por fila + botón ✕ para remover.
 *
 * Consume `data.all-categories` para traer TODAS las cats del juego en
 * una sola llamada (con `imagePath` resuelto contra el bundle).
 */
export interface MultiSelection {
  category: string;
  catLabel: string;
  displayName: string;
  command: string;
  amount: number;
  imagePath?: string;
}

export interface EntitySelectorDialogProps {
  open: boolean;
  onClose: () => void;
  gameId: GameId;
  /** Categoría inicial activa. Default: la primera. */
  initialCategory?: string;
  /** Display name a preseleccionar (single-mode). */
  preselected?: string;
  /** Modo multi-select con cantidades. Default false. */
  multiSelect?: boolean;
  /** Single-select callback. */
  onSelect?: (entry: DataEntry, category: string) => void;
  /** Multi-select callback. */
  onConfirmMulti?: (selections: MultiSelection[]) => void;
  /** Título customizable. */
  title?: string;
}

interface CategoryState {
  cats: Record<string, DataCategoryBundle>;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
}

const INITIAL_STATE: CategoryState = {
  cats: {},
  status: 'idle',
  error: null,
};

export function EntitySelectorDialog({
  open,
  onClose,
  gameId,
  initialCategory,
  preselected,
  multiSelect = false,
  onSelect,
  onConfirmMulti,
  title,
}: EntitySelectorDialogProps) {
  const [state, setState] = useState<CategoryState>(INITIAL_STATE);
  const [activeCat, setActiveCat] = useState<string>('');
  const [search, setSearch] = useState('');
  const [singlePicked, setSinglePicked] = useState<DataEntry | null>(null);
  const [selections, setSelections] = useState<MultiSelection[]>([]);

  // Cargar all-categories al abrir.
  useEffect(() => {
    if (!open || !gameId) return;
    let alive = true;
    setState({ cats: {}, status: 'loading', error: null });
    setSelections([]);
    setSinglePicked(null);
    setSearch('');
    void rpcCall('data.all-categories', { gameId })
      .then((res) => {
        if (!alive) return;
        setState({ cats: res.categories, status: 'ready', error: null });
        const keys = Object.keys(res.categories);
        const first =
          (initialCategory && keys.includes(initialCategory) && initialCategory) ||
          keys[0] ||
          '';
        setActiveCat(first);
      })
      .catch((ex) => {
        if (!alive) return;
        setState({
          cats: {},
          status: 'error',
          error: ex instanceof Error ? ex.message : String(ex),
        });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, gameId]);

  // Si vino preselected, marcarlo cuando lleguen las categorías.
  useEffect(() => {
    if (!open || !preselected || multiSelect || state.status !== 'ready') return;
    for (const [catId, bundle] of Object.entries(state.cats)) {
      const hit = bundle.entries.find((e) => e.name === preselected);
      if (hit) {
        setActiveCat(catId);
        setSinglePicked(hit);
        return;
      }
    }
  }, [open, preselected, multiSelect, state.status, state.cats]);

  const visibleEntries = useMemo(() => {
    const bundle = state.cats[activeCat];
    if (!bundle) return [];
    const q = search.trim().toLowerCase();
    if (!q) return bundle.entries;
    return bundle.entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.command.toLowerCase().includes(q),
    );
  }, [state.cats, activeCat, search]);

  function handlePick(entry: DataEntry) {
    if (!multiSelect) {
      setSinglePicked(entry);
      return;
    }
    setSelections((prev) => {
      const idx = prev.findIndex(
        (s) => s.category === activeCat && s.displayName === entry.name,
      );
      if (idx >= 0) {
        const current = prev[idx];
        if (!current) return prev;
        const copy = prev.slice();
        copy[idx] = { ...current, amount: current.amount + 1 };
        return copy;
      }
      const bundle = state.cats[activeCat];
      const next: MultiSelection = {
        category: activeCat,
        catLabel: bundle?.label ?? activeCat,
        displayName: entry.name,
        command: entry.command,
        amount: 1,
        imagePath: entry.imagePath,
      };
      return [...prev, next];
    });
  }

  function handleConfirmCard(entry: DataEntry) {
    if (multiSelect) {
      handlePick(entry);
      return;
    }
    onSelect?.(entry, activeCat);
  }

  function confirmCurrent() {
    if (multiSelect) {
      onConfirmMulti?.(selections);
      return;
    }
    if (singlePicked) {
      onSelect?.(singlePicked, activeCat);
    }
  }

  function updateSelectionAmount(idx: number, amount: number) {
    setSelections((prev) => {
      const current = prev[idx];
      if (!current) return prev;
      const next = prev.slice();
      next[idx] = {
        ...current,
        amount: Math.max(1, Math.min(999_999, Math.floor(amount))),
      };
      return next;
    });
  }

  function removeSelection(idx: number) {
    setSelections((prev) => prev.filter((_, i) => i !== idx));
  }

  if (!open) return null;

  const catKeys = Object.keys(state.cats);
  const showTabs = catKeys.length > 1;
  const totalSelections = selections.reduce((acc, s) => acc + s.amount, 0);

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      bodyFlush
      title={
        title ??
        (multiSelect
          ? '🎯 Seleccionar Acciones'
          : '🐉 Seleccionar Entidad / Item / Evento')
      }
      description={
        multiSelect
          ? `${selections.length} entradas · ${totalSelections} en total`
          : 'Doble-click o Enter para aceptar.'
      }
    >
      {/* Tab bar */}
      {showTabs && (
        <div
          role="tablist"
          aria-label="Categorías"
          className="flex border-b border-border bg-bg-elev/30 overflow-x-auto"
        >
          {catKeys.map((cid) => {
            const bundle = state.cats[cid];
            if (!bundle) return null;
            const active = cid === activeCat;
            return (
              <button
                key={cid}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setActiveCat(cid);
                  setSinglePicked(null);
                }}
                className={[
                  'px-4 py-2 text-xs font-medium uppercase tracking-wider whitespace-nowrap',
                  'transition-colors border-b-2',
                  active
                    ? 'text-accent border-accent'
                    : 'text-fg-muted border-transparent hover:text-fg',
                ].join(' ')}
              >
                {bundle.label} ({bundle.entries.length})
              </button>
            );
          })}
        </div>
      )}

      {/* Search */}
      <div className="border-b border-border px-5 py-3 bg-bg-elev/20">
        <Input
          prefix={<Search className="h-3.5 w-3.5" />}
          placeholder="Buscar..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      {/* Cuerpo: grid + selecciones */}
      <div
        className="flex flex-1 min-h-0 overflow-hidden"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (singlePicked || selections.length > 0)) {
            e.preventDefault();
            confirmCurrent();
          }
        }}
      >
        <div className="flex-1 min-w-0 overflow-y-auto px-5 py-4">
          {state.status === 'loading' ? (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          ) : state.status === 'error' ? (
            <Empty
              icon={Package}
              title="No se pudieron cargar las categorías"
              description={state.error ?? '—'}
            />
          ) : visibleEntries.length === 0 ? (
            <Empty
              icon={Package}
              title={search ? 'Sin resultados' : 'Categoría vacía'}
              description={
                search
                  ? `No hay entradas que coincidan con "${search}".`
                  : 'Agregá entradas desde el DataDialog primero.'
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
              {visibleEntries.map((e) => {
                const inSel = multiSelect
                  ? selections.some(
                      (s) =>
                        s.category === activeCat && s.displayName === e.name,
                    )
                  : false;
                const badge = multiSelect
                  ? selections.find(
                      (s) =>
                        s.category === activeCat && s.displayName === e.name,
                    )?.amount
                  : undefined;
                return (
                  <EntryCard
                    key={`${e.name}::${e.command}`}
                    entry={e}
                    gameId={gameId}
                    category={activeCat}
                    selected={!multiSelect && singlePicked?.name === e.name}
                    inSelection={inSel}
                    badge={badge}
                    onSelect={handlePick}
                    onConfirm={handleConfirmCard}
                  />
                );
              })}
            </div>
          )}
        </div>

        {multiSelect && (
          <aside className="w-[280px] shrink-0 border-l border-border bg-bg-elev/30 overflow-y-auto">
            <div className="px-3 py-2 border-b border-border">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                Seleccionadas ({selections.length})
              </h3>
            </div>
            {selections.length === 0 ? (
              <p className="text-xs text-fg-subtle italic px-4 py-6 text-center">
                Click en una card para añadir.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {selections.map((s, i) => (
                  <li
                    key={`${s.category}::${s.displayName}`}
                    className="flex items-center gap-2 px-2.5 py-2"
                  >
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider text-info shrink-0 w-12"
                      title={s.catLabel}
                    >
                      {s.catLabel.replace(/^[\W]+/, '').slice(0, 6)}
                    </span>
                    <span className="text-xs flex-1 truncate" title={s.displayName}>
                      {s.displayName}
                    </span>
                    <span className="text-fg-subtle text-xs">×</span>
                    <Input
                      type="number"
                      min={1}
                      max={999_999}
                      value={String(s.amount)}
                      onChange={(e) =>
                        updateSelectionAmount(i, parseInt(e.target.value, 10) || 1)
                      }
                      className="w-[68px] !h-7 text-xs font-bold"
                    />
                    <button
                      type="button"
                      onClick={() => removeSelection(i)}
                      title="Quitar"
                      className="h-6 w-6 rounded-full bg-danger/15 text-danger hover:bg-danger/30 flex items-center justify-center"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3 bg-bg-base/50">
        <p className="text-xs text-fg-subtle">
          {multiSelect
            ? 'Click añade · doble-click incrementa.'
            : 'Doble-click o Enter para aceptar.'}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={
              multiSelect ? selections.length === 0 : !singlePicked
            }
            onClick={confirmCurrent}
          >
            {multiSelect
              ? `Aceptar (${selections.length})`
              : singlePicked
                ? `Elegir ${singlePicked.name}`
                : 'Aceptar'}
          </Button>
        </div>
      </footer>
    </Dialog>
  );
}
