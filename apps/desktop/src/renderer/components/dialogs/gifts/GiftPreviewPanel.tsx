import { ImageOff } from 'lucide-react';
import { MaruImage, Empty, Badge } from '@maru/ui';
import type { DonationGift } from '@maru/shared';

/**
 * `GiftPreviewPanel` — preview 180×180 del gift seleccionado.
 *
 * Réplica del panel derecho de `gifts_dialog.py`:
 *   - PNG 180×180 grande con sombra.
 *   - Nombre (h2 prominente).
 *   - Coins (con emoji 💎).
 *   - Icon emoji original (si existe).
 *   - Estado disabled (badge).
 *   - Path del PNG (mono-font, click-to-copy en el original).
 *   - Contador de recibidos en sesión.
 *
 * Cuando no hay nada seleccionado, muestra `<Empty>` placeholder.
 */
export interface GiftPreviewPanelProps {
  gift: DonationGift | null;
}

export function GiftPreviewPanel({ gift }: GiftPreviewPanelProps) {
  if (!gift) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Empty
          icon={ImageOff}
          title="Sin selección"
          description="Elegí un regalo del grid para ver su detalle."
        />
      </div>
    );
  }

  const iconPath = gift.iconPath?.startsWith('donaciones/')
    ? gift.iconPath.slice('donaciones/'.length)
    : gift.iconPath;

  const isPlaceholder = !iconPath || iconPath.includes('Rose_black_white');

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="relative flex items-center justify-center mx-auto w-[180px] h-[180px] rounded-2xl border border-border bg-bg-elev shadow-inner">
        {isPlaceholder && gift.icon ? (
          <span
            role="img"
            aria-label={gift.name}
            className="text-[110px] leading-none select-none font-emoji"
          >
            {gift.icon}
          </span>
        ) : (
          <MaruImage
            scope="donaciones"
            path={iconPath || 'Rose_black_white.png'}
            size={160}
            fallback={gift.icon || '🎁'}
            loadingStrategy="eager"
          />
        )}
        {gift.disabled && (
          <Badge variant="warning" className="absolute top-2 right-2">
            Oculto
          </Badge>
        )}
      </div>

      <div className="text-center">
        <h2 className="text-lg font-semibold leading-tight break-words">
          {gift.name}
        </h2>
        {gift.id !== gift.name && (
          <p className="text-[11px] text-fg-subtle font-mono mt-0.5">
            {gift.id}
          </p>
        )}
      </div>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-fg-muted">Coins</dt>
        <dd className="font-semibold">
          <span aria-hidden="true">💎</span> {gift.coins}
        </dd>

        <dt className="text-fg-muted">Icono</dt>
        <dd className="font-emoji text-base leading-none">
          {gift.icon || <span className="text-fg-subtle italic">—</span>}
        </dd>

        <dt className="text-fg-muted">Recibidos</dt>
        <dd>{gift.receivedCount ?? 0}</dd>

        <dt className="text-fg-muted">Path</dt>
        <dd className="font-mono text-[10px] break-all text-fg-muted">
          {gift.iconPath || '—'}
        </dd>
      </dl>
    </div>
  );
}
