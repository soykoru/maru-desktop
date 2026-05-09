import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button, Dialog } from '@maru/ui';
import { Power, RefreshCw, Shuffle } from 'lucide-react';
import type { OverlayInfo, OverlaysListResult } from '@maru/shared';
import { useAppStore } from '../../lib/store/index.js';
import { rpcCall } from '../../lib/rpc.js';
import { OverlayEditor } from './OverlayEditor.js';
import { OverlayPreview } from './OverlayPreview.js';

/**
 * `OverlaysDialog` — panel principal de gestión de overlays.
 *
 * Layout 3 columnas:
 *   [galería ──┃ editor ──┃ preview en vivo]
 *      18%         32%         50%
 *
 * Comportamiento:
 *   - Lazy-loaded vía `lazy()` en `ModalRoot.tsx` — el JS de este panel
 *     NO se descarga hasta que el user lo abre. Cuando cierra, el iframe
 *     del preview se desmonta y libera memoria del WebSocket interno y
 *     los timers del overlay.
 *   - El uplink WS del sidecar SIGUE activo aunque este panel esté
 *     cerrado, así los eventos del live llegan al overlay público en
 *     TikTok Studio sin importar si el editor está abierto o no.
 *   - Cambios en el editor se persisten con debounce y se broadcastean
 *     al instante a todos los browser sources (DO del Worker reenvía).
 */
export function OverlaysDialog(): ReactNode {
  const open = useAppStore((s) =>
    s.modalStack.some((f) => f.id === 'overlays'),
  );
  const closeModal = useAppStore((s) => s.closeModal);

  const [data, setData] = useState<OverlaysListResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyFlash, setCopyFlash] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  // Cargar lista al abrir.
  const loadList = useCallback(async () => {
    setError(null);
    try {
      const r = await rpcCall('overlays.list', {});
      setData(r);
      // Seleccionar el primer overlay por default si no hay nada elegido.
      setSelectedId((prev) => prev ?? r.overlays[0]?.id ?? null);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadList();
  }, [open, loadList]);

  // Reset de selección al cerrar para que la próxima apertura empiece
  // con el primer overlay (fresco) y no con un id que pueda haber dejado
  // de existir si tocamos el registry.
  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setData(null);
    }
  }, [open]);

  if (!open) return null;

  const overlays = data?.overlays ?? [];
  const selected =
    overlays.find((o) => o.id === selectedId) ?? overlays[0] ?? null;

  const copyUrl = async () => {
    if (!selected) return;
    try {
      const ok = await window.maruApi.clipboard.write(selected.url);
      if (!ok) {
        await navigator.clipboard?.writeText(selected.url);
      }
    } catch {
      try {
        await navigator.clipboard?.writeText(selected.url);
      } catch {
        /* swallow */
      }
    }
    setCopyFlash(true);
    window.setTimeout(() => setCopyFlash(false), 1200);
  };

  const regenerateUserId = async () => {
    if (!confirm(
      'Regenerar tu ID anónimo invalida las URLs viejas pegadas en TikTok Studio. Vas a tener que actualizar el Browser Source. ¿Seguir?',
    )) {
      return;
    }
    try {
      await rpcCall('overlays.identity-set', { regenerate: true });
      await loadList();
      setPreviewKey((k) => k + 1);
    } catch {
      /* swallow — la UI re-cargará si no hubo cambio */
    }
  };

  /** v1.0.69: master switch para apagar overlays y ahorrar RAM cuando
   *  el user no los está usando. Apaga 3 loops async + WS uplink. */
  const toggleEnabled = async () => {
    const next = !(data?.enabled ?? true);
    if (!next && !confirm(
      'Apagar overlays detiene todos los loops y libera la RAM que usaban (~25-40MB). Las URLs públicas siguen siendo válidas — al volver a prender, los Browser Sources de TikTok Studio se reconectan automáticamente.\n\n¿Apagar overlays?',
    )) {
      return;
    }
    try {
      await rpcCall('overlays.set-enabled', { enabled: next });
      await loadList();
    } catch {
      /* swallow — la UI re-cargará si no hubo cambio */
    }
  };

  return (
    <Dialog
      open
      onClose={closeModal}
      size="2xl"
      bodyFlush
      title="🎬 Overlays para Stream"
      description="Editá tus overlays y pegá la URL en TikTok Studio como Browser Source. Los cambios se aplican al instante sin recargar."
    >
      <div className="grid min-h-0 flex-1 grid-cols-[200px_minmax(0,380px)_1fr] gap-3 px-4 pb-3">
        {/* ─── Columna 1: galería ────────────────────────────────── */}
        <aside className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-bg-elev/30">
          <header className="flex items-center justify-between border-b border-border px-3 py-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-fg-muted">
              Overlays
            </h3>
            <button
              type="button"
              onClick={() => void loadList()}
              title="Recargar lista"
              className="rounded p-1 text-fg-subtle hover:bg-bg-elev hover:text-fg"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto p-2">
            {error ? (
              <p className="px-2 py-3 text-xs text-danger">{error}</p>
            ) : overlays.length === 0 ? (
              <p className="px-2 py-3 text-xs italic text-fg-subtle">
                Cargando overlays…
              </p>
            ) : (
              <ul className="space-y-1.5">
                {overlays.map((o) => (
                  <li key={o.id}>
                    <OverlayCardItem
                      overlay={o}
                      active={selected?.id === o.id}
                      onClick={() => setSelectedId(o.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <footer className="border-t border-border px-3 py-2 text-[10px] text-fg-subtle">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate" title={data?.userId ?? ''}>
                ID: <code>{data?.userId ?? '—'}</code>
              </span>
              <button
                type="button"
                onClick={() => void regenerateUserId()}
                title="Regenerar mi alias (cambia las URLs)"
                className="shrink-0 rounded p-0.5 text-fg-subtle hover:text-fg"
              >
                <Shuffle className="h-3 w-3" />
              </button>
            </div>
          </footer>
        </aside>

        {/* ─── Columna 2: editor ────────────────────────────────── */}
        <section className="h-full overflow-hidden rounded-xl border border-border bg-bg-elev/20">
          {selected ? (
            <OverlayEditor
              key={selected.id}
              overlay={selected}
              onCopyUrl={() => void copyUrl()}
              onCopiedFlash={copyFlash}
            />
          ) : (
            <p className="p-4 text-xs italic text-fg-subtle">
              Elegí un overlay para editar.
            </p>
          )}
        </section>

        {/* ─── Columna 3: preview en vivo ────────────────────────── */}
        <section className="h-full overflow-hidden rounded-xl">
          {selected ? (
            <OverlayPreview
              key={selected.id}
              url={selected.url}
              aspect={selected.previewAspect}
              reloadToken={`${selected.id}-${previewKey}`}
            />
          ) : (
            <div className="grid h-full place-items-center rounded-xl border border-border bg-black text-xs text-fg-subtle">
              Sin selección
            </div>
          )}
        </section>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-3 bg-bg-base/50">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => void toggleEnabled()}
            title={
              data?.enabled === false
                ? 'Overlays apagados. Click para reactivar (loops async + WS uplink).'
                : 'Apagar overlays para ahorrar ~25-40MB de RAM. Las URLs siguen siendo válidas.'
            }
            className={[
              'flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors',
              data?.enabled === false
                ? 'border-warn/50 bg-warn/10 text-warn hover:bg-warn/20'
                : 'border-success/40 bg-success/10 text-success hover:bg-success/20',
            ].join(' ')}
          >
            <Power className="h-3 w-3" />
            {data?.enabled === false ? 'Apagados · Encender' : 'Encendidos · Apagar'}
          </button>
          <p className="truncate text-[11px] text-fg-subtle">
            {data?.publicDomain ? (
              <>
                Servidos desde <code>{data.publicDomain}</code>. Backend en
                Cloudflare — gratis, baja latencia.
              </>
            ) : (
              'Conectando con el servidor de overlays…'
            )}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={closeModal}>
          Cerrar
        </Button>
      </footer>
    </Dialog>
  );
}

function OverlayCardItem({
  overlay,
  active,
  onClick,
}: {
  overlay: OverlayInfo;
  active: boolean;
  onClick(): void;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors',
        active
          ? 'border-accent bg-accent/10 ring-1 ring-accent/40'
          : 'border-border bg-bg-base/40 hover:border-fg-muted hover:bg-bg-base/70',
      ].join(' ')}
    >
      <span className="text-lg leading-none" aria-hidden>
        {overlay.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-bold leading-tight">{overlay.name}</div>
        <div className="mt-0.5 line-clamp-2 text-[10px] text-fg-subtle">
          {overlay.description}
        </div>
      </div>
    </button>
  );
}
