import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../utils/cn.js';

/**
 * VolumeSlider premium — slider fluido con state local + debounce.
 *
 * Problema que resuelve: hasta v1.0.34, cada `onChange` del slider
 * disparaba un RPC al sidecar inmediatamente. Eso era 60+ RPCs/seg
 * cuando arrastrás → lag visual y spam de red.
 *
 * Solución:
 *   - State LOCAL `localValue` que actualiza la UI a 60fps sin RPC.
 *   - `onCommit` (debounced 150ms) persiste al sidecar después de
 *     que el user soltó el slider o paró de mover.
 *   - Track con gradient visual proporcional al valor (premium).
 *   - Thumb con glow al hover/drag.
 *   - Tabular nums en el badge de %.
 *
 * Cero overhead vs slider nativo: la única lógica extra es un
 * setTimeout que se cancela en cada cambio.
 */
export interface VolumeSliderProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** Icon visible a la izquierda. */
  icon?: ReactNode;
  /** Mostrar el valor "X%" a la derecha. Default true. */
  showValue?: boolean;
  /** Sufijo del valor (default "%"). */
  suffix?: string;
  /** Color del track activo. Default --maru-accent. */
  accentColor?: 'accent' | 'primary' | 'success' | 'info';
  /** Debounce ms para el commit. Default 150ms. */
  debounceMs?: number;
  className?: string;
  'aria-label'?: string;
}

const accentMap: Record<NonNullable<VolumeSliderProps['accentColor']>, string> = {
  accent:  'rgb(var(--maru-accent))',
  primary: 'rgb(var(--maru-mn-button))',
  success: 'rgb(var(--maru-success))',
  info:    'rgb(var(--maru-info))',
};

export function VolumeSlider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  icon,
  showValue = true,
  suffix = '%',
  accentColor = 'accent',
  debounceMs = 150,
  className,
  'aria-label': ariaLabel,
}: VolumeSliderProps) {
  // State local instantáneo (UI responsive sin esperar RPC).
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<number | null>(null);
  const lastCommittedRef = useRef(value);

  // Sync state local cuando el prop value cambia desde fuera (e.g. el
  // store actualiza desde una RPC externa).
  useEffect(() => {
    if (value !== lastCommittedRef.current) {
      setLocalValue(value);
      lastCommittedRef.current = value;
    }
  }, [value]);

  function handleSliderChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = parseInt(e.target.value, 10);
    if (Number.isNaN(next)) return;
    setLocalValue(next);

    // Debounce el commit. Si el user sigue moviendo, cancela el
    // timeout previo y arma uno nuevo. Cuando deja de mover 150ms,
    // dispara onChange (que típicamente hace el RPC).
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      lastCommittedRef.current = next;
      onChange(next);
      debounceRef.current = null;
    }, debounceMs);
  }

  // Al soltar (mouseup/touchend) commit inmediato sin esperar debounce.
  function handleCommit() {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (localValue !== lastCommittedRef.current) {
      lastCommittedRef.current = localValue;
      onChange(localValue);
    }
  }

  // Cleanup al desmontar.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const pct = ((localValue - min) / (max - min)) * 100;
  const accent = accentMap[accentColor];
  // Track con gradient proporcional: la parte "rellena" se pinta con
  // el accent del tema, la parte vacía con un track neutro sutil.
  const trackBg = `linear-gradient(to right, ${accent} 0%, ${accent} ${pct}%, rgb(var(--maru-fg) / 0.10) ${pct}%, rgb(var(--maru-fg) / 0.10) 100%)`;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {icon && (
        <span className="shrink-0 text-fg-muted">{icon}</span>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={localValue}
        disabled={disabled}
        onChange={handleSliderChange}
        onMouseUp={handleCommit}
        onTouchEnd={handleCommit}
        onKeyUp={handleCommit}
        aria-label={ariaLabel}
        className="maru-volume-slider flex-1"
        style={{
          background: trackBg,
        }}
      />
      {showValue && (
        <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-fg-subtle">
          {localValue}
          {suffix}
        </span>
      )}
    </div>
  );
}
