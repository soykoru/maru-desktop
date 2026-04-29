import { useEffect, useState } from 'react';
import { Button, Dialog, Input, Label } from '@maru/ui';
import { useAppStore } from '../../../lib/store/index.js';
import { rpcCall } from '../../../lib/rpc.js';

/**
 * `TikTokSignKeyDialog` — gestión de la API key de eulerstream
 * (`tiktok.eulerstream.com`), el servicio externo que TikTokLive 6.6.5
 * usa para firmar el WebSocket. El plan FREE tiene rate limit fuerte
 * (~1 conexión/minuto) → con la key gratuita registrándose en
 * eulerstream.com se desbloquean más conexiones simultáneas.
 *
 * La key se persiste en `runtime_data/secrets/tiktok_sign.key` y se
 * inyecta en `WebDefaults.tiktok_sign_api_key` en runtime — sin
 * reiniciar la app.
 */
export function TikTokSignKeyDialog() {
  const closeModal = useAppStore((s) => s.closeModal);
  const [hasKey, setHasKey] = useState(false);
  const [maskedKey, setMaskedKey] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void rpcCall('tiktok.sign-key.get', {})
      .then((r) => {
        setHasKey(r.hasKey);
        setMaskedKey(r.key);
      })
      .catch((ex) => setErr(ex instanceof Error ? ex.message : String(ex)));
  }, []);

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const key = input.trim();
      const r = await rpcCall('tiktok.sign-key.set', { key });
      if (!r.ok) {
        setErr(r.message || 'No se pudo guardar');
        return;
      }
      if (key) {
        setMsg('✅ Key guardada y activa. Reconectá para usarla.');
        setHasKey(true);
        setMaskedKey('********' + key.slice(-6));
      } else {
        setMsg('Key borrada — vuelve al plan free.');
        setHasKey(false);
        setMaskedKey('');
      }
      setInput('');
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={closeModal}
      title="🔑 API key — eulerstream (TikTokLive sign server)"
      size="md"
    >
      <div className="space-y-3 py-3 text-sm">
        <div className="rounded-md border border-border bg-bg-elev/30 p-3 text-xs space-y-2">
          <p>
            <strong>¿Qué es esto?</strong> TikTokLive 6.6.5 firma cada
            conexión usando un servicio externo:{' '}
            <code className="text-fg-default">tiktok.eulerstream.com</code>.
          </p>
          <p>
            <strong>Plan FREE</strong>: ~1 conexión/minuto. Si reconectás
            seguido (mientras pruebas), aparece{' '}
            <code className="text-danger">SIGN_NOT_200</code>.
          </p>
          <p>
            <strong>Solución</strong>: registrate gratis en{' '}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                void window.maruApi.shell.openExternal(
                  'https://www.eulerstream.com/',
                );
              }}
              className="text-accent underline"
            >
              eulerstream.com
            </a>
            , generá una API key, y pegala acá. Se guarda local en{' '}
            <code>secrets/tiktok_sign.key</code>.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sign-key-input">
            {hasKey ? 'Reemplazar key existente' : 'Pegar tu API key'}
          </Label>
          <Input
            id="sign-key-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              hasKey ? `Actual: ${maskedKey}` : 'eu_xxxxxxxxxxxxxxxxxxx'
            }
            disabled={busy}
            type="password"
            autoComplete="off"
          />
          <p className="text-[11px] text-fg-subtle">
            Dejá vacío y guardá para borrar la key actual.
          </p>
        </div>

        {msg && (
          <div className="rounded-md border border-success/40 bg-success/10 px-2 py-1.5 text-xs text-success">
            {msg}
          </div>
        )}
        {err && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1.5 text-xs text-danger">
            ❌ {err}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="ghost" size="sm" onClick={closeModal} disabled={busy}>
            Cerrar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void save()}
            disabled={busy}
          >
            {busy ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
