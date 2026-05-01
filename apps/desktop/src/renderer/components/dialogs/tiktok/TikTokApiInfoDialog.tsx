import { useEffect, useState } from 'react';
import { Activity, AlertCircle, Check, Key, RefreshCw, X } from 'lucide-react';
import { Badge, Button, Dialog } from '@maru/ui';
import { rpcCall } from '../../../lib/rpc.js';
import { useAppStore } from '../../../lib/store/index.js';

interface TikTokStatus {
  connected: boolean;
  username?: string | null;
  version?: string;
  reconnectAttempts?: number;
  autoReconnect?: boolean;
  signKeyConfigured?: boolean;
  lastError?: string;
  stats?: {
    viewers?: number;
    likes?: number;
    diamonds?: number;
    followers?: number;
    shares?: number;
  };
}

/**
 * `TikTokApiInfoDialog` — modal de diagnóstico del cliente TikTokLive.
 *
 * Reemplaza el `alert()` nativo del browser que en Electron a veces
 * quedaba silente y no permitía copiar la info ni accionar sobre los
 * problemas. Muestra estado, versión, errores y atajos a acciones de
 * recuperación.
 */
export function TikTokApiInfoDialog() {
  const open = useAppStore((s) =>
    s.modalStack.some((f) => f.id === 'tiktok-api-info'),
  );
  const closeModal = useAppStore((s) => s.closeModal);
  const openModal = useAppStore((s) => s.openModal);
  // Datos en TIEMPO REAL desde el store del frontend (actualizado por
  // push events `tiktok:stats` y `tiktok:status`). Antes solo leíamos
  // del RPC `tiktok.status` que devolvía un snapshot único — si el
  // user abría el modal sin clickear Refresh, los stats quedaban
  // congelados aunque el live siguiera generando eventos.
  const tiktokStatus = useAppStore((s) => s.tiktokStatus);
  const tiktokUsername = useAppStore((s) => s.tiktokUsername);
  const tiktokStats = useAppStore((s) => s.tiktokStats);

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<TikTokStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const r = (await rpcCall('tiktok.status', {})) as TikTokStatus;
      setStatus(r);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void refresh();
    // Auto-refresh cada 5s mientras el dialog está abierto, para
    // que `version`/`signKey`/`lastError` también se mantengan al
    // día (los stats vivos vienen del store, los demás del RPC).
    const id = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(id);
  }, [open]);

  if (!open) return null;

  // Datos efectivos: priorizar el store (push events live) sobre el
  // snapshot del RPC para los campos de runtime.
  const isConnected = tiktokStatus === 'connected' || !!status?.connected;
  const usernameToShow = tiktokUsername || status?.username || null;
  const statsToShow = tiktokStats || status?.stats || {};

  return (
    <Dialog
      open
      onClose={closeModal}
      size="md"
      title="🔧 Diagnóstico TikTok API"
      description="Estado del cliente TikTokLive y acciones de recuperación."
    >
      <div className="space-y-3 px-1">
        {error && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">No pude consultar el sidecar</div>
              <div className="opacity-80">{error}</div>
            </div>
          </div>
        )}

        {/* SIEMPRE renderear las secciones — antes el bloque solo se
            mostraba si `(status || isConnected)`, lo que dejaba el
            modal en blanco si el RPC no había respondido aún o el
            user no estaba conectado al live. Ahora se ven los
            valores reales (incluso 0 / —) para diagnóstico. */}
        {!status && !error && (
          <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-fg-muted flex items-center gap-2">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            Consultando sidecar…
          </div>
        )}
        <>
            {/* Estado conexión */}
            <div className="rounded-xl border border-border bg-bg-elev/40 p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                  Estado
                </span>
                {isConnected ? (
                  <Badge variant="success">🟢 Conectado</Badge>
                ) : (
                  <Badge variant="default">⚪ Desconectado</Badge>
                )}
              </div>
              {usernameToShow ? (
                <div className="text-sm">
                  Usuario: <strong>@{usernameToShow}</strong>
                </div>
              ) : (
                <div className="text-xs text-fg-subtle italic">
                  Sin usuario · conectate al live desde el sidebar
                </div>
              )}
              {!!status?.reconnectAttempts && status.reconnectAttempts > 0 && (
                <div className="text-xs text-warning flex items-center gap-1.5">
                  <Activity className="h-3 w-3" />
                  {status.reconnectAttempts} intento(s) de reconexión
                </div>
              )}
            </div>

            {/* Versión + signKey */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-border bg-bg-elev/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
                  TikTokLive
                </div>
                <div className="text-sm font-mono mt-0.5">
                  {status?.version || '—'}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-bg-elev/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-fg-subtle">
                  API key (eulerstream)
                </div>
                <div className="text-sm mt-0.5">
                  {status?.signKeyConfigured ? (
                    <span className="text-success flex items-center gap-1">
                      <Check className="h-3.5 w-3.5" /> Configurada
                    </span>
                  ) : (
                    <span className="text-fg-muted">Sin configurar</span>
                  )}
                </div>
              </div>
            </div>

            {/* Stats — siempre visibles, vienen del store con push events */}
            <div className="rounded-xl border border-border bg-bg-elev/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-fg-subtle mb-1.5">
                Stats sesión {isConnected && '(en vivo)'}
              </div>
              <div className="grid grid-cols-5 gap-2 text-center text-xs">
                <div>
                  <div className="text-fg-subtle text-[10px]">👥</div>
                  <div className="font-mono">{statsToShow.viewers ?? 0}</div>
                </div>
                <div>
                  <div className="text-fg-subtle text-[10px]">❤️</div>
                  <div className="font-mono">{statsToShow.likes ?? 0}</div>
                </div>
                <div>
                  <div className="text-fg-subtle text-[10px]">💎</div>
                  <div className="font-mono">{statsToShow.diamonds ?? 0}</div>
                </div>
                <div>
                  <div className="text-fg-subtle text-[10px]">➕</div>
                  <div className="font-mono">{statsToShow.followers ?? 0}</div>
                </div>
                <div>
                  <div className="text-fg-subtle text-[10px]">📤</div>
                  <div className="font-mono">{statsToShow.shares ?? 0}</div>
                </div>
              </div>
            </div>

            {/* Último error */}
            {status?.lastError && (
              <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-warning text-xs font-semibold uppercase tracking-wider">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Último error
                </div>
                <div className="text-xs text-fg-muted font-mono break-all">
                  {status.lastError}
                </div>
              </div>
            )}
        </>
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3 mt-4 -mx-5 -mb-4 bg-bg-base/50">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw className={'h-3.5 w-3.5' + (loading ? ' animate-spin' : '')} />
          Refrescar
        </Button>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              closeModal();
              openModal('tiktok-sign-key');
            }}
          >
            <Key className="h-3.5 w-3.5" />
            Configurar API key
          </Button>
          <Button variant="primary" size="sm" onClick={closeModal}>
            <X className="h-3.5 w-3.5" />
            Cerrar
          </Button>
        </div>
      </footer>
    </Dialog>
  );
}
