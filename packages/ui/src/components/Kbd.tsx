import type { ReactNode } from 'react';
import { cn } from '../utils/cn.js';

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border bg-bg-elevated px-1.5 font-mono text-[10px] text-fg-muted shadow-sm',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
