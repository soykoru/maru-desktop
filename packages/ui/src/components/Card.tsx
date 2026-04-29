import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../utils/cn.js';

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        // backdrop-blur removido del default: producía flicker del fondo
        // cuando llegaban push events densos (log, spotify queue, stats).
        // El blur sigue disponible en overlays ocasionales (Dialog, Toast,
        // UpdateBanner) donde el coste de recomposición no se nota.
        'rounded-2xl border border-border bg-bg-surface/95',
        'shadow-[0_1px_0_rgb(255_255_255/0.03)_inset]',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-5 pt-5 pb-3', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-base font-semibold tracking-tight text-fg', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

export const CardBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-5 pb-5', className)} {...props} />
  ),
);
CardBody.displayName = 'CardBody';
