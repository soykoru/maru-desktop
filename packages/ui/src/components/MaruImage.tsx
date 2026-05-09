import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ImgHTMLAttributes,
} from 'react';
import { cn } from '../utils/cn.js';

/**
 * Scopes válidos del custom protocol `maru://images/<scope>/...`.
 * Espejo de los scopes definidos en `apps/desktop/src/main/image-protocol.ts`.
 */
export type MaruImageScope =
  | 'donaciones'
  | 'triggers'
  | 'templates'
  | 'game'
  | 'userdata'
  | 'emotes'
  | 'game_covers'
  | 'profile_covers';

export interface MaruImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'loading'> {
  /** Scope del bundle. */
  scope: MaruImageScope;
  /**
   * Path dentro del scope. Para `game` es `gameId/category/filename`,
   * para los demás es `filename` directo.
   *
   * Ejemplos:
   *   <MaruImage scope="donaciones" path="Rose.png" size={48} />
   *   <MaruImage scope="game" path="valheim/entities/Boar.png" size={64} />
   *   <MaruImage scope="triggers" path="trigger_gift.png" size={32} />
   */
  path: string;
  /** Tamaño en px (square). Aplica a width + height. Default `64`. */
  size?: number;
  /** Opcional: ancho/alto explícitos (sobrescriben `size`). */
  width?: number;
  height?: number;
  /**
   * Imagen fallback si la primaria falla. Acepta otra `path` o un emoji
   * para mostrar como texto cuando todo falla.
   *
   * Ejemplos:
   *   fallback={{ scope: 'triggers', path: 'trigger_gift.png' }}
   *   fallback="🎁"
   */
  fallback?:
    | { scope: MaruImageScope; path: string }
    | string;
  /**
   * Estrategia de loading. Default `lazy` (browser native).
   * `eager` para imágenes above-the-fold.
   * `intersect` para uso con IntersectionObserver (más control fino,
   * útil para grids de cientos de items).
   */
  loadingStrategy?: 'lazy' | 'eager' | 'intersect';
  /**
   * Si true, applica fade-in 200ms cuando carga. Default true.
   */
  fadeIn?: boolean;
}

const SCHEME = 'maru://images';

/**
 * Construye la URL `maru://images/<scope>/<path>` con encoding correcto.
 */
function buildUrl(scope: MaruImageScope, path: string): string {
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((p) => encodeURIComponent(p));
  return `${SCHEME}/${scope}/${parts.join('/')}`;
}

/**
 * `<MaruImage>` — primitive G2 para servir imágenes del bundle.
 *
 * Resuelve `scope + path` al custom protocol `maru://`. Soporta:
 *   - Lazy loading nativo (default).
 *   - IntersectionObserver opt-in (`loadingStrategy="intersect"`) con
 *     rootMargin de 200px para grids muy grandes.
 *   - Fallback chain: si la primaria falla, intenta el fallback prop.
 *     Si éste también falla y es string, muestra el string como emoji.
 *   - Fade-in suave de 200ms al cargar.
 *   - aria-label automático (placeholder vacío).
 *
 * El componente respeta `prefers-reduced-motion` (sin fade-in).
 */
export const MaruImage = forwardRef<HTMLImageElement, MaruImageProps>(
  (
    {
      scope,
      path,
      size = 64,
      width,
      height,
      fallback,
      loadingStrategy = 'lazy',
      fadeIn = true,
      className,
      style,
      alt,
      onError,
      ...props
    },
    ref,
  ) => {
    const primarySrc = useMemo(() => buildUrl(scope, path), [scope, path]);
    const [src, setSrc] = useState<string | null>(
      loadingStrategy === 'intersect' ? null : primarySrc,
    );
    const [loaded, setLoaded] = useState(false);
    const [errorState, setErrorState] = useState<'ok' | 'fallback' | 'final'>(
      'ok',
    );
    const imgRef = useRef<HTMLImageElement | null>(null);

    // Cuando cambian scope/path, resetear estado.
    useEffect(() => {
      setLoaded(false);
      setErrorState('ok');
      if (loadingStrategy !== 'intersect') {
        setSrc(primarySrc);
      } else {
        setSrc(null);
      }
    }, [primarySrc, loadingStrategy]);

    // CRÍTICO — anti-stuck-fadeIn:
    // Si la imagen llega del cache (custom protocol `maru://` cachea con
    // `Cache-Control: immutable`), Chrome la marca como `complete`
    // sincronamente al setear `src`. En remount tras unmount, el evento
    // `onLoad` puede dispararse ANTES de que React adjunte el handler →
    // `loaded` queda en false y `opacity: 0` permanente.
    // Solución: tras adjuntar el ref, si la `<img>` ya está completa
    // (cache hit), forzamos loaded=true.
    useEffect(() => {
      if (!src) return;
      const node = imgRef.current;
      if (!node) return;
      if (node.complete && node.naturalWidth > 0) {
        setLoaded(true);
      }
    }, [src]);

    // IntersectionObserver para `loadingStrategy="intersect"`.
    useEffect(() => {
      if (loadingStrategy !== 'intersect') return;
      if (!imgRef.current) return;
      const node = imgRef.current;
      const obs = new IntersectionObserver(
        (entries) => {
          const visible = entries.some((e) => e.isIntersecting);
          if (visible) {
            setSrc(primarySrc);
            obs.disconnect();
          }
        },
        { rootMargin: '200px' },
      );
      obs.observe(node);
      return () => obs.disconnect();
    }, [loadingStrategy, primarySrc]);

    const w = width ?? size;
    const h = height ?? size;

    function handleError(): void {
      // Estado actual = ok → intentar fallback (si es objeto).
      if (errorState === 'ok' && fallback && typeof fallback === 'object') {
        setSrc(buildUrl(fallback.scope, fallback.path));
        setErrorState('fallback');
        return;
      }
      // Fallback ya intentado o no es path → muestra emoji o queda vacío.
      setErrorState('final');
      if (onError) onError({ currentTarget: imgRef.current } as never);
    }

    // Fallback final: emoji string cuando todo falló.
    if (errorState === 'final' && typeof fallback === 'string') {
      return (
        <span
          aria-label={alt ?? ''}
          role="img"
          className={cn(
            'inline-flex items-center justify-center select-none',
            'font-emoji',
            className,
          )}
          style={{
            width: w,
            height: h,
            fontSize: Math.round(Math.min(w, h) * 0.65),
            lineHeight: 1,
            ...style,
          }}
        >
          {fallback}
        </span>
      );
    }

    const fadeInStyle: CSSProperties =
      fadeIn && !loaded
        ? { opacity: 0 }
        : fadeIn
          ? {
              opacity: 1,
              transition:
                'opacity var(--maru-dur-base) var(--maru-ease)',
            }
          : {};

    return (
      <img
        ref={(node) => {
          imgRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        src={src ?? undefined}
        alt={alt ?? ''}
        width={w}
        height={h}
        loading={loadingStrategy === 'eager' ? 'eager' : 'lazy'}
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={handleError}
        className={cn('select-none object-contain', className)}
        style={{ ...fadeInStyle, ...style }}
        {...props}
      />
    );
  },
);
MaruImage.displayName = 'MaruImage';

/**
 * Helper: construye una URL `maru://` desde JS sin renderizar `<MaruImage>`.
 *
 * Útil cuando necesitás el src para CSS (background-image), input icons,
 * o componentes Qt-equivalentes.
 *
 *   maruImageSrc('donaciones', 'Rose.png')
 *   → "maru://images/donaciones/Rose.png"
 */
export function maruImageSrc(scope: MaruImageScope, path: string): string {
  return buildUrl(scope, path);
}
