import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../utils/cn.js';

/**
 * Omitimos `title` del HTMLAttributes para poder aceptar ReactNode
 * (HTML title attribute solo acepta string). Si necesitás el tooltip
 * nativo, usá `data-tooltip` en su lugar.
 */
export interface GroupBoxProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Título visible en la pestañita superpuesta al borde. */
  title: ReactNode;
  /** Densidad del padding interior. Default `md`. */
  density?: 'sm' | 'md' | 'lg';
}

/**
 * GroupBox premium — réplica del `QGroupBox` del MARU original con
 * polish visual: gradient en el title chip + inset highlight + hover sutil
 * en el borde. Mantiene la API y comportamiento idéntico.
 *
 * Estructura: card oscura con un título superpuesto al borde superior.
 * Es la unidad de composición principal del Sidebar (GroupBoxes
 * verticales en el original).
 */
export const GroupBox = forwardRef<HTMLDivElement, GroupBoxProps>(
  (
    {
      className,
      title,
      density = 'md',
      children,
      ...props
    },
    ref,
  ) => {
    const padding =
      density === 'sm'
        ? 'pt-3 px-3 pb-3'
        : density === 'lg'
          ? 'pt-5 px-4 pb-4'
          : 'pt-4 px-3 pb-3';

    return (
      <div
        ref={ref}
        className={cn(
          'maru-groupbox relative bg-mn-card/85 border border-border rounded-md',
          'shadow-inset-top',
          'transition-colors duration-fast ease-maru',
          'hover:border-border-strong/80',
          padding,
          'mt-3.5',
          className,
        )}
        {...props}
      >
        <div
          className={cn(
            'absolute left-2.5 -top-2.5 px-2 py-[3px]',
            'text-[11px] font-bold tracking-wide uppercase',
            'text-mn-cyan',
            'rounded-[5px]',
            'bg-gradient-to-b from-bg-elevated to-mn-card',
            'border border-border',
            'shadow-inset-top',
            'select-none',
          )}
        >
          {title}
        </div>
        {children}
      </div>
    );
  },
);
GroupBox.displayName = 'GroupBox';
