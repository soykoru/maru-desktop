import { useEffect, useMemo, useState } from 'react';
import {
  Download,
  Info,
  Plus,
  Search,
  Upload,
  Package,
  CheckSquare,
  Trash2,
  X,
} from 'lucide-react';
import {
  Button,
  Dialog,
  Empty,
  Input,
  Spinner,
  toast,
} from '@maru/ui';
import type { DataEntry, DataKind, GameId } from '@maru/shared';
import { useAppStore } from '../../../lib/store/index.js';
import { useData } from '../../../lib/use-data.js';
import { useGames } from '../../../lib/use-games.js';
import { useConfirm } from '../../../lib/use-notify.js';
import { EntryCard } from './EntryCard.js';
import { EntryEditForm } from './EntryEditForm.js';
import { EntryPreviewPanel } from './EntryPreviewPanel.js';

/**
 * `DataDialog` — gestor visual del catálogo de entidades / items / eventos
 * (y categorías custom de G4).
 *
 * Réplica de `data_dialog.py:DataDialog` (625 líneas Python):
 *   - Toolbar: search + count + tutorial + import/export + nuevo.
 *   - Grid auto-fill 120px (cards 120×120).
 *   - Side-panel preview + edit form.
 *
 * Mejoras vs original:
 *   - Sin sub-diálogo para crear: el form de edit lateral hace doble duty.
 *   - Test inline (sin tener que guardar primero).
 *   - Tutorial que se carga lazy desde games.json (G4 categories).
 *   - Import acepta tanto el formato canónico como el legacy `"X:Y"`.
 *   - Botón export bajado al footer para reducir clutter.
 */
const KIND_LABELS: Record<string, string> = {
  entities: 'Entidades',
  items: 'Items',
  events: 'Eventos',
  valuables: 'Valuables',
};

export function DataDialog() {
  const open = useAppStore((s) => s.modalStack.some((f) => f.id === 'data'));
  const closeModal = useAppStore((s) => s.closeModal);
  const payload = useAppStore((s) => s.modalPayload) as
    | { gameId?: GameId; kind?: DataKind }
    | null;

  const gameId = payload?.gameId ?? '';
  const kind = (payload?.kind as DataKind) ?? 'entities';

  const { byId } = useGames({ autoLoad: open });
  const profile = byId(gameId);

  const data = useData(open ? gameId : null, kind, { autoLoad: open });
  const confirm = useConfirm();

  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tutorial, setTutorial] = useState<string | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  // v1.0.91+ — modo selección múltiple para borrar varias entries de
  // una sola vez (pedido del user para customizar perfiles rápido).
  // Al activarse, los clicks en EntryCard hacen toggle del Set en lugar
  // de seleccionar para edit. Las acciones masivas viven en el aside.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());

  // Resetear cuando cierra o cambia (gid, kind).
  useEffect(() => {
    if (!open) {
      setCreating(false);
      setBusy(false);
      setTutorial(null);
      setShowTutorial(false);
      setImportStatus(null);
      setSelectionMode(false);
      setSelectedSet(new Set());
    }
  }, [open, gameId, kind]);

  // Salir del modo selección al cambiar de juego/categoría — la selección
  // anterior no aplica al nuevo contexto y arrastrarla confunde al user.
  useEffect(() => {
    setSelectionMode(false);
    setSelectedSet(new Set());
  }, [gameId, kind]);

  function toggleSelected(name: string) {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedSet(new Set(data.entries.map((e) => e.name)));
  }

  function clearSelection() {
    setSelectedSet(new Set());
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedSet(new Set());
  }

  async function handleBulkDelete() {
    const names = Array.from(selectedSet);
    if (names.length === 0) return;
    const ok = await confirm({
      icon: '🗑️',
      title: `Borrar ${names.length} entrada${names.length === 1 ? '' : 's'}`,
      message: `¿Eliminar las ${names.length} entrada${names.length === 1 ? '' : 's'} seleccionada${names.length === 1 ? '' : 's'} del catálogo?`,
      footnote:
        'Se hace un backup automático antes — recuperable desde ' +
        'Configuración → Backups. Esta acción NO se puede deshacer desde la UI.',
      variant: 'danger',
      confirmLabel: `Borrar ${names.length}`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await data.bulkRemove(names);
      exitSelectionMode();
      const detail =
        `${res.removed} eliminada${res.removed === 1 ? '' : 's'} · ` +
        `${res.remaining} restante${res.remaining === 1 ? '' : 's'}` +
        (res.missing.length > 0
          ? ` · ${res.missing.length} no encontrada${res.missing.length === 1 ? '' : 's'}`
          : '');
      toast.success('Entradas eliminadas', detail);
    } catch (ex) {
      toast.error(
        'No se pudieron eliminar',
        ex instanceof Error ? ex.message : String(ex),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open || !gameId) return null;

  const kindLabel =
    KIND_LABELS[kind] ??
    profile?.categories.find((c) => c.id === kind)?.name ??
    kind;

  const isMultiline =
    kind === 'events' ||
    profile?.connectionType === 'rcon' ||
    gameId === 'minecraft';

  async function handleSubmit(entry: DataEntry, previousName?: string) {
    setBusy(true);
    try {
      const saved = await data.upsert(entry, previousName);
      data.setSelectedName(saved.name);
      setCreating(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(name: string) {
    setBusy(true);
    try {
      await data.remove(name);
    } finally {
      setBusy(false);
    }
  }

  async function handleLoadTutorial() {
    if (tutorial !== null) {
      setShowTutorial((v) => !v);
      return;
    }
    setBusy(true);
    try {
      const t = await data.loadTutorial();
      setTutorial(t || '');
      setShowTutorial(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    if (typeof window === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy(true);
      setImportStatus(null);
      try {
        const txt = await file.text();
        const parsed = JSON.parse(txt) as unknown;
        let entries: (DataEntry | string)[] | undefined;
        if (Array.isArray(parsed)) {
          entries = parsed as (DataEntry | string)[];
        } else if (parsed && typeof parsed === 'object') {
          const obj = parsed as Record<string, unknown>;
          if (Array.isArray(obj.entries)) {
            entries = obj.entries as (DataEntry | string)[];
          } else if (Array.isArray(obj[kind])) {
            entries = obj[kind] as (DataEntry | string)[];
          }
        }
        if (!entries) {
          throw new Error('JSON no contiene un array de entradas');
        }
        const res = await data.importEntries(entries, false);
        setImportStatus(`✓ ${res.added} nuevas · ${res.total} en total`);
      } catch (ex) {
        setImportStatus(
          `✗ ${ex instanceof Error ? ex.message : String(ex)}`,
        );
      } finally {
        setBusy(false);
      }
    };
    input.click();
  }

  async function handleExport() {
    setBusy(true);
    try {
      const entries = await data.exportEntries();
      const blob = new Blob(
        [JSON.stringify({ kind, entries }, null, 2)],
        { type: 'application/json' },
      );
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${gameId}_${kind}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setBusy(false);
    }
  }

  const visibleCount = data.entries.length;
  const totalCount = data.total;

  return (
    <Dialog
      open
      onClose={closeModal}
      size="xl"
      bodyFlush
      title={`${profile?.icon ?? '🎮'} ${profile?.name ?? gameId} — ${kindLabel}`}
      description={`${totalCount} entradas en catálogo · ${visibleCount} visibles`}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3 bg-bg-elev/30">
        <Input
          prefix={<Search className="h-3.5 w-3.5" />}
          placeholder={`Buscar ${kindLabel.toLowerCase()}...`}
          value={data.search}
          onChange={(e) => data.setSearch(e.target.value)}
          className="flex-1 min-w-[220px]"
        />

        <Button
          variant="secondary"
          size="sm"
          onClick={() => void handleLoadTutorial()}
          disabled={busy}
          title="Mostrar ayuda / tutorial de esta categoría"
        >
          <Info className="h-3.5 w-3.5" />
          Ayuda
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => void handleImport()}
          disabled={busy}
          title="Importar JSON (acepta formato canónico o legacy 'X:Y')"
        >
          <Upload className="h-3.5 w-3.5" />
          Importar
        </Button>

        <Button
          variant={selectionMode ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => {
            if (selectionMode) {
              exitSelectionMode();
            } else {
              setSelectionMode(true);
              setCreating(false);
              data.setSelectedName(null);
            }
          }}
          disabled={busy || totalCount === 0}
          title={
            selectionMode
              ? 'Salir del modo selección múltiple'
              : 'Seleccionar varias entries para borrar de una vez'
          }
        >
          {selectionMode ? (
            <>
              <X className="h-3.5 w-3.5" />
              Salir selección
            </>
          ) : (
            <>
              <CheckSquare className="h-3.5 w-3.5" />
              Seleccionar varias
            </>
          )}
        </Button>

        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setCreating(true);
            data.setSelectedName(null);
            exitSelectionMode();
          }}
          disabled={selectionMode}
        >
          <Plus className="h-3.5 w-3.5" />
          Nueva
        </Button>
      </div>

      {showTutorial && tutorial !== null && (
        <div className="px-5 py-2.5 text-xs text-fg-muted border-b border-border bg-bg-elev/20 whitespace-pre-line">
          {tutorial.trim() ||
            'Sin tutorial declarado. Configurá uno en CustomGameDialog → tab "Categorías".'}
        </div>
      )}

      {importStatus && (
        <div className="px-5 py-2 text-xs border-b border-border bg-bg-elev/20">
          {importStatus}
        </div>
      )}

      {/* Cuerpo */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-w-0 overflow-y-auto px-5 py-4">
          {data.status === 'loading' && data.entries.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <Spinner />
            </div>
          ) : data.status === 'error' ? (
            <Empty
              icon={Package}
              title="No se pudieron cargar las entradas"
              description={data.error ?? 'Error desconocido'}
              action={
                <Button size="sm" onClick={() => void data.refresh()}>
                  Reintentar
                </Button>
              }
            />
          ) : visibleCount === 0 ? (
            <Empty
              icon={Package}
              title={data.search ? 'Sin resultados' : 'Catálogo vacío'}
              description={
                data.search
                  ? `No hay entradas que coincidan con "${data.search}".`
                  : 'Agregá una entrada o importá un JSON existente.'
              }
            />
          ) : (
            <div
              className="grid gap-3 content-start"
              style={{
                gridTemplateColumns:
                  'repeat(auto-fill, minmax(120px, 1fr))',
              }}
            >
              {data.entries.map((e) => (
                <EntryCard
                  key={`${e.name}::${e.command}`}
                  entry={e}
                  gameId={gameId}
                  category={kind}
                  selected={!selectionMode && e.name === data.selectedName}
                  inSelection={selectionMode && selectedSet.has(e.name)}
                  onSelect={(en) => {
                    if (selectionMode) {
                      toggleSelected(en.name);
                    } else {
                      data.setSelectedName(en.name);
                      setCreating(false);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <aside className="w-[320px] shrink-0 border-l border-border bg-bg-elev/30 overflow-y-auto">
          {selectionMode ? (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  ✓ Selección múltiple
                </h3>
                <button
                  type="button"
                  onClick={exitSelectionMode}
                  className="text-[11px] text-fg-subtle hover:text-fg-default underline"
                  disabled={busy}
                >
                  Salir
                </button>
              </div>
              <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs">
                <p className="text-fg-default">
                  <strong className="text-accent">{selectedSet.size}</strong>
                  {' '}
                  de {data.entries.length} visible{data.entries.length === 1 ? '' : 's'} seleccionada{selectedSet.size === 1 ? '' : 's'}
                </p>
                <p className="mt-1 text-fg-subtle leading-snug">
                  Tocá las entries para marcar/desmarcar. Al borrar, se hace
                  un backup automático antes — recuperable desde
                  Configuración → Backups.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={selectAllVisible}
                  disabled={busy || data.entries.length === 0}
                  title={
                    data.search
                      ? `Marcar las ${data.entries.length} que coinciden con "${data.search}"`
                      : 'Marcar todas las entries visibles'
                  }
                >
                  Todas ({data.entries.length})
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearSelection}
                  disabled={busy || selectedSet.size === 0}
                >
                  Ninguna
                </Button>
              </div>

              <Button
                variant="primary"
                size="md"
                onClick={() => void handleBulkDelete()}
                disabled={busy || selectedSet.size === 0}
                className="w-full !bg-danger hover:!bg-danger/90"
              >
                <Trash2 className="h-4 w-4" />
                Borrar {selectedSet.size > 0 && `(${selectedSet.size})`}
              </Button>

              {selectedSet.size > 0 && (
                <details className="rounded-md border border-border bg-bg-base/40 px-2 py-1.5 text-[11px]">
                  <summary className="cursor-pointer text-fg-subtle hover:text-fg-default">
                    Ver lista ({selectedSet.size})
                  </summary>
                  <ul className="mt-1.5 space-y-0.5 max-h-[200px] overflow-y-auto">
                    {Array.from(selectedSet)
                      .sort()
                      .map((name) => (
                        <li
                          key={name}
                          className="flex items-center justify-between gap-1 truncate"
                          title={name}
                        >
                          <span className="truncate text-fg-default">
                            {name}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleSelected(name)}
                            className="text-fg-subtle hover:text-danger shrink-0"
                            aria-label={`Quitar ${name} de la selección`}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                  </ul>
                </details>
              )}
            </div>
          ) : creating ? (
            <div className="p-4">
              <h3 className="mb-3 text-sm font-semibold">Nueva entrada</h3>
              <EntryEditForm
                entry={null}
                multilineCommand={isMultiline}
                gameId={gameId}
                kind={kind}
                busy={busy}
                onSubmit={handleSubmit}
                onCancel={() => setCreating(false)}
                onTest={data.testEntry}
              />
            </div>
          ) : data.selectedEntry ? (
            <div className="flex flex-col">
              <EntryPreviewPanel
                entry={data.selectedEntry}
                gameId={gameId}
                category={kind}
              />
              <div className="border-t border-border px-4 py-3">
                <EntryEditForm
                  entry={data.selectedEntry}
                  multilineCommand={isMultiline}
                  gameId={gameId}
                  kind={kind}
                  busy={busy}
                  onSubmit={handleSubmit}
                  onDelete={handleDelete}
                  onTest={data.testEntry}
                />
              </div>
            </div>
          ) : (
            <EntryPreviewPanel entry={null} gameId={gameId} category={kind} />
          )}
        </aside>
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3 bg-bg-base/50">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleExport()}
          disabled={busy || totalCount === 0}
          title="Descargar JSON con las entradas actuales"
        >
          <Download className="h-3.5 w-3.5" />
          Exportar
        </Button>
        <div className="text-xs text-fg-subtle">
          {data.status === 'loading' && 'Cargando…'}
          {data.status === 'ready' && `${visibleCount} de ${totalCount}`}
        </div>
        <Button variant="secondary" size="sm" onClick={closeModal}>
          Cerrar
        </Button>
      </footer>
    </Dialog>
  );
}
