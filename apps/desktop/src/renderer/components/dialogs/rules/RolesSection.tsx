import type { RankFlag } from '@maru/shared';
import { RANK_FLAGS_META } from '@maru/shared';
import { Switch } from '@maru/ui';

/**
 * `RolesSection` — restricciones por rango/rol del usuario que dispara la regla.
 *
 * Lógica del backend (Python `Rule.can_trigger` parchado):
 *   - Si `required_ranks` no está vacía → el user debe tener AL MENOS UNO
 *     de los flags listados (acumulativo: un user con varios rangos pasa
 *     cualquier regla que pida cualquiera de los suyos).
 *   - Si `excluded_ranks` no está vacía → si el user tiene ALGUNO de
 *     esos flags, la regla NO dispara.
 *   - Vacío en ambos = regla abierta (default).
 *
 * Combinado con `allowed_users` (lista blanca por nombre) provee 3 ejes
 * de filtrado totalmente independientes.
 */

export interface RolesSectionProps {
  requiredRanks: RankFlag[];
  excludedRanks: RankFlag[];
  onRequiredChange: (r: RankFlag[]) => void;
  onExcludedChange: (r: RankFlag[]) => void;
  disabled?: boolean;
}

export function RolesSection({
  requiredRanks,
  excludedRanks,
  onRequiredChange,
  onExcludedChange,
  disabled = false,
}: RolesSectionProps) {
  const reqSet = new Set(requiredRanks);
  const excSet = new Set(excludedRanks);

  function toggle(
    list: RankFlag[],
    setter: (r: RankFlag[]) => void,
    flag: RankFlag,
  ) {
    if (list.includes(flag)) setter(list.filter((f) => f !== flag));
    else setter([...list, flag]);
  }

  const enabled = requiredRanks.length > 0 || excludedRanks.length > 0;

  // Resumen humano-legible — el user ve EXACTAMENTE qué hace la regla
  // sin tener que mentalmente combinar las dos listas.
  let summary: string;
  if (!enabled) {
    summary = 'Cualquier usuario puede disparar esta regla.';
  } else {
    const parts: string[] = [];
    if (requiredRanks.length > 0) {
      const labels = requiredRanks
        .map((r) => RANK_FLAGS_META.find((m) => m.value === r)?.label ?? r)
        .join(' o ');
      parts.push(`SOLO si tiene: ${labels}`);
    }
    if (excludedRanks.length > 0) {
      const labels = excludedRanks
        .map((r) => RANK_FLAGS_META.find((m) => m.value === r)?.label ?? r)
        .join(' o ');
      parts.push(`NUNCA si tiene: ${labels}`);
    }
    summary = parts.join(' · ');
  }

  return (
    <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-3">
      <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle flex items-center gap-2">
        🛡️ Restricción por rol
        <Switch
          checked={enabled}
          onChange={(v) => {
            if (!v) {
              // Apagar limpia ambas listas.
              onRequiredChange([]);
              onExcludedChange([]);
            }
            // Encender NO añade nada por default — el user elige flags.
            // El switch refleja el estado computado (enabled) en cuanto
            // hay al menos un flag en cualquiera de las dos listas.
          }}
          disabled={disabled}
        />
        {enabled && (
          <button
            type="button"
            onClick={() => {
              onRequiredChange([]);
              onExcludedChange([]);
            }}
            disabled={disabled}
            className="text-[10px] text-fg-subtle hover:text-danger underline ml-auto"
            title="Limpiar todas las restricciones"
          >
            Limpiar todo
          </button>
        )}
      </legend>

      {/* Resumen humano-legible — el "qué hace esta regla" en una línea */}
      <div
        className={[
          'rounded-md px-2.5 py-1.5 text-[11px] border',
          enabled
            ? 'border-accent/40 bg-accent/5 text-fg-default'
            : 'border-border bg-bg-base/30 text-fg-subtle italic',
        ].join(' ')}
      >
        <strong className="text-accent">Resumen:</strong> {summary}
      </div>

      <p className="text-[11px] text-fg-subtle">
        Tocá un rango en <strong className="text-success">verde</strong> para
        permitirlo o en <strong className="text-danger">rojo</strong> para
        bloquearlo. Podés combinar ambas listas — la regla dispara solo si el
        usuario cumple TODAS las condiciones.
      </p>

      {/* Required */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold text-fg-default flex items-center gap-1.5">
          ✅ Permitir solo si tiene alguno de estos
          {requiredRanks.length > 0 && (
            <span className="rounded-full bg-success/15 text-success px-1.5 py-0.5 font-bold text-[9px]">
              {requiredRanks.length}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1">
          {RANK_FLAGS_META.map((m) => {
            const isOn = reqSet.has(m.value);
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => toggle(requiredRanks, onRequiredChange, m.value)}
                disabled={disabled}
                className={[
                  'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors',
                  isOn
                    ? 'border-success/60 bg-success/15 text-success font-semibold'
                    : 'border-border bg-bg-base/40 text-fg-subtle hover:border-success/40 hover:text-fg-default',
                ].join(' ')}
                title={m.label}
              >
                <span>{m.emoji}</span>
                <span className="truncate">{m.label}</span>
                {isOn && <span className="ml-auto text-[10px]">✓</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Excluded */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold text-fg-default flex items-center gap-1.5">
          🚫 Bloquear si tiene alguno de estos
          {excludedRanks.length > 0 && (
            <span className="rounded-full bg-danger/15 text-danger px-1.5 py-0.5 font-bold text-[9px]">
              {excludedRanks.length}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1">
          {RANK_FLAGS_META.map((m) => {
            const isOn = excSet.has(m.value);
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => toggle(excludedRanks, onExcludedChange, m.value)}
                disabled={disabled}
                className={[
                  'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors',
                  isOn
                    ? 'border-danger/60 bg-danger/15 text-danger font-semibold'
                    : 'border-border bg-bg-base/40 text-fg-subtle hover:border-danger/40 hover:text-fg-default',
                ].join(' ')}
                title={m.label}
              >
                <span>{m.emoji}</span>
                <span className="truncate">{m.label}</span>
                {isOn && <span className="ml-auto text-[10px]">✗</span>}
              </button>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}
