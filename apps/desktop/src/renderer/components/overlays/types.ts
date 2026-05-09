/**
 * Tipos del panel Overlays (renderer).
 *
 * El shape del config por overlay vive acá — sólo el editor lo usa,
 * por eso no merece subir a `@maru/shared` (es UI-side).
 */

export interface TapsConfig {
  goal: number;
  color: string;
  message: string;
  reset_on_goal: boolean;
}

export interface StreakConfig {
  duration: number;
  label: string;
}

export type OverlayConfigById = {
  taps: TapsConfig;
  streak: StreakConfig;
};

export type OverlayId = keyof OverlayConfigById;
