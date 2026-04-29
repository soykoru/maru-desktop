import { cn } from '../utils/cn.js';

export function Spinner({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const dim = size === 'sm' ? 'h-3 w-3' : size === 'lg' ? 'h-6 w-6' : 'h-4 w-4';
  return (
    <span
      role="status"
      aria-label="cargando"
      className={cn(
        'inline-block animate-spin rounded-full border-2 border-current border-r-transparent',
        dim,
        className,
      )}
    />
  );
}
