import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../utils/cn.js';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid, children, ...props }, ref) => (
    <div
      className={cn(
        'relative flex h-10 items-center rounded-xl border bg-bg-elevated transition-colors',
        invalid ? 'border-danger/60 focus-within:border-danger' : 'border-border focus-within:border-accent',
        'focus-within:ring-1 focus-within:ring-accent/40',
        props.disabled && 'opacity-50',
        className,
      )}
    >
      <select
        ref={ref}
        {...props}
        className="h-full w-full appearance-none bg-transparent px-3 pr-9 text-sm text-fg outline-none disabled:cursor-not-allowed"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-fg-subtle" />
    </div>
  ),
);
Select.displayName = 'Select';
