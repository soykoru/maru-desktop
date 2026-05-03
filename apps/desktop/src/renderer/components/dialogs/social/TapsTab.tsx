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
          // Wrapper con scroll vertical PROPIO (overflow-y-auto) — sin
          // esto, el sticky se referencia contra el padre del dialog y
          // el header se sobrepone a las filas al scrollear (mismo bug
          // raíz que se arregló en UsersTab).
          <div className="overflow-y-auto overflow-x-auto max-h-[280px] relative">
            <table className="w-full text-xs border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-fg-subtle">
                  <th className="sticky top-0 z-20 bg-bg-elev px-3 py-2 font-medium w-12 border-b border-border">#</th>
                  <th className="sticky top-0 z-20 bg-bg-elev px-2 py-2 font-medium border-b border-border">Usuario</th>
                  <th className="sticky top-0 z-20 bg-bg-elev px-2 py-2 font-medium text-right w-20 border-b border-border">Taps</th>
                  <th className="sticky top-0 z-20 bg-bg-elev px-2 py-2 font-medium text-right w-24 border-b border-border">Última act.</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((r, i) => {
                  const isSF = !!r.is_super_fan;
                  return (
                    <tr
                      key={r.username}
                      className={[
                        'transition-colors',
                        isSF ? 'maru-super-fan-row hover:bg-warning/8' : 'hover:bg-fg/5',
                      ].join(' ')}
                    >
                      <td className={`px-3 py-1.5 font-bold border-b border-border/50 ${MEDAL_COLOR[i] ?? 'text-fg-subtle'}`}>
                        {MEDAL[i] ?? `#${i + 1}`}
                      </td>
                      <td className="px-2 py-1.5 border-b border-border/50" title={r.username}>
                        <div className="flex items-center gap-2 max-w-[200px]">
                          {r.avatar ? (
                            <img
                              src={r.avatar}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              referrerPolicy="no-referrer"
                              className={[
                                'h-6 w-6 rounded-full object-cover flex-shrink-0',
                                isSF ? 'maru-super-fan-avatar-ring' : 'border border-border',
                              ].join(' ')}
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <span
                              className={[
                                'h-6 w-6 rounded-full grid place-items-center text-[10px] font-bold flex-shrink-0',
                                isSF
                                  ? 'maru-super-fan-avatar-ring bg-warning/15 text-warning'
                                  : 'bg-fg/10 text-fg-muted',
                              ].join(' ')}
                              aria-hidden="true"
                            >
                              {r.username.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <span className="truncate flex items-center gap-1">
                            {r.username}
                            {isSF && (
                              <span
                                className="maru-role-chip maru-role-chip--superfan"
                                title="Super Fan del live"
                              >
                                fan
                              </span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-accent-red border-b border-border/50">
                        {r.taps.toLocaleString()}
                      </td>
                      <td className="px-2 py-1.5 text-right text-fg-muted text-[11px] border-b border-border/50">
                        {formatLastActive(r.lastActive)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
