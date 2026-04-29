import { useMemo, useState } from 'react';
import {
  ImageOff,
  Plus,
  RotateCcw,
  Search,
  FolderOpen,
  Download,
} from 'lucide-react';
import {
  Button,
  Dialog,
  Empty,
  Input,
  Select,
  Spinner,
} from '@maru/ui';
import type { DonationGift } from '@maru/shared';
import { useGifts } from '../../../lib/use-gifts.js';
import { useAppStore } from '../../../lib/store/index.js';
import type { GiftSortBy } from '../../../lib/store/gifts-slice.js';
import { GiftCard } from './GiftCard.js';
import { GiftPreviewPanel } from './GiftPreviewPanel.js';
import { GiftEditForm } from './GiftEditForm.js';

/**
 * `GiftsDialog` — gestor visual del catálogo de donaciones (G3).
 *
 * Réplica de `gifts_dialog.py:GiftsDialog` (950×750 modal del MARU
 * original). Layout:
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ Toolbar: search │ sort │ show-disabled │ scan │ import │+│
 *   ├─────────────────────────────────┬───────────────────────┤
 *   │                                  │                       │
 *   │  Grid de gifts (5 cols, scroll)  │ Preview + Edit form   │
 *   │  (cards 110×135)                 │ (180px PNG + form)    │
 *   │                                  │                       │
 *   ├─────────────────────────────────┴───────────────────────┤
 *   │ Footer: count │ resetCounters                       Close│
 *   └─────────────────────────────────────────────────────────┘
 *
 * Mejoras sobre original:
 *   - Search box con debounce implícito (filter en memoria, instant).
 *   - Ordenamiento por coins/name/received.
 *   - Toggle "ocultos" (disabled gifts).
 *   - Scan folder y bulk-import desde la toolbar.
 *   - Preview con metadata completa.
 *   - Inline edit form que ya no abre un sub-diálogo (más fluido).
 */
export function GiftsDialog() {
  const open = useAppStore((s) => s.modalStack.some((f) => f.id === 'gifts'));
  const closeModal = useAppStore((s) => s.closeModal);
  const selectedId = useAppStore((s) => s.selectedGiftId);
  const setSelectedId = useAppStore((s) => s.setSelectedGiftId);

  const {
    visibleGifts,
    allGifts,
    status,
    error,
    refresh,
    upsert,
    remove,
    resetCounters,
    importFromFolder,
    search,
    setSearch,
    sortBy,
    setSortBy,
    showDisabled,
    setShowDisabled,
  } = useGifts({ autoLoad: open });

  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);

  const selected = useMemo<DonationGift | null>(
    () => allGifts.find((g) => g.id === selectedId) ?? null,
    [allGifts, selectedId],
  );

  if (!open) return null;

  const onPick = (g: DonationGift) => {
    setSelectedId(g.id);
    setCreating(false);
  };

  const onSubmit = async (g: DonationGift) => {
    setBusy(true);
    try {
      await upsert(g);
      setSelectedId(g.id);
      setCreating(false);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    setBusy(true);
    try {
      await remove(id);
    } finally {
      setBusy(false);
    }
  };

  const onScanImport = async () => {
    setBusy(true);
    setScanResult(null);
    try {
      const res = await importFromFolder(false);
      setScanResult(
        `${res.imported} importados · ${res.updated} actualizados · ${res.skipped} omitidos`,
      );
    } catch (ex) {
      setScanResult(
        ex instanceof Error ? `Error: ${ex.message}` : String(ex),
      );
    } finally {
      setBusy(false);
    }
  };

  const totalCount = allGifts.length;
  const visibleCount = visibleGifts.length;

  return (
    <Dialog
      open
      onClose={closeModal}
      size="xl"
      bodyFlush
      title="🎁 Gestionar Donaciones"
      description={`${totalCount} regalos en catálogo · ${visibleCount} visibles`}
    >
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3 bg-bg-elev/30">
        <Input
          prefix={<Search className="h-3.5 w-3.5" />}
          placeholder="Buscar por nombre, id o emoji..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[220px]"
        />

        <Select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as GiftSortBy)}
          className="w-[170px]"
          aria-label="Ordenar"
        >
          <option value="coins-desc">💎 Coins ↓</option>
          <option value="coins-asc">💎 Coins ↑</option>
          <option value="name-asc">A → Z</option>
          <option value="received-desc">Recibidos ↓</option>
        </Select>

        <label className="flex items-center gap-2 text-xs text-fg-muted px-2 py-1.5 rounded-md border border-border bg-bg-elev">
          <input
            type="checkbox"
            checked={showDisabled}
            onChange={(e) => setShowDisabled(e.target.checked)}
            className="h-3.5 w-3.5 accent-accent"
          />
          Mostrar ocultos
        </label>

        <Button
          variant="secondary"
          size="sm"
          onClick={onScanImport}
          disabled={busy}
          title="Escanear donaciones/ e importar PNGs nuevos"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Importar carpeta
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => void refresh()}
          disabled={busy || status === 'loading'}
          title="Recargar desde sidecar"
        >
          <Download className="h-3.5 w-3.5" />
          Recargar
        </Button>

        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setCreating(true);
            setSelectedId(null);
          }}
          title="Crear nuevo regalo"
        >
          <Plus className="h-3.5 w-3.5" />
          Nuevo
        </Button>
      </div>

      {scanResult && (
        <div className="px-5 py-2 text-xs text-fg-muted border-b border-border bg-bg-elev/20">
          {scanResult}
        </div>
      )}

      {/* ── Cuerpo: grid + side panel ──────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Grid */}
        <div className="flex-1 min-w-0 overflow-y-auto px-5 py-4">
          {status === 'loading' && allGifts.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <Spinner />
            </div>
          ) : status === 'error' ? (
            <Empty
              icon={ImageOff}
              title="No se pudieron cargar los gifts"
              description={error ?? 'Error desconocido'}
              action={
                <Button size="sm" onClick={() => void refresh()}>
                  Reintentar
                </Button>
              }
            />
          ) : visibleCount === 0 ? (
            <Empty
              icon={ImageOff}
              title={search ? 'Sin resultados' : 'Sin regalos todavía'}
              description={
                search
                  ? `No hay regalos que coincidan con "${search}".`
                  : 'Conectate a un live o importá la carpeta para empezar.'
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
              {visibleGifts.map((g) => (
                <GiftCard
                  key={g.id}
                  gift={g}
                  selected={g.id === selectedId}
                  onSelect={onPick}
                />
              ))}
            </div>
          )}
        </div>

        {/* Side: preview + edit */}
        <aside className="w-[320px] shrink-0 border-l border-border bg-bg-elev/30 overflow-y-auto">
          {creating ? (
            <div className="p-4">
              <h3 className="mb-3 text-sm font-semibold">Nuevo regalo</h3>
              <GiftEditForm
                gift={null}
                busy={busy}
                onSubmit={onSubmit}
                onCancel={() => setCreating(false)}
              />
            </div>
          ) : selected ? (
            <div className="flex flex-col">
              <GiftPreviewPanel gift={selected} />
              <div className="border-t border-border px-4 py-3">
                <GiftEditForm
                  gift={selected}
                  busy={busy}
                  onSubmit={onSubmit}
                  onDelete={onDelete}
                />
              </div>
            </div>
          ) : (
            <GiftPreviewPanel gift={null} />
          )}
        </aside>
      </div>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3 bg-bg-base/50">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void resetCounters()}
          disabled={busy}
          title="Volver a 0 todos los contadores de la sesión"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Resetear contadores
        </Button>
        <div className="text-xs text-fg-subtle">
          {status === 'loading' && 'Cargando…'}
          {status === 'ready' && `${visibleCount} de ${totalCount}`}
        </div>
        <Button variant="secondary" size="sm" onClick={closeModal}>
          Cerrar
        </Button>
      </footer>
    </Dialog>
  );
}
