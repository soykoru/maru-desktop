import { useEffect, useRef, useState } from 'react';
import { cn } from '../utils/cn.js';

/**
 * CountUp — anima el cambio numérico desde el valor previo al nuevo.
 *
 * Útil para stats live (likes, viewers, diamonds) donde ver "1247 →
 * 1271" con cuenta progresiva da el efecto premium de actividad real
 * en vez de un cambio brusco.
 *
 * Usa requestAnimationFrame con easing suave (ease-out cubic). Respeta
 * `prefers-reduced-motion`. Si el delta es 0, no anima.
 *
 * Performance: 0 re-renders del padre. Anima localmente con setState
 * y termina cuando llega al target. ~16 frames por animación default
 * (300ms a 60fps).
 */
export interface CountUpProps {
  /** Valor actual (target). El componente anima del valor previo a este. */
  value: number;
  /** Duración de la animación. Default 600ms. */
  durationMs?: number;
  /** Formato del número. Default `n.toLocaleString()`. */
  format?: (n: number) => string;
  /** Class del span externo. */
  className?: string;
  /** Pinta el valor inicial sin animar (no anima la primera render). */
  skipInitial?: boolean;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function defaultFormat(n: number): string {
  return Math.round(n).toLocaleString();
}

const prefersReducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function CountUp({
  value,
  durationMs = 600,
  format = defaultFormat,
  className,
  skipInitial = true,
}: CountUpProps) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const startedRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const isFirstRef = useRef(true);

  useEffect(() => {
    // Skip animación inicial si está pedido (default).
    if (isFirstRef.current && skipInitial) {
      isFirstRef.current = false;
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    isFirstRef.current = false;

    // Reduce motion → set directo sin animar.
    if (prefersReducedMotion) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }

    // Si no cambia, nada.
    if (fromRef.current === value) return;

    const from = fromRef.current;
    const to = value;
    startedRef.current = null;

    const tick = (now: number) => {
      if (startedRef.current === null) startedRef.current = now;
      const elapsed = now - startedRef.current;
      const t = Math.min(1, elapsed / durationMs);
      const eased = easeOutCubic(t);
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, durationMs, skipInitial]);

  return (
    <span
      className={cn('tabular-nums', className)}
      aria-live="polite"
      aria-atomic="true"
    >
      {format(display)}
    </span>
  );
}
