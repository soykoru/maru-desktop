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
 * GroupBox — réplica del `QGroupBox` del MARU original.
 *
 * Estructura: card oscura con un título superpuesto al borde superior.
 * Es la unidad de composición principal del Sidebar (7 GroupBoxes
 * verticales en el original).
 *
 * Estilo derivado del QSS de `gui/themes.py:midnight`:
 *   - bg `rgb(30,30,50,0.9)`
 *   - border 1px `#3a3a5a`
 *   - title color `#7ed6df` (cyan), font 12px bold
 *
 * Premium polish añadido (no rompe paridad):
 *   - inner highlight 1px (subtle inset shadow)
 *   - transition de border en hover
 *   - el título usa el bg del card para "comer" la línea (look QSS)
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
          'maru-groupbox relative bg-mn-card/90 border border-border rounded-md',
          'shadow-[0_1px_0_rgb(255_255_255/0.03)_inset]',
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
            'absolute left-2.5 -top-2.5 px-2 py-0.5',
            'text-[11px] font-bold tracking-wide',
            'text-mn-cyan',
            'rounded-sm',
            'bg-mn-card/95',
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
