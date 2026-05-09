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
 *   - Si `is_member` está en required, además se valida `member_level` ∈
 *     [member_level_min, member_level_max] cuando ambos están definidos.
 *   - Mismo para `is_gift_giver` con `gifter_level_min/max`.
 *   - Vacío en todos = regla abierta (default).
 *
 * Combinado con `allowed_users` (lista blanca por nombre) provee 3 ejes
 * de filtrado totalmente independientes.
 */

export interface RolesSectionProps {
  requiredRanks: RankFlag[];
  excludedRanks: RankFlag[];
  onRequiredChange: (r: RankFlag[]) => void;
  onExcludedChange: (r: RankFlag[]) => void;
  /** Rango de nivel para is_member (solo aplica si is_member en required). */
  memberLevelMin?: number;
  memberLevelMax?: number;
  onMemberLevelChange?: (min: number | undefined, max: number | undefined) => void;
  /** Rango de nivel para is_gift_giver (solo aplica si en required). */
  gifterLevelMin?: number;
  gifterLevelMax?: number;
  onGifterLevelChange?: (min: number | undefined, max: number | undefined) => void;
  disabled?: boolean;
}

export function RolesSection({
  requiredRanks,
  excludedRanks,
  onRequiredChange,
  onExcludedChange,
  memberLevelMin,
  memberLevelMax,
  onMemberLevelChange,
  gifterLevelMin,
  gifterLevelMax,
  onGifterLevelChange,
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

        {/* Filtros de nivel — solo cuando el rol con `hasLevel` está en required.
            Permite ej. "solo miembros L5..L10" o "solo top-gifters rank 1..3". */}
        {reqSet.has('is_member') && onMemberLevelChange && (
          <LevelRangeRow
            label="🌸 Nivel del miembro (fans club)"
            min={memberLevelMin}
            max={memberLevelMax}
            onChange={onMemberLevelChange}
            disabled={disabled}
            placeholderMin="1"
            placeholderMax="∞"
            hint="Vacío = cualquier nivel."
          />
        )}
        {reqSet.has('is_gift_giver') && onGifterLevelChange && (
          <LevelRangeRow
            label="🎁 Nivel del donador (1..50)"
            min={gifterLevelMin}
            max={gifterLevelMax}
            onChange={onGifterLevelChange}
            disabled={disabled}
            placeholderMin="1"
            placeholderMax="50"
            hint="Vacío = cualquier nivel del ranking de gifters del live."
          />
        )}
      </div>

      {/* Excluded - los niveles solo aplican al required (positivo).
          Filtrar por "miembros L5..L10 NUNCA" no tiene un caso de uso real. */}
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

/** Sub-control compacto: dos inputs numéricos (min, max) + botón limpiar.
 *  Usado para filtrar por nivel de fans club / ranking de gifters. */
function LevelRangeRow({
  label,
  min,
  max,
  onChange,
  disabled,
  placeholderMin,
  placeholderMax,
  hint,
}: {
  label: string;
  min: number | undefined;
  max: number | undefined;
  onChange: (min: number | undefined, max: number | undefined) => void;
  disabled?: boolean;
  placeholderMin?: string;
  placeholderMax?: string;
  hint?: string;
}) {
  const empty = min === undefined && max === undefined;
  return (
    <div className="mt-1.5 rounded-md border border-success/30 bg-success/5 px-2.5 py-2 space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-fg-default">{label}</span>
        {!empty && (
          <button
            type="button"
            onClick={() => onChange(undefined, undefined)}
            disabled={disabled}
            className="ml-auto text-[10px] text-fg-subtle hover:text-danger underline"
          >
            Limpiar
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="text-fg-subtle">Mín</span>
        <input
          type="number"
          min={1}
          value={min ?? ''}
          onChange={(e) => {
            const v = e.target.value.trim();
            const n = v === '' ? undefined : Math.max(1, Number(v));
            onChange(n, max);
          }}
          disabled={disabled}
          placeholder={placeholderMin ?? '1'}
          className="w-16 rounded border border-border bg-bg-base px-1.5 py-0.5 text-fg-default focus:border-accent focus:outline-none disabled:opacity-50"
        />
        <span className="text-fg-subtle">Máx</span>
        <input
          type="number"
          min={1}
          value={max ?? ''}
          onChange={(e) => {
            const v = e.target.value.trim();
            const n = v === '' ? undefined : Math.max(1, Number(v));
            onChange(min, n);
          }}
          disabled={disabled}
          placeholder={placeholderMax ?? '∞'}
          className="w-16 rounded border border-border bg-bg-base px-1.5 py-0.5 text-fg-default focus:border-accent focus:outline-none disabled:opacity-50"
        />
        {hint && (
          <span className="text-[10px] text-fg-subtle ml-1.5 truncate" title={hint}>
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}
