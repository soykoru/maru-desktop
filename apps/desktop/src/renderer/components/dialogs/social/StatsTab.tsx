import { useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button, Input, Label } from '@maru/ui';
import type { SocialStats } from '@maru/shared';

/**
 * `StatsTab` — TAB 5 del SocialConfigDialog.
 *
 * HTML banner con todas las stats globales + zona de peligro
 * (reset all data con doble confirm — el segundo pidiendo escribir DELETE).
 */
export interface StatsTabProps {
  stats: SocialStats;
  onRefresh: () => void | Promise<void>;
  onResetAll: () => Promise<number | undefined>;
  busy?: boolean;
}

export function StatsTab({
  stats,
  onRefresh,
  onResetAll,
  busy = false,
}: StatsTabProps) {
  const [stage, setStage] = useState<'idle' | 'first' | 'second'>('idle');
  const [confirmInput, setConfirmInput] = useState('');
  const [resetMsg, setResetMsg] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [working, setWorking] = useState(false);

  function cancel() {
    setStage('idle');
    setConfirmInput('');
  }

  async function doReset() {
    if (confirmInput !== 'DELETE') return;
    setWorking(true);
    setResetMsg(null);
    try {
      const at = await onResetAll();
      setResetMsg({
        ok: true,
        text: at
          ? `✓ Datos reseteados a las ${new Date(at).toLocaleTimeString()}.`
          : '✓ Datos reseteados.',
      });
      setStage('idle');
      setConfirmInput('');
    } catch (ex) {
      setResetMsg({
        ok: false,
        text: `✗ ${ex instanceof Error ? ex.message : String(ex)}`,
      });
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void onRefresh()}
          disabled={busy}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Actualizar
        </Button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {[
          { label: 'Total usuarios', value: stats.total_users, color: 'text-fg' },
          { label: 'Registrados', value: stats.registered_users, color: 'text-success' },
          { label: 'Total duelos', value: stats.total_duelos, color: 'text-accent-red' },
          { label: 'Total interacciones', value: stats.total_interacciones, color: 'text-info' },
          { label: 'Matrimonios totales', value: stats.total_matrimonios, color: 'text-warning' },
          { label: 'Divorcios', value: stats.total_divorcios, color: 'text-fg-muted' },
          { label: 'Noviazgos activos', value: stats.active_partnerships, color: 'text-accent' },
          { label: 'Amistades activas', value: stats.active_friendships, color: 'text-info' },
          { label: 'Rivalidades activas', value: stats.active_rivalries, color: 'text-accent-red' },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-border bg-bg-elev/30 px-3 py-2"
          >
            <p className="text-[11px] uppercase tracking-wider text-fg-subtle">
              {s.label}
            </p>
            <p className={`mt-1 text-xl font-bold ${s.color}`}>
              {s.value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {stats.top_streak && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
          🏆 <strong>Mayor racha:</strong> {stats.top_streak.username} con{' '}
          <span className="font-mono text-warning">
            {stats.top_streak.record} días
          </span>
        </div>
      )}

      {/* Danger zone */}
      <fieldset className="rounded-xl border-2 border-danger/50 bg-danger/5 p-3 space-y-2">
        <legend className="px-2 text-xs font-bold uppercase tracking-wider text-danger flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> Zona de Peligro
        </legend>
        <p className="text-xs text-fg-muted">
          Esta acción elimina <strong>TODOS</strong> los datos del sistema social:
          usuarios, registros, racha, relaciones (matrimonios, noviazgos,
          amistades, rivalidades), stats globales y comandos pendientes.
          La configuración del sistema se preserva.
        </p>

        {stage === 'idle' && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => setStage('first')}
            disabled={busy}
          >
            🗑️ Eliminar TODOS los datos
          </Button>
        )}

        {stage === 'first' && (
          <div className="space-y-2 rounded-md border border-danger/40 bg-bg-elev p-3">
            <p className="text-xs">
              ⚠️ ¿Estás <em>seguro</em> de eliminar TODOS los datos? Esta acción
              no se puede deshacer.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={cancel}
                disabled={busy || working}
              >
                Cancelar
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => setStage('second')}
                disabled={busy || working}
              >
                Sí, continuar
              </Button>
            </div>
          </div>
        )}

        {stage === 'second' && (
          <div className="space-y-2 rounded-md border border-danger/40 bg-bg-elev p-3">
            <p className="text-xs">
              Para confirmar, escribí <code className="font-mono text-danger">DELETE</code>{' '}
              en mayúsculas:
            </p>
            <Input
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder="DELETE"
              disabled={working}
              autoFocus
              invalid={confirmInput.length > 0 && confirmInput !== 'DELETE'}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={cancel}
                disabled={working}
              >
                Cancelar
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => void doReset()}
                disabled={confirmInput !== 'DELETE' || working}
              >
                {working ? 'Eliminando…' : 'Eliminar TODO'}
              </Button>
            </div>
          </div>
        )}

        {resetMsg && (
          <div
            className={
              'rounded-md px-3 py-2 text-xs ' +
              (resetMsg.ok
                ? 'border border-success/40 bg-success/10 text-success'
                : 'border border-danger/40 bg-danger/10 text-danger')
            }
          >
            {resetMsg.text}
          </div>
        )}
      </fieldset>
    </div>
  );
}
