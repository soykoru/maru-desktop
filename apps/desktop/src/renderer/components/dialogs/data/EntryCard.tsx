import { memo, type KeyboardEvent, type MouseEvent } from 'react';
import { MaruImage } from '@maru/ui';
import type { DataEntry, GameId } from '@maru/shared';

/**
 * `EntryCard` — tile del grid de entradas (120×120).
 *
 * Réplica de `data_dialog.py:_EntryCard`:
 *   - Imagen 64×64 centrada arriba.
 *   - Nombre truncado a 12 chars (1 línea).
 *   - Si `display_name != command`: muestra el `command` debajo en gris.
 *   - Hover lift + selección con ring accent.
 *
 * `imagePath` viene resuelta por el sidecar (`game/<gid>/<cat>/<cmd>.png`),
 * así que el componente sólo decide entre MaruImage o emoji fallback.
 *
 * Mejoras vs original:
 *   - Doble-click separado para usar como selector.
 *   - aria-label completo + soporte teclado.
 */
export interface EntryCardProps {
  entry: DataEntry;
  gameId: GameId;
  /** Categoría dentro del juego — para resolver fallback `_default_<cat>.png`. */
  category: string;
  selected?: boolean;
  onSelect?: (entry: DataEntry) => void;
  onConfirm?: (entry: DataEntry) => void;
  /** Badge en esquina sup-derecha (cantidad seleccionada multi-select). */
  badge?: number;
  /** Si true, dibuja borde verde "in selection" (multi-select del MARU). */
  inSelection?: boolean;
}

export const EntryCard = memo(function EntryCard({
  entry,
  gameId,
  category,
  selected = false,
  onSelect,
  onConfirm,
  badge,
  inSelection = false,
}: EntryCardProps) {
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (e.detail >= 2) {
      onConfirm?.(entry);
    } else {
      onSelect?.(entry);
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter') {
      onConfirm?.(entry);
    } else if (e.key === ' ') {
      e.preventDefault();
      onSelect?.(entry);
    }
  };

  // Path final dentro del scope game/<gid>/<cat>/.
  // Si vino con prefijo "game/<gid>/<cat>/" lo strippeamos para que
  // <MaruImage scope="game" path="<gid>/<cat>/<file>"> funcione.
  const fullPath = entry.imagePath ?? `${gameId}/${category}/${entry.command}.png`;
  const trimmed = fullPath.startsWith('game/')
    ? fullPath.slice('game/'.length)
    : fullPath;

  const showCommand =
    entry.command && entry.command !== entry.name;

  return (
    <button
      type="button"
      onClick={handleClick}
      onKeyDown={handleKey}
      aria-pressed={selected}
      aria-label={`${entry.name} — comando ${entry.command}`}
      title={`${entry.name}\n→ ${entry.command}`}
      className={[
        'group relative flex flex-col items-center justify-between',
        'w-[120px] h-[120px] p-2 text-fg',
        'rounded-xl border bg-bg-surface',
        'transition-all duration-150 ease-out outline-none',
        'hover:-translate-y-0.5 hover:shadow-md',
        'focus-visible:ring-2 focus-visible:ring-accent',
        inSelection
          ? 'border-success/70 bg-success/10 ring-2 ring-success/40'
          : selected
            ? 'border-accent ring-2 ring-accent/40 shadow-md'
            : 'border-border hover:border-fg-muted',
      ].join(' ')}
    >
      {badge !== undefined && badge > 0 && (
        <span
          className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1.5 rounded-full bg-accent text-[10px] font-bold text-bg flex items-center justify-center shadow"
          aria-label={`${badge} seleccionados`}
        >
          {badge}
        </span>
      )}

      <div className="flex-1 flex items-center justify-center w-full">
        <MaruImage
          scope="game"
          path={trimmed}
          size={64}
          fallback="📦"
          loadingStrategy="intersect"
        />
      </div>

      <div className="w-full text-center min-w-0">
        <p className="text-[11px] font-medium leading-tight truncate">
          {entry.name}
        </p>
        {showCommand && (
          <p className="text-[10px] text-fg-subtle truncate font-mono">
            {entry.command}
          </p>
        )}
      </div>
    </button>
  );
});
