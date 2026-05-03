import { memo } from 'react';
import type { LogEntry } from '@maru/shared';
import { categoryMeta } from './log-meta.js';

/**
 * `LogEntryRow` (FASE V5 v1.0.40) — fila tipo card para cada evento.
 *
 * Cambia respecto a la versión previa:
 *   - Card pill con icono coloreado a la izquierda en vez de stripe 2px.
 *   - Body con dos líneas: principal (who + what) y meta opcional.
 *   - Timestamp en la derecha, mono tabular, opacidad 85%.
 *   - Categorías con clase `cat-{id}` para tinte sutil + icon color.
 *
 * MANTIENE:
 *   - `data-cv-auto-row` para content-visibility (perf).
 *   - `memo` para evitar re-renders en cada push.
 *   - Resaltado de @mentions y [rangos] en chips.
 *   - Level badge solo para ERROR/WARN/CRITICAL.
 *   - Title attribute con source y mensaje completo.
 */
export interface LogEntryRowProps {
  entry: LogEntry;
  showTimestamp?: boolean;
}

const LEVEL_BADGE: Record<
  string,
  { text: string; cls: string } | null
> = {
  ERROR: { text: 'ERR', cls: 'bg-danger/20 text-danger' },
  CRITICAL: { text: 'CRIT', cls: 'bg-danger/30 text-danger' },
  WARNING: { text: 'WRN', cls: 'bg-warning/20 text-warning' },
  WARN: { text: 'WRN', cls: 'bg-warning/20 text-warning' },
  INFO: null,
  DEBUG: { text: 'DBG', cls: 'bg-fg/10 text-fg-subtle' },
};

function fmtTime(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 8);
}

/**
 * Tokeniza el mensaje en piezas:
 *   1. Prefijo de chips `[mod][member L3]` → render como chips.
 *   2. Primer @mention → tratado como `who`.
 *   3. Resto → `what` con @mentions internos resaltados.
 *
 * Evita parsing pesado: regex únicos, sin loops anidados.
 */
function partitionMessage(message: string): {
  chips: string[];
  who: string | null;
  what: React.ReactNode;
} {
  let rest = message;
  const chips: string[] = [];

  const rankMatch = /^((?:\[[^\]]+\])+)\s*/.exec(rest);
  if (rankMatch && rankMatch[1]) {
    const tags = Array.from(rankMatch[1].matchAll(/\[([^\]]+)\]/g))
      .map((m) => m[1])
      .filter((t): t is string => Boolean(t));
    chips.push(...tags);
    rest = rest.slice(rankMatch[0].length);
  }

  // Primer @user al inicio (post chips) → who.
  let who: string | null = null;
  const mentionAtStart = /^@([a-z0-9._]{2,30})/i.exec(rest);
  if (mentionAtStart && mentionAtStart[1]) {
    who = '@' + mentionAtStart[1];
    rest = rest.slice(mentionAtStart[0].length).replace(/^[\s:,-]+/, '');
  }

  // Resaltar @mentions internos restantes.
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  const userRe = /@[a-z0-9._]{2,30}/gi;
  let m: RegExpExecArray | null;
  while ((m = userRe.exec(rest)) !== null) {
    if (m.index > lastIdx) parts.push(rest.slice(lastIdx, m.index));
    parts.push(
      <span key={m.index} className="text-accent font-semibold">
        {m[0]}
      </span>,
    );
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < rest.length) parts.push(rest.slice(lastIdx));

  return {
    chips,
    who,
    what: parts.length === 0 ? rest : parts,
  };
}

export const LogEntryRow = memo(function LogEntryRow({
  entry,
  showTimestamp = true,
}: LogEntryRowProps) {
  const meta = categoryMeta(entry.category);
  const levelBadge = LEVEL_BADGE[entry.level] ?? null;
  const { chips, who, what } = partitionMessage(entry.message);

  return (
    <div
      data-cv-auto-row
      className={`maru-event-card cat-${entry.category}`}
      title={`[${entry.source}] ${entry.message}`}
    >
      <span className="maru-event-icon" aria-hidden="true">
        {meta.emoji}
      </span>

      <div className="maru-event-body">
        <div className="maru-event-line">
          {chips.length > 0 && (
            <span className="inline-flex gap-1 mr-0.5">
              {chips.map((t, i) => (
                <span
                  key={i}
                  className="rounded px-1 py-px text-[8.5px] font-bold uppercase tracking-wide bg-accent/15 text-accent leading-none"
                >
                  {t}
                </span>
              ))}
            </span>
          )}
          {levelBadge && (
            <span className={`maru-event-level ${levelBadge.cls}`}>
              {levelBadge.text}
            </span>
          )}
          {who && <span className="who">{who}</span>}
          <span className="what">{what}</span>
        </div>
      </div>

      {showTimestamp && (
        <span className="maru-event-ts" aria-label={`Hora ${fmtTime(entry.ts)}`}>
          {fmtTime(entry.ts)}
        </span>
      )}
    </div>
  );
});
