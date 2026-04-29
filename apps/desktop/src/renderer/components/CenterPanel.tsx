import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ListChecks } from 'lucide-react';
import { Card } from '@maru/ui';
import type { DataKind, GameProfile } from '@maru/shared';
import { useAppStore } from '../lib/store/index.js';
import { useGames } from '../lib/use-games.js';
import { CategoryTab } from './center/CategoryTab.js';
import { RulesTab } from './center/RulesTab.js';

/**
 * `CenterPanel` (G14 fix) — réplica del `_build_center_panel` MARU.
 *
 * Estructura espejo del MARU original:
 *   - Tab fija "📋 Reglas" (siempre primera).
 *   - Tabs dinámicas por **categoría del juego activo**:
 *       🐉 Entidades · 📦 Items · ⚡ Eventos · 💎 Valuables · <customs>
 *     Se regeneran cuando cambia `selectedGameId`.
 *   - Cada tab de categoría muestra galería de PNGs (consume
 *     `data.list(gameId, kind)` con imagePath del bundle) + botón
 *     "spawn directo" en cada card (paridad MARU
 *     `_test_category_item`).
 *
 * El game selector se mantiene en el header del panel para que el
 * usuario sepa qué juego está activo y pueda cambiar rápido sin ir al
 * sidebar.
 */
export function CenterPanel(): ReactNode {
  const selectedGameId = useAppStore((s) => s.selectedGameId);
  const setSelectedGameId = useAppStore((s) => s.setSelectedGameId);

  const { games, status: gamesStatus, byId } = useGames({ autoLoad: true });

  // Auto-seleccionar el primer juego cuando games carga.
  useEffect(() => {
    if (selectedGameId) return;
    if (gamesStatus !== 'ready') return;
    const firstStandard = games.find((g) => g.isStandard);
    const first = firstStandard ?? games[0];
    if (first) setSelectedGameId(first.id);
  }, [selectedGameId, gamesStatus, games, setSelectedGameId]);

  const profile: GameProfile | null = selectedGameId
    ? byId(selectedGameId)
    : null;

  // Categorías dinámicas del juego activo (paridad MARU
  // `_update_category_tabs`).
  const categories = useMemo<{ id: DataKind; label: string }[]>(() => {
    if (!profile) return [];
    // Si el juego es custom y declara `categories[]`, usarlas.
    if (!profile.isStandard && profile.categories.length > 0) {
      return profile.categories.map((c) => ({
        id: c.id as DataKind,
        label: c.name,
      }));
    }
    // Standard: derivar de hasEntities / hasItems / hasEvents + tabNames.
    const out: { id: DataKind; label: string }[] = [];
    if (profile.hasEntities) {
      out.push({
        id: 'entities',
        label: profile.tabNames?.entities ?? '🐉 Entidades',
      });
    }
    if (profile.hasItems) {
      out.push({
        id: 'items',
        label: profile.tabNames?.items ?? '📦 Items',
      });
    }
    if (profile.hasEvents) {
      out.push({
        id: 'events',
        label: profile.tabNames?.events ?? '⚡ Eventos',
      });
    }
    if (profile.hasValuables) {
      out.push({
        id: 'valuables',
        label: profile.tabNames?.valuables ?? '💎 Valuables',
      });
    }
    return out;
  }, [profile]);

  // Tab activa: "rules" o "cat:<id>". Reset al cambiar de juego.
  const [activeTab, setActiveTab] = useState<string>('rules');
  useEffect(() => {
    setActiveTab('rules');
  }, [selectedGameId]);

  return (
    <Card className="relative flex-1 flex flex-col overflow-hidden">
      {/* Header — el selector de juego vive en el sidebar (single source of
          truth). Acá mostramos contexto readonly del juego activo. */}
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-bg-elev/30">
        <ListChecks className="h-4 w-4 text-accent shrink-0" />
        <span className="text-sm font-semibold shrink-0">Centro de control</span>
        <div className="flex-1" />
        {profile && (
          <span className="text-xs text-fg-muted">
            Juego activo:{' '}
            <strong className="text-fg">
              {profile.icon} {profile.name}
            </strong>
          </span>
        )}
      </header>

      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Pestañas centrales"
        className="flex border-b border-border bg-bg-elev/20 overflow-x-auto"
      >
        <TabButton
          id="rules"
          label="📋 Reglas"
          active={activeTab === 'rules'}
          onClick={() => setActiveTab('rules')}
        />
        {categories.map((c) => {
          const tabId = `cat:${c.id}`;
          return (
            <TabButton
              key={tabId}
              id={tabId}
              label={c.label}
              active={activeTab === tabId}
              onClick={() => setActiveTab(tabId)}
            />
          );
        })}
      </div>

      {/* Contenido de la tab activa */}
      <div className="flex-1 min-h-0 flex flex-col">
        {activeTab === 'rules' ? (
          <RulesTab gameId={selectedGameId} profile={profile} />
        ) : (
          (() => {
            const catId = activeTab.startsWith('cat:')
              ? (activeTab.slice('cat:'.length) as DataKind)
              : null;
            const cat = categories.find((c) => c.id === catId);
            if (!catId || !cat || !selectedGameId) {
              return (
                <div className="flex-1 flex items-center justify-center text-xs text-fg-subtle">
                  Tab inválida — seleccioná otra arriba.
                </div>
              );
            }
            return (
              <CategoryTab
                gameId={selectedGameId}
                category={catId}
                categoryLabel={cat.label}
              />
            );
          })()
        )}
      </div>
    </Card>
  );
}

// ── Tab button compacto ──────────────────────────────────────────────────

function TabButton({
  id,
  label,
  active,
  onClick,
}: {
  id: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`tabpanel-${id}`}
      onClick={onClick}
      className={[
        'px-4 py-2 text-xs font-medium uppercase tracking-wider whitespace-nowrap',
        'transition-colors border-b-2',
        active
          ? 'text-accent border-accent bg-bg-elev/50'
          : 'text-fg-muted border-transparent hover:text-fg hover:bg-bg-elev/30',
      ].join(' ')}
    >
      {label}
    </button>
  );
}
