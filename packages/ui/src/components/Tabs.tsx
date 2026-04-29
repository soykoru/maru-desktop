import { createContext, useContext, useState, type ReactNode } from 'react';
import { cn } from '../utils/cn.js';

interface Ctx {
  value: string;
  setValue: (v: string) => void;
}
const TabsCtx = createContext<Ctx | null>(null);

export function Tabs({
  value: controlled,
  onChange,
  defaultValue,
  children,
  className,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (v: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const [internal, setInternal] = useState(defaultValue ?? '');
  const value = controlled ?? internal;
  const setValue = (v: string) => {
    if (!controlled) setInternal(v);
    onChange?.(v);
  };
  return (
    <TabsCtx.Provider value={{ value, setValue }}>
      <div className={className}>{children}</div>
    </TabsCtx.Provider>
  );
}

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'inline-flex h-10 items-center gap-1 rounded-xl border border-border bg-bg-elevated p-1',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  const ctx = useContext(TabsCtx);
  if (!ctx) throw new Error('TabsTrigger must be inside Tabs');
  const active = ctx.value === value;
  return (
    <button
      onClick={() => ctx.setValue(value)}
      className={cn(
        'inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium transition-colors',
        active ? 'bg-bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children }: { value: string; children: ReactNode }) {
  const ctx = useContext(TabsCtx);
  if (!ctx) throw new Error('TabsContent must be inside Tabs');
  if (ctx.value !== value) return null;
  return <div className="mt-4 animate-fade-in">{children}</div>;
}
