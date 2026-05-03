import { useEffect, useId, useState } from 'react';
import { Button, Dialog, Input, Label } from '@maru/ui';
import type { SocialUser } from '@maru/shared';

/**
 * `AutoRachaModal` — sub-modal del UsersTab.
 *
 * Réplica del subdialog `_auto_racha_dialog` (250×400 modal del MARU
 * original). Activa o desactiva la racha automática de un usuario,
 * con selector de días 1-365.
 */
export interface AutoRachaModalProps {
  open: boolean;
  user: SocialUser | null;
  onClose: () => void;
  /** kind opcional — "manual" (default) o "super_fan". */
  onActivate: (
    days: number,
    kind?: 'manual' | 'super_fan',
  ) => Promise<string | undefined>;
  onDeactivate: () => Promise<string | undefined>;
  busy?: boolean;
}

export function AutoRachaModal({
  open,
  user,
  onClose,
  onActivate,
  onDeactivate,
  busy = false,
}: AutoRachaModalProps) {
  const idPrefix = useId();
  const [days, setDays] = useState(7);
  const [kind, setKind] = useState<'manual' | 'super_fan'>('manual');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (open) {
      setDays(user?.auto_racha?.total_days ?? 7);
      setKind(user?.auto_racha?.kind === 'super_fan' ? 'super_fan' : 'manual');
      setMessage(null);
      setWorking(false);
    }
  }, [open, user?.username]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !user) return null;

  const isActive = !!user.auto_racha?.active;
  const userIsSF = !!user.is_super_fan;

  async function handleActivate() {
    setWorking(true);
    setMessage(null);
    try {
      const msg = await onActivate(days, kind);
      setMessage({ ok: true, text: msg ?? 'Activado.' });
    } catch (ex) {
      setMessage({
        ok: false,
        text: ex instanceof Error ? ex.message : String(ex),
      });
    } finally {
      setWorking(false);
    }
  }

  async function handleDeactivate() {
    setWorking(true);
    setMessage(null);
    try {
      const msg = await onDeactivate();
      setMessage({ ok: true, text: msg ?? 'Desactivado.' });
    } catch (ex) {
      setMessage({
        ok: false,
        text: ex instanceof Error ? ex.message : String(ex),
      });
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog
      open
      onClose={() => !working && onClose()}
      size="sm"
      title={`⚡ Racha Automática de ${user.username}`}
      description="Mantiene la racha activa sin que el usuario use !racha cada día."
    >
      <div className="space-y-3">
        {isActive && user.auto_racha && (
          <div
            className={
              user.auto_racha.kind === 'super_fan'
                ? 'rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs'
                : 'rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs'
            }
          >
            {user.auto_racha.kind === 'super_fan' ? (
              <>
                <span className="maru-super-fan-gold inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] tracking-wider leading-none mr-1">
                  ⭐ SUPER FAN
                </span>
                Activa hasta que finalice la suscripción Super Fan del live.
              </>
            ) : (
              <>
                ⚡ Activa: {user.auto_racha.remaining_days} de{' '}
                {user.auto_racha.total_days} días restantes.
              </>
            )}
          </div>
        )}

        <div>
          <Label>Tipo de racha</Label>
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={() => setKind('manual')}
              disabled={busy || working}
              className={[
                'flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                kind === 'manual'
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-border bg-bg-base text-fg-muted hover:border-fg-muted',
              ].join(' ')}
            >
              ⚡ Manual (N días)
            </button>
            <button
              type="button"
              onClick={() => setKind('super_fan')}
              disabled={busy || working}
              title={
                !userIsSF
                  ? 'El user no es Super Fan ahora — al activarla se mantendrá hasta que lo sea (o se desactiva auto si pierde el rol).'
                  : 'Activa la racha mientras el user mantenga Super Fan'
              }
              className={[
                'flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                kind === 'super_fan'
                  ? 'maru-super-fan-gold !text-warning border-warning/50'
                  : 'border-border bg-bg-base text-fg-muted hover:border-fg-muted',
              ].join(' ')}
            >
              ⭐ Super Fan
            </button>
          </div>
          <p className="mt-1 text-[11px] text-fg-subtle">
            {kind === 'super_fan'
              ? 'La racha durará hasta que finalice la suscripción Super Fan del user en el live. Se desactiva sola cuando lo pierda.'
              : 'Racha activa por una cantidad fija de días que vos definís.'}
          </p>
        </div>

        {kind === 'manual' && (
          <div>
            <Label htmlFor={`${idPrefix}-days`} required>
              Días a activar
            </Label>
            <Input
              id={`${idPrefix}-days`}
              type="number"
              min={1}
              max={365}
              value={String(days)}
              onChange={(e) =>
                setDays(Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 1)))
              }
              disabled={busy || working}
            />
            <p className="mt-1 text-[11px] text-fg-subtle">
              Rango 1-365. Default 7 (una semana).
            </p>
          </div>
        )}

        {message && (
          <div
            className={
              'rounded-md px-3 py-2 text-xs ' +
              (message.ok
                ? 'border border-success/40 bg-success/10 text-success'
                : 'border border-danger/40 bg-danger/10 text-danger')
            }
          >
            {message.text}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy || working}>
            Cerrar
          </Button>
          {isActive && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => void handleDeactivate()}
              disabled={busy || working}
            >
              ❌ Desactivar
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleActivate()}
            disabled={busy || working}
          >
            ✅ {isActive ? 'Reactivar' : 'Activar'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
