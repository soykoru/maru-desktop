import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../utils/cn.js';

type Variant = 'ghost' | 'soft' | 'solid' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  'aria-label': string;
}

const variants: Record<Variant, string> = {
  ghost: 'text-fg-muted hover:bg-bg-elevated hover:text-fg',
  soft: 'bg-bg-elevated text-fg-muted hover:text-fg border border-border',
  solid: 'bg-accent text-white hover:bg-accent-hover shadow-glow',
  danger: 'text-fg-muted hover:bg-danger hover:text-white',
};

const sizes: Record<Size, string> = {
  sm: 'h-7 w-7',
  md: 'h-9 w-9',
  lg: 'h-11 w-11',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = 'ghost', size = 'md', className, ...props }, ref) => (
    <button
      ref={ref}
      {...props}
      className={cn(
        'inline-flex items-center justify-center rounded-lg transition-colors duration-fast',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
    />
  ),
);
IconButton.displayName = 'IconButton';
