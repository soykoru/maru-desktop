/**
 * Sistema de toasts global.
 *
 * Diseño:
 *  - `toastStore` es un módulo singleton con `subscribe` + `dispatch`.
 *  - `<Toaster />` se monta una vez (en AppShell) y portala al body.
 *  - `toast.success(msg) / .error / .warning / .info` — API global sin hooks.
 *  - Auto-dismiss configurable (default 4s); error sin auto-dismiss por defecto.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';
import { cn } from '../utils/cn.js';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  durationMs: number;
}

type Listener = (items: ToastItem[]) => void;

class ToastStore {
  private items: ToastItem[] = [];
  private listeners = new Set<Listener>();

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.items);
    return () => this.listeners.delete(l);
  }

  push(item: Omit<ToastItem, 'id'>): string {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const full: ToastItem = { id, ...item };
    this.items = [...this.items, full];
    this.emit();
    if (item.durationMs > 0) {
      window.setTimeout(() => this.dismiss(id), item.durationMs);
    }
    return id;
  }

  dismiss(id: string): void {
    this.items = this.items.filter((i) => i.id !== id);
    this.emit();
  }

  clear(): void {
    this.items = [];
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((l) => l(this.items));
  }
}

const store = new ToastStore();

export const toast = {
  show: (variant: ToastVariant, title: string, description?: string, durationMs?: number) =>
    store.push({
      variant,
      title,
      description,
      durationMs: durationMs ?? (variant === 'error' ? 0 : 4000),
    }),
  success: (title: string, description?: string) => toast.show('success', title, description),
  error: (title: string, description?: string) => toast.show('error', title, description),
  warning: (title: string, description?: string) => toast.show('warning', title, description),
  info: (title: string, description?: string) => toast.show('info', title, description),
  dismiss: (id: string) => store.dismiss(id),
  clear: () => store.clear(),
};

const variantConfig: Record<ToastVariant, { icon: typeof CheckCircle2; tone: string }> = {
  success: { icon: CheckCircle2, tone: 'text-success' },
  error: { icon: XCircle, tone: 'text-danger' },
  warning: { icon: AlertTriangle, tone: 'text-warning' },
  info: { icon: Info, tone: 'text-info' },
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => store.subscribe(setItems), []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {items.map((t) => {
        const cfg = variantConfig[t.variant];
        const Icon = cfg.icon;
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-bg-surface/95 p-3 shadow-lg backdrop-blur-md',
              'animate-slide-up',
            )}
          >
            <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', cfg.tone)} />
            <div className="flex-1 leading-tight">
              <p className="text-sm font-medium text-fg">{t.title}</p>
              {t.description && <p className="mt-0.5 text-xs text-fg-muted">{t.description}</p>}
            </div>
            <button
              onClick={() => store.dismiss(t.id)}
              aria-label="Cerrar"
              className="shrink-0 rounded text-fg-subtle hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
