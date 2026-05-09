import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import type { GameId, GameProfile } from '@maru/shared';

/**
 * `GamePicker` — selector visual del juego activo (v1.0.72).
 *
 * Reemplaza el `<select>` HTML nativo del Sidebar por un trigger con la
 * portada del juego activo + popover con grid de cards de todos los juegos
 * para elegir cuál es el activo.
 *
 * Estados:
 *   - Colapsado: card chica con cover + nombre del juego activo + ▼.
 *   - Abierto: popover anclado debajo con grid 3-cols de mini-cards
 *     (cover + nombre). Click en una → setea activo y cierra.
 *
 * Cierra al click fuera + Esc.
 *
 * Reusa el sistema `maru://images/game_covers/<file>` ya implementado.
 */

export interface GamePickerProps {
  games: GameProfile[];
  selectedId: GameId | null;
  onSelect: (id: GameId | null) => void;
}

/** Gradient determinístico — mismo algo que GameCard para consistencia visual. */
function gradientFor(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h = (h ^ id.charCodeAt(i)) * 16777619;
    h = h >>> 0;
  }
  const hue1 = h % 360;
  const hue2 = (hue1 + 60) % 360;
  return `linear-gradient(135deg, hsl(${hue1} 65% 28%), hsl(${hue2} 70% 18%))`;
}

interface MiniCoverProps {
  profile: GameProfile;
  className?: string;
}

function MiniCover({ profile, className = '' }: MiniCoverProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const cover = profile.coverImage
    ? `maru://images/game_covers/${profile.coverImage}`
    : null;
  const showImg = cover && !imgFailed;
  return (
    <div
      className={`relative overflow-hidden rounded ${className}`}
      style={!showImg ? { background: gradientFor(profile.id) } : undefined}
    >
      {showImg ? (
        <img
          src={cover}
          alt={profile.name}
          loading="lazy"
          decoding="async"
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <span className="font-emoji text-2xl">{profile.icon}</span>
        </div>
      )}
    </div>
  );
}

export function GamePicker({ games, selectedId, onSelect }: GamePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const active = games.find((g) => g.id === selectedId) ?? null;

  // Click outside + Esc para cerrar
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  function handlePick(id: GameId) {
    onSelect(id);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative w-full">
      {/* Trigger — card del juego activo */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-bg-elev/40 p-1.5 text-left transition-colors hover:border-accent/60 hover:bg-bg-elev/60 focus:outline-none focus:ring-1 focus:ring-accent"
      >
        {active ? (
          <>
            <MiniCover
              profile={active}
              className="h-12 w-9 flex-none"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{active.name}</p>
              <p className="text-[10px] text-fg-subtle font-mono truncate">
                {active.connectionType.toUpperCase()} · {active.connection.host}:{active.connection.port}
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="flex h-12 w-9 flex-none items-center justify-center rounded bg-bg-base/40">
              <span className="font-emoji text-2xl opacity-50">🎮</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-fg-subtle italic">
                Sin juego seleccionado
              </p>
              <p className="text-[10px] text-fg-subtle">Click para elegir</p>
            </div>
          </>
        )}
        <ChevronDown
          className={`h-4 w-4 flex-none text-fg-subtle transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Popover con grid de juegos */}
      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-bg-base shadow-xl backdrop-blur-md"
        >
          {games.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-fg-subtle italic">
              Sin juegos. Agregá uno desde Configuración.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5 p-1.5">
              {games.map((g) => {
                const isActive = g.id === selectedId;
                return (
                  <button
                    key={g.id}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => handlePick(g.id)}
                    className={`group relative flex flex-col items-stretch overflow-hidden rounded-md border bg-bg-elev/40 transition-all hover:border-accent hover:-translate-y-0.5 hover:shadow-md ${
                      isActive
                        ? 'border-accent ring-1 ring-accent shadow-md'
                        : 'border-border/60'
                    }`}
                    title={g.name}
                  >
                    <MiniCover
                      profile={g}
                      className="aspect-[2/3] w-full"
                    />
                    <div className="px-1.5 py-1">
                      <p className="truncate text-[11px] font-semibold leading-tight">
                        {g.name}
                      </p>
                    </div>
                    {isActive && (
                      <div className="absolute right-1 top-1 rounded-full bg-accent/90 p-0.5">
                        <Check className="h-3 w-3 text-accent-fg" />
                      </div>
                    )}
                    {g.requiresMod && (
                      <div className="absolute left-1 top-1 rounded bg-warning/90 px-1 py-0.5 text-[8px] font-bold text-warning-fg">
                        MOD
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
