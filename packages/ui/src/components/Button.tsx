import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../utils/cn.js';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Stretch al 100% del contenedor padre. */
  fullWidth?: boolean;
}

const variantClasses: Record<Variant, string> = {
  // primary = botón principal MARU (gradient naranja accent)
  primary:
    'bg-gradient-to-b from-accent to-accent-hover text-white font-bold ' +
    'shadow-elev-1 hover:shadow-glow active:scale-[0.98]',
  // secondary = look "Midnight QSS" (gradient azul #4a69bd → #3c528c)
  secondary:
    'bg-gradient-to-b from-mn-button to-mn-button-end text-white font-bold ' +
    'hover:from-mn-button-hover hover:to-mn-button',
  // ghost = transparente con borde sutil (link-like)
  ghost:
    'bg-fg/[0.06] text-fg border border-fg/10 hover:bg-fg/10 hover:border-fg/20',
  // danger = gradient rojo (delete, eliminar)
  danger:
    'bg-gradient-to-r from-accent-red to-accent-red-dark text-white font-bold ' +
    'hover:shadow-[0_0_0_1px_rgb(231_76_60_/_0.5),_0_8px_24px_rgb(231_76_60_/_0.25)]',
};

const sizeClasses: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = 'primary', size = 'md', fullWidth = false, ...props },
    ref,
  ) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md',
        'transition-all duration-fast ease-maru',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
