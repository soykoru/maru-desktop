import { useEffect, useState, type ReactNode } from 'react';
import { Palette, Check } from 'lucide-react';
import { useAppStore } from '../lib/store/index.js';
import { THEME_LIST, type ThemeId } from '../lib/store/ui-slice.js';
import { rpcCall } from '../lib/rpc.js';

/**
 * ThemeSwitcher — selector de tema visual con persistencia.
 *
 * - Lee settings.theme al montar.
 * - Aplica `data-theme` en <html> al cambiar.
 * - Persiste vía settings.set (RPC).
 *
 * NO toca lógica de sidecar. Solo cambia tokens CSS via
 * `packages/ui/styles/globals.css`.
 */
export function ThemeSwitcher(): ReactNode {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const [open, setOpen] = useState(false);

  // Boot: cargar tema persistido
  useEffect(() => {
    void rpcCall('settings.get', {})
      .then((r) => {
        const cfg = (r as { config?: { theme?: string } }).config;
        const persisted = cfg?.theme;
        if (
          persisted &&
          THEME_LIST.some((t) => t.id === persisted) &&
          persisted !== theme
        ) {
          setTheme(persisted as ThemeId);
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSelect(id: ThemeId) {
    setTheme(id);
    setOpen(false);
    void rpcCall('settings.set', { patch: { theme: id } }).catch(() => undefined);
  }

  const current = THEME_LIST.find((t) => t.id === theme) ?? THEME_LIST[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md border border-border bg-bg-elevated/50 px-3 py-2 text-xs font-medium text-fg-muted transition-all duration-fast ease-maru hover:border-border-strong hover:bg-bg-elevated/80 hover:text-fg"
        title="Cambiar tema visual"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Palette className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 truncate text-left">{current.emoji} {current.label}</span>
        <span className="text-[10px] text-fg-subtle">▼</span>
      </button>

      {open && (
        <>
          {/* Backdrop para cerrar al click fuera */}
          <div
            className="fixed inset-0 z-dropdown"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="listbox"
            className="absolute bottom-full left-0 right-0 z-dropdown mb-1.5 overflow-hidden rounded-md border border-border bg-bg-elevated/95 shadow-elev-3 animate-fade-in"
            style={{ backdropFilter: 'blur(12px) saturate(140%)' }}
          >
            <div className="border-b border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-fg-subtle">
              🎨 Tema visual
            </div>
            {THEME_LIST.map((t) => {
              const active = t.id === theme;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => handleSelect(t.id)}
                  className={[
                    'flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors duration-fast',
                    active
                      ? 'bg-accent/15 text-accent'
                      : 'text-fg-muted hover:bg-fg/5 hover:text-fg',
                  ].join(' ')}
                >
                  <span className="text-base leading-none">{t.emoji}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-semibold">
                      {t.label}
                    </span>
                    <span className="block text-[10px] text-fg-subtle leading-snug">
                      {t.description}
                    </span>
                  </span>
                  {active && <Check className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
