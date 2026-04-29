import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Plug, XCircle } from 'lucide-react';
import { Button, Dialog, Input, Label } from '@maru/ui';
import type { GameId, GameProfile } from '@maru/shared';
import { useGames } from '../../../lib/use-games.js';

/**
 * `EditPredefinedDialog` — sub-modal de configuración de host/port/password
 * para los 3 perfiles predefinidos.
 *
 * Réplica de `manage_games_dialog.py:EditPredefinedDialog`:
 *   - Form: host + port (+ password solo Minecraft).
 *   - Auto-test debounce 800ms para HTTP cuando cambian host/port.
 *   - Para Minecraft (RCON) NO se hace auto-test (consume RAM al abrir
 *     socket); el usuario debe pulsar "Probar Conexión".
 *   - Test result label colorida (verde / rojo / loading).
 *
 * Mejoras sobre original:
 *   - Botón Test deshabilitado mientras corre.
 *   - aria-live para que lectores de pantalla anuncien el resultado.
 *   - Cancela auto-test pendiente al cerrar el modal.
 */
export interface EditPredefinedDialogProps {
  open: boolean;
  gameId: GameId;
  onClose: () => void;
}

const AUTOTEST_DEBOUNCE_MS = 800;

export function EditPredefinedDialog({
  open,
  gameId,
  onClose,
}: EditPredefinedDialogProps) {
  const { byId, configure, testConnection } = useGames({ autoLoad: false });
  const profile = byId(gameId);

  const [host, setHost] = useState('');
  const [port, setPort] = useState(0);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const debounceRef = useRef<number | null>(null);
  const idPrefix = useId();

  // Reset al abrir / cambiar de gid.
  useEffect(() => {
    if (!open || !profile) return;
    setHost(profile.connection.host);
    setPort(profile.connection.port);
    setPassword(profile.connection.password ?? '');
    setResult(null);
    setBusy(false);
    setTesting(false);
  }, [open, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-test debounce (solo HTTP).
  useEffect(() => {
    if (!open || !profile) return;
    if (profile.connectionType !== 'http') return;
    if (!host || !port) return;

    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      void runTest(true);
    }, AUTOTEST_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, host, port, password, profile?.connectionType]);

  if (!open || !profile) {
    return null;
  }

  const isRcon = profile.connectionType === 'rcon';

  async function runTest(silent: boolean) {
    if (!profile) return;
    setTesting(true);
    if (!silent) setResult(null);
    try {
      const res = await testConnection(profile.id, {
        host,
        port,
        password,
      });
      setResult(res);
    } catch (ex) {
      setResult({
        ok: false,
        message: ex instanceof Error ? ex.message : String(ex),
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await configure(profile!.id, { host, port, password });
      onClose();
    } catch (ex) {
      setResult({
        ok: false,
        message: ex instanceof Error ? ex.message : String(ex),
      });
    } finally {
      setBusy(false);
    }
  }

  const portInvalid = !port || port < 1 || port > 65535;
  const hostInvalid = !host.trim();
  const canSave = !busy && !portInvalid && !hostInvalid;

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`${profile.icon} ${profile.name}`}
      description={
        isRcon
          ? 'Configurá el RCON. Recordá: probar abre el socket y consume RAM.'
          : 'Auto-test cada 800 ms al cambiar host o puerto.'
      }
    >
      <form onSubmit={handleSave} className="space-y-3">
        <div>
          <Label htmlFor={`${idPrefix}-host`} required>
            Host
          </Label>
          <Input
            id={`${idPrefix}-host`}
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="127.0.0.1"
            invalid={hostInvalid}
            disabled={busy}
            autoFocus
          />
        </div>

        <div>
          <Label htmlFor={`${idPrefix}-port`} required>
            Puerto
          </Label>
          <Input
            id={`${idPrefix}-port`}
            type="number"
            min={1}
            max={65535}
            step={1}
            value={String(port || '')}
            onChange={(e) =>
              setPort(Math.max(0, Math.min(65535, parseInt(e.target.value, 10) || 0)))
            }
            invalid={portInvalid}
            disabled={busy}
          />
        </div>

        {isRcon && (
          <div>
            <Label htmlFor={`${idPrefix}-pass`}>Contraseña RCON</Label>
            <Input
              id={`${idPrefix}-pass`}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              disabled={busy}
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={testing || hostInvalid || portInvalid}
            onClick={() => void runTest(false)}
          >
            {testing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Probando…
              </>
            ) : (
              <>
                <Plug className="h-3.5 w-3.5" />
                Probar Conexión
              </>
            )}
          </Button>

          <div
            aria-live="polite"
            className="flex items-center gap-1.5 text-xs"
          >
            {result &&
              (result.ok ? (
                <span className="flex items-center gap-1 text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {result.message || 'OK'}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-danger">
                  <XCircle className="h-3.5 w-3.5" />
                  {result.message || 'Fallo'}
                </span>
              ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={!canSave}>
            Guardar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
