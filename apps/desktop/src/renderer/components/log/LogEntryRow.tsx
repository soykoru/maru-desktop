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
 * Clasifica un chip de rol del log y devuelve la clase Tailwind/CSS
 * apropiada. Diferencia visualmente:
 *   - super fan / fan L#  → ⭐ dorado
 *   - mod                 → 🛡️ azul cyan
 *   - top gifter / topN   → 🏆 púrpura
 *   - member L#           → verde (hierro/bronce-fan)
 *   - gifter G#           → ámbar
 *   - follower            → gris muted (chip más sobrio)
 *   - streamer / anchor   → accent (host del live)
 *   - friend / verified   → sutil
 */
function chipKind(raw: string):
  | 'superfan'
  | 'mod'
  | 'top'
  | 'member'
  | 'gifter'
  | 'follower'
  | 'streamer'
  | 'misc' {
  const t = raw.toLowerCase().trim();
  if (t === 'superfan' || t.startsWith('superfan')) return 'superfan';
  if (t === 'mod' || t === 'admin') return 'mod';
  if (t === 'topgifter' || /^top\d*$/.test(t)) return 'top';
  if (t.startsWith('member') || /^l\d+$/.test(t)) return 'member';
  if (/^g\d+$/.test(t)) return 'gifter';
  if (t === 'follower') return 'follower';
  if (t === 'streamer' || t === 'anchor') return 'streamer';
  return 'misc';
}

function chipClass(raw: string): string {
  const base =
    'inline-flex items-center gap-0.5 rounded px-1.5 py-px text-[9px] font-semibold tracking-wide leading-none border';
  switch (chipKind(raw)) {
    case 'superfan':
      return `${base} bg-warning/15 text-warning border-warning/35`;
    case 'mod':
      return `${base} bg-accent-blue/18 text-accent-blue border-accent-blue/35`;
    case 'top':
      return `${base} bg-accent-purple/18 text-accent-purple border-accent-purple/35`;
    case 'member':
      return `${base} bg-accent-green/18 text-accent-green border-accent-green/35`;
    case 'gifter':
      return `${base} bg-accent/15 text-accent border-accent/35`;
    case 'streamer':
      return `${base} bg-accent/20 text-accent border-accent/45`;
    case 'follower':
      return `${base} bg-fg/8 text-fg-muted border-border`;
    default:
      return `${base} bg-fg/10 text-fg-subtle border-border`;
  }
}

/**
 * Para chips conocidos mostramos un emoji + label compacto.
 * Para los demás respetamos el texto raw del backend.
 */
function chipLabel(raw: string): string {
  const t = raw.toLowerCase().trim();
  if (t === 'superfan') return '⭐ FAN';
  if (t.startsWith('superfan')) return raw.toUpperCase().replace('SUPERFAN', '⭐');
  if (t === 'mod' || t === 'admin') return '🛡 MOD';
  if (t === 'topgifter') return '🏆 TOP';
  if (/^top\d+$/.test(t)) return '🏆 ' + raw.replace(/^top/i, '#');
  if (t.startsWith('member ')) return '🪙 ' + raw.toUpperCase().replace('MEMBER ', '');
  if (t === 'follower') return 'sigue';
  if (t === 'streamer' || t === 'anchor') return '🎙 HOST';
  if (t === 'new') return '🆕 NEW';
  if (t === 'friend') return 'amigo';
  return raw;
}

function chipTooltip(raw: string): string {
  switch (chipKind(raw)) {
    case 'superfan':
      return 'Super Fan (suscriptor del live)';
    case 'mod':
      return 'Moderador del live';
    case 'top':
      return 'Top Gifter del ranking';
    case 'member':
      return 'Miembro del Fans Club';
    case 'gifter':
      return 'Nivel de Gifter';
    case 'follower':
      return 'Te sigue';
    case 'streamer':
      return 'El streamer';
    default:
      return raw;
  }
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
  const avatar =
    typeof entry.meta?.avatar === 'string' && entry.meta.avatar.startsWith('http')
      ? (entry.meta.avatar as string)
      : null;

  return (
    <div
      data-cv-auto-row
      className={`maru-event-card cat-${entry.category}`}
      title={`[${entry.source}] ${entry.message}`}
    >
      {avatar ? (
        <img
          src={avatar}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="maru-event-avatar"
          onError={(e) => {
            // Fallback al emoji si el CDN de TikTok rota la URL.
            (e.currentTarget as HTMLImageElement).style.display = 'none';
            const sib = (e.currentTarget as HTMLImageElement)
              .nextElementSibling as HTMLElement | null;
            if (sib) sib.style.display = '';
          }}
        />
      ) : null}
      <span
        className="maru-event-icon"
        aria-hidden="true"
        style={avatar ? { display: 'none' } : undefined}
      >
        {meta.emoji}
      </span>

      <div className="maru-event-body">
        <div className="maru-event-line">
          {chips.length > 0 && (
            <span className="inline-flex gap-1 mr-0.5">
              {chips.map((t, i) => (
                <span
                  key={i}
                  className={chipClass(t)}
                  title={chipTooltip(t)}
                >
                  {chipLabel(t)}
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
