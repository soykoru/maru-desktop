import { memo, type KeyboardEvent, type MouseEvent } from 'react';
import { MaruImage } from '@maru/ui';
import type { DonationGift } from '@maru/shared';

/**
 * `GiftCard` — tile del grid de gifts (110×135 px).
 *
 * Réplica del tile `gifts_dialog.py:_create_gift_card`:
 *   - Frame de 110×135 con fondo `bg-bg-surface` + border.
 *   - Icon PNG 64×64 centrado arriba (vía MaruImage scope=donaciones).
 *   - Nombre (1-2 líneas truncadas) bajo el icon.
 *   - Pill con `coins` + emoji 💎 abajo.
 *   - Estado disabled → opacity 50%.
 *   - Estado received>0 → badge esquina superior-derecha.
 *
 * Mejoras sobre original:
 *   - Foco accesible con keyboard (`Enter`/`Space`).
 *   - Hover scale + shadow lift (suave 200ms).
 *   - Selección con ring accent.
 *   - Dobble click handler aparte para `GiftSelectorDialog`.
 */
export interface GiftCardProps {
  gift: DonationGift;
  selected?: boolean;
  /** Click simple — selecciona la card. */
  onSelect?: (gift: DonationGift) => void;
  /** Doble click — confirma (uso en GiftSelectorDialog). */
  onConfirm?: (gift: DonationGift) => void;
  /** Si true, oculta el badge de coins (modo "selector compacto"). */
  hideCoins?: boolean;
}

export const GiftCard = memo(function GiftCard({
  gift,
  selected = false,
  onSelect,
  onConfirm,
  hideCoins = false,
}: GiftCardProps) {
  const handleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    if (e.detail >= 2) {
      onConfirm?.(gift);
    } else {
      onSelect?.(gift);
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'Enter') {
      onConfirm?.(gift);
    } else if (e.key === ' ') {
      e.preventDefault();
      onSelect?.(gift);
    }
  };

  const iconPath = gift.iconPath?.startsWith('donaciones/')
    ? gift.iconPath.slice('donaciones/'.length)
    : gift.iconPath;

  const isPlaceholder = !iconPath || iconPath.includes('Rose_black_white');

  return (
    <button
      type="button"
      onClick={handleClick}
      onKeyDown={handleKey}
      aria-pressed={selected}
      aria-label={`${gift.name} — ${gift.coins} diamantes`}
      className={[
        'group relative flex flex-col items-center justify-between',
        'w-[110px] h-[135px] p-2',
        'rounded-xl border bg-bg-surface text-fg',
        'transition-all duration-150 ease-out outline-none',
        'hover:-translate-y-0.5 hover:shadow-md',
        'focus-visible:ring-2 focus-visible:ring-accent',
        selected
          ? 'border-accent ring-2 ring-accent/40 shadow-md'
          : 'border-border hover:border-fg-muted',
        gift.disabled ? 'opacity-50 saturate-50' : '',
      ].join(' ')}
    >
      {(gift.receivedCount ?? 0) > 0 && (
        <span
          className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1.5 rounded-full bg-accent text-[10px] font-bold text-bg flex items-center justify-center shadow"
          aria-label={`recibido ${gift.receivedCount} veces`}
        >
          {gift.receivedCount}
        </span>
      )}

      <div className="flex-1 flex items-center justify-center w-full">
        {isPlaceholder && gift.icon ? (
          <span
            role="img"
            aria-label={gift.name}
            className="text-[44px] leading-none select-none font-emoji"
          >
            {gift.icon}
          </span>
        ) : (
          <MaruImage
            scope="donaciones"
            path={iconPath || 'Rose_black_white.png'}
            size={64}
            fallback={gift.icon || '🎁'}
            loadingStrategy="intersect"
          />
        )}
      </div>

      <div className="w-full text-center">
        <p className="text-[11px] font-medium leading-tight line-clamp-2 break-words">
          {gift.name}
        </p>
        {!hideCoins && (
          <p className="mt-0.5 text-[10px] text-fg-muted">
            <span aria-hidden="true">💎</span> {gift.coins}
          </p>
        )}
      </div>
    </button>
  );
});
