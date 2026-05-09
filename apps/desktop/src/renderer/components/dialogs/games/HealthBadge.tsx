import { useAppStore } from '../../../lib/store/index.js';

/**
 * `HealthBadge` — pill de salud del mod del juego (v1.0.72).
 *
 * Lee el state `gameHealth[gameId]` que el sidecar mantiene actualizado
 * cada 30s vía push event `game:health`. Solo se pinta para el juego
 * ACTIVO (que es el único que se chequea para no saturar mods inactivos).
 *
 * Estados:
 *   - ok    → 🟢 punto verde
 *   - slow  → 🟡 punto amarillo (latencia > 1500ms)
 *   - down  → 🔴 punto rojo (timeout / error / mod caído)
 *   - sin data: no se renderiza nada (juego nunca chequeado).
 */
export function HealthBadge({ gameId }: { gameId: string }) {
  const state = useAppStore((s) => s.gameHealth[gameId]);
  if (!state) return null;

  const color =
    state.status === 'ok'
      ? 'bg-success'
      : state.status === 'slow'
        ? 'bg-warning'
        : 'bg-danger';

  // Edad del último check; si pasó >2 min sin tick atenuamos visualmente
  // para indicar que el dato está stale (puede ser que el juego ya no esté
  // activo y el healthcheck no lo monitorea más).
  const ageMs = Date.now() - state.ts;
  const stale = ageMs > 120_000;

  const labelStatus =
    state.status === 'ok' ? 'OK' : state.status === 'slow' ? 'Lento' : 'Caído';
  const tooltip = `${labelStatus} · ${state.latencyMs}ms\n${state.message}`;

  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${color} ${
        stale ? 'opacity-40' : ''
      }`}
      title={tooltip}
      aria-label={`Estado del mod: ${labelStatus} (${state.latencyMs}ms)`}
    />
  );
}
