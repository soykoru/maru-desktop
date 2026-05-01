import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../utils/cn.js';

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  prefix?: ReactNode;
  suffix?: ReactNode;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, prefix, suffix, invalid, ...props }, ref) => (
    <div
      className={cn(
        'flex h-10 items-center gap-2 rounded-xl border bg-bg-elevated px-3 transition-colors',
        invalid ? 'border-danger/60 focus-within:border-danger' : 'border-border focus-within:border-accent',
        'focus-within:ring-1 focus-within:ring-accent/40',
        props.disabled && 'opacity-50',
        className,
      )}
    >
      {prefix && (
        <span className="shrink-0 text-fg-subtle">{prefix}</span>
      )}
      <input
        ref={ref}
        {...props}
        className="flex-1 min-w-0 bg-transparent text-sm text-fg placeholder:text-fg-subtle outline-none disabled:cursor-not-allowed"
      />
      {suffix && (
        <span className="shrink-0 whitespace-nowrap text-xs text-fg-subtle">
          {suffix}
        </span>
      )}
    </div>
  ),
);
Input.displayName = 'Input';

export const Label = ({
  htmlFor,
  children,
  hint,
  required,
}: {
  htmlFor?: string;
  children: ReactNode;
  hint?: ReactNode;
  required?: boolean;
}) => (
  <label
    htmlFor={htmlFor}
    className="mb-1.5 flex items-center justify-between text-xs font-medium uppercase tracking-wider text-fg-subtle"
  >
    <span>
      {children}
      {required && <span className="ml-0.5 text-danger">*</span>}
    </span>
    {hint && <span className="font-normal normal-case text-fg-subtle/70">{hint}</span>}
  </label>
);

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => (
  <textarea
    ref={ref}
    {...props}
    className={cn(
      'min-h-[80px] w-full rounded-xl border bg-bg-elevated px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none transition-colors',
      invalid ? 'border-danger/60 focus:border-danger' : 'border-border focus:border-accent',
      'focus:ring-1 focus:ring-accent/40 disabled:opacity-50',
      className,
    )}
  />
));
TextArea.displayName = 'TextArea';
