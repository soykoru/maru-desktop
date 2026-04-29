import { useEffect, useState } from 'react';
import {
  Edit3,
  Loader2,
  Package,
  Play,
  Search,
  Wrench,
} from 'lucide-react';
import { Button, Empty, Input, Spinner } from '@maru/ui';
import type { DataKind, GameId } from '@maru/shared';
import { useAppStore } from '../../lib/store/index.js';
import { useData } from '../../lib/use-data.js';
import { EntryCard } from '../dialogs/data/EntryCard.js';

/**
 * `CategoryTab` — pestaña dinámica por categoría del juego activo.
 *
 * Réplica del MARU `_create_category_tab` (gui/views/category_tabs.py):
 *   - Search box arriba.
 *   - Botón "📝 Gestionar" → abre DataDialog modal para CRUD profundo.
 *   - Botón "🧪 Probar" → ejecuta la acción default (spawn N/give N).
 *   - Grid de cards con PNG → click ejecuta spawn/give/trigger directo.
 *
 * El dispatch directo desde la card es la pieza de UX que MARU original
 * tiene y que faltaba en mi build: hace el evento idéntico a "TestUser
 * envió tal entidad".
 */
export interface CategoryTabProps {
  gameId: GameId;
  category: DataKind;
  /** Display name (ej "🐉 Entidades"). */
  categoryLabel: string;
}

export function CategoryTab({
  gameId,
  category,
  categoryLabel,
}: CategoryTabProps) {
  const openModal = useAppStore((s) => s.openModal);
  const data = useData(gameId, category, { autoLoad: true });
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 2500);
    return () => window.clearTimeout(t);
  }, [flash]);

  function showFlash(ok: boolean, text: string) {
    setFlash({ ok, text });
  }

  async function handleSpawn(entryName: string, command: string) {
    setBusy(true);
    try {
      const res = await data.testEntry({
        name: entryName,
        command,
      });
      showFlash(
        res.ok,
        res.ok
          ? `✓ ${entryName} → ${res.message || 'enviado'}`
          : `✗ ${entryName}: ${res.message || 'falló'}`,
      );
    } catch (ex) {
      showFlash(false, ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }

  function openManage() {
    openModal('data', { gameId, kind: category });
  }

  const visibleCount = data.entries.length;
  const totalCount = data.total;

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-bg-elev/30">
        <Input
          prefix={<Search className="h-3.5 w-3.5" />}
          placeholder={`Buscar en ${categoryLabel}...`}
          value={data.search}
          onChange={(e) => data.setSearch(e.target.value)}
          className="flex-1 min-w-[200px]"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={openManage}
          disabled={busy}
          title="Abrir editor completo"
        >
          <Wrench className="h-3.5 w-3.5" />
          Gestionar
        </Button>
      </div>

      {flash && (
        <div
          aria-live="polite"
          className={
            'px-4 py-1.5 text-xs border-b border-border ' +
            (flash.ok
              ? 'bg-success/10 text-success'
              : 'bg-danger/10 text-danger')
          }
        >
          {flash.text}
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
        {data.status === 'loading' && data.entries.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <Spinner />
          </div>
        ) : data.status === 'error' ? (
          <Empty
            icon={Package}
            title="Error al cargar"
            description={data.error ?? '—'}
            action={
              <Button size="sm" onClick={() => void data.refresh()}>
                Reintentar
              </Button>
            }
          />
        ) : visibleCount === 0 ? (
          <Empty
            icon={Package}
            title={data.search ? 'Sin resultados' : `Sin ${categoryLabel.toLowerCase()}`}
            description={
              data.search
                ? `No hay entradas que coincidan con "${data.search}".`
                : 'Pulsá "Gestionar" para añadir entradas o importar JSON.'
            }
            action={
              !data.search && (
                <Button size="sm" onClick={openManage}>
                  <Edit3 className="h-3.5 w-3.5" />
                  Gestionar
                </Button>
              )
            }
          />
        ) : (
          <div
            className="grid gap-3 content-start"
            style={{
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            }}
          >
            {data.entries.map((e) => (
              <div key={`${e.name}::${e.command}`} className="relative">
                <EntryCard
                  entry={e}
                  gameId={gameId}
                  category={category}
                  selected={data.selectedName === e.name}
                  onSelect={(en) => data.setSelectedName(en.name)}
                  onConfirm={(en) => void handleSpawn(en.name, en.command)}
                />
                {/* Botón spawn rápido — replicar el "click→action directo"
                    del MARU original. */}
                <button
                  type="button"
                  onClick={() => void handleSpawn(e.name, e.command)}
                  disabled={busy}
                  title="Spawn / give / trigger directo (TestUser)"
                  className="absolute top-1 right-1 h-6 w-6 rounded-full bg-accent/80 text-bg flex items-center justify-center opacity-0 group-hover:opacity-100 hover:scale-110 transition-all shadow"
                >
                  {busy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer compacto */}
      <footer className="px-4 py-1.5 border-t border-border bg-bg-base/50 text-[11px] text-fg-subtle flex items-center justify-between">
        <span>
          {visibleCount} de {totalCount} · doble-click o Enter spawnea con
          TestUser
        </span>
        {data.status === 'loading' && (
          <span>
            <Loader2 className="h-3 w-3 animate-spin inline" /> cargando
          </span>
        )}
      </footer>
    </div>
  );
}
