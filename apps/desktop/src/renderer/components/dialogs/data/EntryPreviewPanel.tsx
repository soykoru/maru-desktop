import { ImageOff } from 'lucide-react';
import { Empty, MaruImage } from '@maru/ui';
import type { DataEntry, GameId } from '@maru/shared';

/**
 * `EntryPreviewPanel` — preview 140×140 del entry seleccionado.
 *
 * Réplica del panel "Detalle" del DataDialog original. Muestra la imagen
 * grande + nombre prominente + comando con prefijo `→`.
 */
export interface EntryPreviewPanelProps {
  entry: DataEntry | null;
  gameId: GameId;
  category: string;
}

export function EntryPreviewPanel({
  entry,
  gameId,
  category,
}: EntryPreviewPanelProps) {
  if (!entry) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Empty
          icon={ImageOff}
          title="Sin selección"
          description="Elegí una entrada del grid para ver su detalle."
        />
      </div>
    );
  }

  const fullPath = entry.imagePath ?? `${gameId}/${category}/${entry.command}.png`;
  const trimmed = fullPath.startsWith('game/')
    ? fullPath.slice('game/'.length)
    : fullPath;

  return (
    <div className="flex flex-col items-center gap-3 p-4">
      <div className="flex items-center justify-center w-[140px] h-[140px] rounded-xl border border-border bg-bg-elev shadow-inner">
        <MaruImage
          scope="game"
          path={trimmed}
          size={120}
          fallback="📦"
          loadingStrategy="eager"
        />
      </div>
      <div className="text-center min-w-0 max-w-full">
        <p className="text-[15px] font-semibold leading-tight truncate">
          {entry.name}
        </p>
        <p className="mt-1 text-[11px] text-fg-subtle font-mono break-all">
          → {entry.command}
        </p>
      </div>
    </div>
  );
}
