import { cn } from '../utils/cn.js';

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
  size?: 'sm' | 'md';
}

export function Switch({ checked, onChange, disabled, label, description, size = 'md' }: Props) {
  const dim = size === 'sm' ? 'h-5 w-9' : 'h-6 w-11';
  const knob = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4.5 w-4.5';
  const translate = checked ? (size === 'sm' ? 'translate-x-4' : 'translate-x-5') : 'translate-x-0.5';
  const Track = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full',
        'transition-all duration-base ease-maru',
        'shadow-inset-top',
        dim,
        checked
          ? 'bg-gradient-to-b from-accent to-accent-hover shadow-glow'
          : 'bg-bg-elevated border border-border hover:border-border-strong',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <span
        className={cn(
          'inline-block transform rounded-full bg-white shadow-md',
          'transition-transform duration-base ease-spring',
          knob,
          translate,
        )}
      />
    </button>
  );
  if (!label && !description) return Track;
  return (
    <label className="flex cursor-pointer items-start gap-3">
      {Track}
      <div className="flex flex-col leading-tight">
        {label && <span className="text-sm text-fg">{label}</span>}
        {description && <span className="text-xs text-fg-muted">{description}</span>}
      </div>
    </label>
  );
}
