import { useState } from 'react';
import { RefreshCw, Sparkles, Heart } from 'lucide-react';
import { Button, Empty, Select, Spinner } from '@maru/ui';
import type { TapsPeriod, TapsRankingEntry } from '@maru/shared';

/**
 * `TapsTab` — TAB 4 del SocialConfigDialog.
 *
 * Réplica del tab `❤️ Taps Globales`:
 *   - Period selector (total / semanal / mensual).
 *   - Banner con totales.
 *   - Tabla top con medallas para top 3.
 *   - Cleanup inactive (> 7 días, excepto top 3).
 */

const PERIOD_LABELS: Record<TapsPeriod, string> = {
  total: '🌐 Total (siempre)',
  semanal: '📅 Semanal (7 días)',
  mensual: '📆 Mensual (30 días)',
};

const MEDAL: Record<number, string> = {
  0: '🥇',
  1: '🥈',
  2: '🥉',
};

const MEDAL_COLOR: Record<number, string> = {
  0: 'text-warning',
  1: 'text-fg-muted',
  2: 'text-accent-red',
};

export interface TapsTabProps {
  period: TapsPeriod;
  totalTaps: number;
  totalUsers: number;
  ranking: TapsRankingEntry[];
  onPeriodChange: (p: TapsPeriod) => void | Promise<void>;
  onCleanup: () => Promise<number>;
  onRefresh: () => void | Promise<void>;
  loading?: boolean;
  busy?: boolean;
}

function formatLastActive(value: string | number | null): string {
  if (!value) return '—';
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (Number.isNaN(ms)) return String(value);
  const diff = Date.now() - ms;
  const dayMs = 1000 * 60 * 60 * 24;
  if (diff < dayMs) return 'hoy';
  const days = Math.floor(diff / dayMs);
  if (days < 30) return `hace ${days}d`;
  const months = Math.floor(days / 30);
  return `hace ${months} mes${months > 1 ? 'es' : ''}`;
}

export function TapsTab({
  period,
  totalTaps,
  totalUsers,
  ranking,
  onPeriodChange,
  onCleanup,
  onRefresh,
  loading = false,
  busy = false,
}: TapsTabProps) {
  const [cleaning, setCleaning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);

  async function handleCleanup() {
    if (!confirm('¿Eliminar usuarios inactivos > 7 días (excepto top 3)?')) {
      return;
    }
    setCleaning(true);
    setCleanupResult(null);
    try {
      const removed = await onCleanup();
      setCleanupResult(`✓ ${removed} usuario(s) inactivos eliminados.`);
    } catch (ex) {
      setCleanupResult(
        `✗ ${ex instanceof Error ? ex.message : String(ex)}`,
      );
    } finally {
      setCleaning(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Select
          value={period}
          onChange={(e) => void onPeriodChange(e.target.value as TapsPeriod)}
          disabled={busy || loading}
          className="w-[180px]"
        >
          {(Object.keys(PERIOD_LABELS) as TapsPeriod[]).map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABELS[p]}
            </option>
          ))}
        </Select>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void onRefresh()}
          disabled={busy || loading}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Actualizar
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleCleanup()}
          disabled={busy || cleaning || ranking.length === 0}
          title="Eliminar usuarios inactivos > 7 días (excepto top 3)"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Limpiar inactivos
        </Button>
      </div>

      {cleanupResult && (
        <div className="rounded-md border border-border bg-bg-elev/30 px-3 py-1.5 text-xs">
          {cleanupResult}
        </div>
      )}

      {/* Banner */}
      <div className="rounded-xl border border-accent-red/40 bg-gradient-to-r from-accent-red/15 to-warning/15 px-4 py-3">
        <p className="text-sm font-bold flex items-center gap-3">
          <Heart className="h-4 w-4 text-accent-red" />
          {totalTaps.toLocaleString()} taps totales
          <span className="text-fg-muted">·</span>
          👥 {totalUsers} usuarios
          <span className="text-fg-muted">·</span>
          📊 Mostrando: {PERIOD_LABELS[period]}
        </p>
      </div>

      {/* Tabla top */}
      <div className="rounded-xl border border-border bg-bg-elev/30 overflow-hidden">
        {loading && ranking.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        ) : ranking.length === 0 ? (
          <Empty
            icon={Heart}
            title="Sin taps registrados"
            description="Cuando los viewers presionen el corazón aparecerán acá."
          />
        ) : (
          <div className="overflow-x-auto max-h-[280px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-bg-elev z-10">
                <tr className="border-b border-border text-left text-fg-subtle">
                  <th className="px-3 py-2 font-medium w-12">#</th>
                  <th className="px-2 py-2 font-medium">Usuario</th>
                  <th className="px-2 py-2 font-medium text-right w-20">Taps</th>
                  <th className="px-2 py-2 font-medium text-right w-24">Última act.</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((r, i) => (
                  <tr
                    key={r.username}
                    className="border-b border-border/50 hover:bg-fg/5"
                  >
                    <td className={`px-3 py-1.5 font-bold ${MEDAL_COLOR[i] ?? 'text-fg-subtle'}`}>
                      {MEDAL[i] ?? `#${i + 1}`}
                    </td>
                    <td className="px-2 py-1.5 truncate max-w-[180px]" title={r.username}>
                      {r.username}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-accent-red">
                      {r.taps.toLocaleString()}
                    </td>
                    <td className="px-2 py-1.5 text-right text-fg-muted text-[11px]">
                      {formatLastActive(r.lastActive)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
