import { Download, RefreshCw, X } from 'lucide-react';
import { Button } from '@maru/ui';
import { useAppStore } from '../lib/store/index.js';

/**
 * `UpdateBanner` — banner flotante con estado del auto-updater.
 *
 * Estados visibles:
 *   - `available`: "🎉 Versión X disponible" + botón "Descargar"
 *   - `downloading`: progress bar con percent + bytes
 *   - `ready`: "✅ Listo para reiniciar" + botón "Reiniciar ahora"
 *   - `error`: "⚠️ Error: X" + botón "Reintentar"
 *
 * Se oculta cuando `bannerDismissed=true` o cuando phase es idle/checking/
 * not-available/disabled. El usuario puede cerrarlo con la X — vuelve a
 * aparecer cuando llega un nuevo estado relevante.
 *
 * Paridad con MARU original que mostraba banner inline al detectar update.
 */
export function UpdateBanner() {
  const updater = useAppStore((s) => s.updater);
  const dismissed = useAppStore((s) => s.bannerDismissed);
  const dismiss = useAppStore((s) => s.dismissBanner);

  if (dismissed) return null;
  if (
    updater.phase === 'idle' ||
    updater.phase === 'checking' ||
    updater.phase === 'not-available' ||
    updater.phase === 'disabled'
  ) {
    return null;
  }

  let content: React.ReactNode = null;

  if (updater.phase === 'available') {
    content = (
      <>
        <div className="flex-1">
          <p className="text-sm font-semibold">
            🎉 Nueva versión disponible: v{updater.version}
          </p>
          <p className="text-[11px] text-fg-subtle">
            Una actualización se descargará en segundo plano.
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          onClick={() => void window.maruApi.updater.checkNow()}
        >
          <Download className="h-3.5 w-3.5" />
          Descargar
        </Button>
      </>
    );
  } else if (updater.phase === 'downloading') {
    const pct = Math.round(updater.percent);
    const mb = (updater.transferredBytes / 1024 / 1024).toFixed(1);
    const total = (updater.totalBytes / 1024 / 1024).toFixed(1);
    const kbps = Math.round(updater.bytesPerSecond / 1024);
    content = (
      <>
        <div className="flex-1">
          <p className="text-sm font-semibold">
            ⬇️ Descargando actualización… {pct}%
          </p>
          <div className="mt-1 h-1.5 w-full rounded-full bg-bg-base/60 overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[10px] text-fg-subtle mt-0.5">
            {mb} / {total} MB · {kbps} KB/s
          </p>
        </div>
      </>
    );
  } else if (updater.phase === 'ready') {
    content = (
      <>
        <div className="flex-1">
          <p className="text-sm font-semibold">
            ✅ v{updater.version} listo para instalar
          </p>
          <p className="text-[11px] text-fg-subtle">
            Reiniciá para aplicar la actualización.
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          onClick={() => void window.maruApi.updater.installAndRestart()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Reiniciar ahora
        </Button>
      </>
    );
  } else if (updater.phase === 'error') {
    content = (
      <>
        <div className="flex-1">
          <p className="text-sm font-semibold text-danger">
            ⚠️ Error en updater
          </p>
          <p className="text-[11px] text-fg-subtle break-all">
            {updater.message}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void window.maruApi.updater.checkNow()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Reintentar
        </Button>
      </>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[5000] max-w-[420px] rounded-xl border border-accent/40 bg-bg-elev/95 backdrop-blur p-3 shadow-2xl flex items-start gap-3 animate-fade-in"
    >
      {content}
      <button
        type="button"
        onClick={dismiss}
        className="text-fg-subtle hover:text-fg shrink-0 mt-0.5"
        aria-label="Cerrar"
        title="Cerrar (vuelve si llega nuevo estado)"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
