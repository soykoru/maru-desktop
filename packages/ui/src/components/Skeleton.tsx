import { cn } from '../utils/cn.js';

/**
 * Skeleton premium — placeholder con shimmer animation mientras carga.
 *
 * Variantes:
 *   default → bloque genérico (tarjetas, líneas).
 *   text    → línea de texto h-4 con border-radius redondeado.
 *   circle  → círculo (avatares, badges).
 *   card    → tarjeta con altura generosa.
 *
 * Reemplaza "Cargando…" textos por bloques shimmer profesionales.
 */
export interface SkeletonProps {
  className?: string;
  variant?: 'default' | 'text' | 'circle' | 'card';
  /** Cuántas líneas mostrar (solo variant="text"). */
  lines?: number;
  /** Si true, inline-block en lugar de block. */
  inline?: boolean;
}

const variantClasses: Record<NonNullable<SkeletonProps['variant']>, string> = {
  default: 'h-6 w-full rounded-md',
  text:    'h-4 w-full rounded',
  circle:  'h-10 w-10 rounded-full',
  card:    'h-24 w-full rounded-xl',
};

export function Skeleton({
  className,
  variant = 'default',
  lines = 1,
  inline = false,
}: SkeletonProps) {
  const base = cn(
    'relative overflow-hidden bg-bg-elevated/60',
    'border border-border/50',
    inline ? 'inline-block' : 'block',
    variantClasses[variant],
    className,
  );

  const shimmer = (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-fg/[0.08] to-transparent"
    />
  );

  if (variant === 'text' && lines > 1) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className={cn(base, i === lines - 1 && 'w-3/4')}
            role="status"
            aria-label="Cargando…"
          >
            {shimmer}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={base} role="status" aria-label="Cargando…">
      {shimmer}
    </div>
  );
}

/**
 * SkeletonGrid — wrapper para mostrar N skeleton cards en grid.
 * Ideal para gifts/voices/sounds mientras se carga la lista.
 */
export function SkeletonGrid({
  count = 6,
  variant = 'card',
  className,
}: {
  count?: number;
  variant?: SkeletonProps['variant'];
  className?: string;
}) {
  return (
    <div className={cn('grid gap-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} variant={variant} />
      ))}
    </div>
  );
}
