import { useEffect, useState } from 'react';
import { Trophy, RefreshCw, Camera, Trash2 } from 'lucide-react';
import { Button, Empty } from '@maru/ui';
import type {
  TopLiveCurrent,
  TopLiveRecord,
  TopLiveTopEntry,
  UserTopCounts,
} from '@maru/shared';
import { rpcCall } from '../../../lib/rpc.js';
import { useConfirm } from '../../../lib/use-notify.js';

/**
 * `TopLivesTab` — TAB 5 del SocialConfigDialog (v1.0.56).
 *
 * Histórico de top 3 likes por sesión de live. Hasta 5 lives guardados,
 * el más reciente arriba. Si hay un live activo se muestra como "EN
 * VIVO" con el snapshot live de los contadores actuales.
 *
 * Snapshot automático: el TopLivesService del sidecar suscribe al
 * EventBus y al `tiktok:status connected=False` toma el top 3 actual,
 * lo guarda en `data/top_lives.json` y actualiza counters por user.
 */
export function TopLivesTab({ open }: { open: boolean }) {
  const [lives, setLives] = useState<TopLiveRecord[]>([]);
  const [current, setCurrent] = useState<TopLiveCurrent | null>(null);
  const [_userCounts, setUserCounts] = useState<Record<string, UserTopCounts>>({});
  const [maxLives, setMaxLives] = useState(5);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await rpcCall('top-lives.list', {});
      setLives(r.lives);
      setCurrent(r.current);
      setUserCounts(r.userCounts);
      setMaxLives(r.maxLives ?? 5);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteLive(id: string) {
    const ok = await confirm({
      icon: '🗑️',
      title: 'Borrar este live',
      message: '¿Eliminar el registro de este live?',
      footnote: 'Se descontarán los podios de los users que aparecieron en esta sesión.',
      variant: 'danger',
      confirmLabel: 'Borrar',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await rpcCall('top-lives.delete', { id });
      await load();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }

  async function handleMaxLivesChange(n: number) {
    const clamped = Math.max(1, Math.min(50, n));
    setMaxLives(clamped);
    try {
      await rpcCall('top-lives.set-max', { max: clamped });
      await load();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    }
  }

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSnapshot() {
    setBusy(true);
    try {
      await rpcCall('top-lives.force-snapshot', {});
      await load();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    const ok = await confirm({
      icon: '⚠️',
      title: 'Borrar TODOS los lives',
      message: '¿Eliminar todos los lives guardados Y los contadores por usuario?',
      footnote: 'Esta acción afecta a todos los streams previos. No se puede deshacer.',
      variant: 'danger',
      confirmLabel: 'Borrar todo',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await rpcCall('top-lives.clear', {});
      await load();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          ⚠ {error}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/30 bg-gradient-to-br from-warning/15 via-warning/5 to-transparent px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-warning/20 text-warning shrink-0">
            <Trophy className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">
              Top 3 likes por sesión de live
            </p>
            <p className="text-[11px] text-fg-subtle leading-tight">
              Cuando termina el live (disconnect), MARU toma el top 3 y
              suma counters al perfil de cada usuario.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <label className="flex items-center gap-1.5 text-[11px] text-fg-muted">
            <span>Lives a guardar:</span>
            <input
              type="number"
              min={1}
              max={50}
              value={String(maxLives)}
              onChange={(e) => void handleMaxLivesChange(parseInt(e.target.value, 10) || 5)}
              className="maru-input w-16 text-xs h-7"
              title="Cantidad de lives en el histórico (1..50)"
            />
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void load()}
            disabled={loading || busy}
            title="Recargar"
          >
            <RefreshCw className={['h-3.5 w-3.5', loading && 'animate-spin'].filter(Boolean).join(' ')} />
            Recargar
          </Button>
          {current && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleSnapshot()}
              disabled={busy}
              title="Forzar snapshot del live activo (sin desconectar)"
            >
              <Camera className="h-3.5 w-3.5" />
              Snapshot ahora
            </Button>
          )}
        </div>
      </div>

      {/* Live actual */}
      {current && (
        <section className="rounded-2xl border-2 border-red-500/40 bg-red-500/5 p-4 space-y-3">
          <header className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
              </span>
              EN VIVO
              {current.username && (
                <span className="text-fg-subtle text-xs">
                  · @{current.username}
                </span>
              )}
            </h3>
            <span className="text-[11px] text-fg-subtle">
              Inicio: {formatTime(current.started_at)}
            </span>
          </header>
          <TopList items={current.top} highlight />
          {current.top.length === 0 && (
            <p className="text-xs text-fg-subtle italic text-center py-2">
              Aún no hay likes acumulados en esta sesión.
            </p>
          )}
        </section>
      )}

      {/* Lives histórico */}
      {lives.length === 0 && !current ? (
        <Empty
          icon={Trophy}
          title="Sin lives guardados todavía"
          description="Conectate al live, dale algunos likes y al desconectar se guardará automáticamente el top 3."
        />
      ) : (
        <div className="space-y-3">
          {lives.map((l) => (
            <LiveCard
              key={l.id}
              live={l}
              onDelete={() => void handleDeleteLive(l.id)}
              busy={busy}
            />
          ))}
        </div>
      )}

      {(lives.length > 0) && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleClear()}
            disabled={busy}
            title="Borrar todo el histórico"
          >
            <Trash2 className="h-3.5 w-3.5 text-red-400" />
            Borrar histórico
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Live card ──────────────────────────────────────────────────────────

function LiveCard({
  live,
  onDelete,
  busy,
}: {
  live: TopLiveRecord;
  onDelete: () => void;
  busy?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-bg-elev/30 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base">📅</span>
          <span className="text-sm font-semibold truncate">{formatDate(live.started_at)}</span>
          {live.username && (
            <span className="text-fg-subtle text-xs">· @{live.username}</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-fg-subtle">
          <span>⏱ {formatDuration(live.duration_min)}</span>
          <span>·</span>
          <span>{formatTime(live.started_at)} → {formatTime(live.ended_at)}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={busy}
            title="Borrar este live (descontará podios de los users)"
          >
            <Trash2 className="h-3.5 w-3.5 text-red-400" />
          </Button>
        </div>
      </header>
      <TopList items={live.top} />
    </div>
  );
}

// ── Top 3 list (podio) ─────────────────────────────────────────────────

function TopList({ items, highlight }: { items: TopLiveTopEntry[]; highlight?: boolean }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <ol className="grid gap-2 grid-cols-1 sm:grid-cols-3">
      {items.map((entry) => (
        <PodiumCard key={entry.place} entry={entry} highlight={highlight} />
      ))}
    </ol>
  );
}

const PLACE_META: Record<number, { color: string; medal: string; bg: string }> = {
  1: { color: '#ffc83d', medal: '🥇', bg: 'rgba(255,200,61,0.18)' },
  2: { color: '#c0c8d4', medal: '🥈', bg: 'rgba(192,200,212,0.15)' },
  3: { color: '#cd8a4d', medal: '🥉', bg: 'rgba(205,138,77,0.15)' },
};

function PodiumCard({ entry, highlight }: { entry: TopLiveTopEntry; highlight?: boolean }) {
  const meta = PLACE_META[entry.place] ?? PLACE_META[3]!;
  return (
    <li
      className="flex items-center gap-3 rounded-xl border p-2.5"
      style={{
        borderColor: `${meta.color}55`,
        background: highlight
          ? `linear-gradient(135deg, ${meta.bg} 0%, transparent 100%)`
          : meta.bg,
      }}
    >
      <span className="text-2xl shrink-0">{meta.medal}</span>
      {entry.avatar ? (
        <img
          src={entry.avatar}
          alt={entry.user}
          className="h-10 w-10 rounded-full object-cover shrink-0 border-2"
          style={{ borderColor: meta.color }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div
          className="h-10 w-10 rounded-full grid place-items-center shrink-0 text-sm font-bold"
          style={{
            background: `${meta.color}33`,
            color: meta.color,
            border: `2px solid ${meta.color}55`,
          }}
        >
          {entry.user.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">@{entry.user}</p>
        <p className="text-[11px]" style={{ color: meta.color }}>
          ❤️ {entry.taps.toLocaleString()} {entry.taps === 1 ? 'like' : 'likes'}
        </p>
      </div>
    </li>
  );
}

// ── Date utils ─────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('es', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatTime(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return '<1 min';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
