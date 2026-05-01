import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../utils/cn.js';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

/**
 * Select premium — un solo contorno limpio (sin doble line).
 * El focus ring se reemplazó por glow sutil (box-shadow) para no
 * generar el efecto de doble borde.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid, children, ...props }, ref) => (
    <div
      className={cn(
        'relative flex h-10 items-center rounded-xl border bg-bg-elevated',
        'transition-[border-color,box-shadow] duration-fast ease-maru',
        invalid
          ? 'border-danger/60 focus-within:border-danger focus-within:shadow-[0_0_0_3px_rgb(231_76_60/0.12)]'
          : 'border-border hover:border-border-strong/60 focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgb(243_156_18/0.10)]',
        props.disabled && 'opacity-50',
        className,
      )}
    >
      <select
        ref={ref}
        {...props}
        className="h-full w-full appearance-none bg-transparent px-3 pr-9 text-sm text-fg outline-none border-0 ring-0 focus:outline-none focus:ring-0 disabled:cursor-not-allowed"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-fg-subtle" />
    </div>
  ),
);
Select.displayName = 'Select';
