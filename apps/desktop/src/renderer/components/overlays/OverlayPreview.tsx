import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ExternalLink, Minus, Plus, Maximize2 } from 'lucide-react';

/**
 * `OverlayPreview` — viewer ajustado al widget (sin huecos).
 *
 * - El iframe se renderiza al tamaño REAL (px) y se escala con CSS
 *   transform → ves el mismo render que TikTok Studio.
 * - El contenedor del preview se acopla a la cajita escalada — sin
 *   hueco vertical para widgets apaisados ni horizontal para verticales.
 * - Auto-fit recalcula zoom usando el espacio disponible REAL del panel.
 */
export interface OverlayPreviewProps {
  url: string;
  /** [ancho, alto] real del widget (px). */
  aspect?: [number, number];
  reloadToken?: string | number;
}

const SESSION_BUSTER = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const CHECKER_BG: React.CSSProperties = {
  backgroundColor: '#1a1a1f',
  backgroundImage:
    'linear-gradient(45deg, rgba(255,255,255,0.06) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.06) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.06) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.06) 75%)',
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
};

const ZOOM_STEPS = [25, 33, 50, 67, 75, 100, 125, 150, 175, 200] as const;
const PADDING = 24;

export function OverlayPreview({
  url,
  aspect,
  reloadToken,
}: OverlayPreviewProps): ReactNode {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [autoFit, setAutoFit] = useState(true);
  const [availW, setAvailW] = useState(800);
  const [availH, setAvailH] = useState(600);

  const [w, h] = aspect ?? [880, 130];

  const embedUrl = useMemo(() => {
    const sep = url.includes('?') ? '&' : '?';
    const r = reloadToken !== undefined ? `&r=${reloadToken}` : '';
    return `${url}${sep}embed=1&_=${SESSION_BUSTER}${r}`;
  }, [url, reloadToken]);

  useEffect(() => {
    setLoaded(false);
  }, [embedUrl]);

  // Medir el panel disponible (continuamente — RO sigue resize).
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setAvailW(rect.width);
      setAvailH(rect.height);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-fit: zoom para que el widget entre en el espacio disponible.
  useEffect(() => {
    if (!autoFit) return;
    const fitZoom = Math.min((availW - PADDING * 2) / w, (availH - PADDING * 2) / h) * 100;
    const clamped = Math.max(15, Math.min(200, Math.floor(fitZoom)));
    setZoom(clamped);
  }, [autoFit, w, h, availW, availH]);

  const stepZoom = (dir: 1 | -1) => {
    setAutoFit(false);
    const idx = ZOOM_STEPS.findIndex((v) => v >= zoom);
    const next =
      dir > 0
        ? ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, idx + 1)]
        : ZOOM_STEPS[Math.max(0, idx - 1)];
    setZoom(next ?? 100);
  };

  const openInBrowser = () => window.open(url, '_blank', 'noopener,noreferrer');

  const scaledW = (w * zoom) / 100;
  const scaledH = (h * zoom) / 100;

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-bg-elev/30 px-2 py-1.5">
        <button
          type="button"
          onClick={() => stepZoom(-1)}
          className="grid h-7 w-7 place-items-center rounded text-fg-muted hover:bg-bg-elev hover:text-fg"
          title="Zoom out"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-[42px] text-center text-[11px] font-mono font-semibold text-fg">
          {zoom}%
        </span>
        <button
          type="button"
          onClick={() => stepZoom(1)}
          className="grid h-7 w-7 place-items-center rounded text-fg-muted hover:bg-bg-elev hover:text-fg"
          title="Zoom in"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setAutoFit(true)}
          className={[
            'rounded px-2 py-1 text-[10px] uppercase tracking-wider transition-colors',
            autoFit ? 'bg-accent/20 text-accent' : 'text-fg-muted hover:bg-bg-elev hover:text-fg',
          ].join(' ')}
          title="Ajustar al panel"
        >
          <Maximize2 className="inline h-3 w-3" /> Ajustar
        </button>
        <span className="ml-2 font-mono text-[10px] text-fg-subtle">
          {w} × {h} px
        </span>
        <button
          type="button"
          onClick={openInBrowser}
          className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-[10px] uppercase tracking-wider text-fg-muted hover:bg-bg-elev hover:text-fg"
          title="Abrir en el navegador"
        >
          <ExternalLink className="h-3 w-3" /> Abrir
        </button>
      </div>

      {/* Wrapper exterior — único responsable del scroll y el clip
          visual. overflow-clip mejor que overflow-auto cuando hay
          ring/shadow para que no escape al borde del modal. */}
      <div
        ref={wrapperRef}
        className="relative flex-1 overflow-auto rounded-lg border border-border bg-bg-base/10"
      >
        {/* Wrapper interior — min-w-fit hace que se EXPANDA cuando el
            contenido excede (permitiendo scroll horizontal a la izq/der
            real), min-h-full + items-center centra cuando entra. */}
        <div className="flex min-h-full min-w-fit items-center justify-center p-6">
          {/* Cajita del overlay — tamaño escalado real */}
          <div
            className="relative shrink-0 overflow-hidden rounded-md shadow-xl ring-1 ring-white/10"
            style={{
              ...CHECKER_BG,
              width: `${scaledW}px`,
              height: `${scaledH}px`,
            }}
          >
            {!loaded && (
              <div className="absolute inset-0 animate-pulse bg-black/30" aria-hidden />
            )}
            <iframe
              ref={iframeRef}
              key={embedUrl}
              src={embedUrl}
              title="Vista previa del overlay"
              sandbox="allow-scripts allow-same-origin"
              loading="eager"
              onLoad={() => setLoaded(true)}
              style={{
                width: `${w}px`,
                height: `${h}px`,
                background: 'transparent',
                transform: `scale(${zoom / 100})`,
                transformOrigin: 'top left',
                opacity: loaded ? 1 : 0,
                transition: 'opacity 200ms ease-out',
              }}
              className="block border-0"
            />
          </div>
        </div>

        <div className="pointer-events-none sticky bottom-1 left-0 ml-2 inline-block rounded bg-black/70 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/70">
          Live preview
        </div>
      </div>
    </div>
  );
}
