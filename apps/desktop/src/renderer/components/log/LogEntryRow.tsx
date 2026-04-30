import { memo } from 'react';
import type { LogEntry } from '@maru/shared';
import { categoryMeta } from './log-meta.js';

/**
 * `LogEntryRow` — fila profesional del log con stripe de categoría +
 * fondo tintado para categorías "fuertes" (gifts/errors) + parsing de
 * username (`@user`) y prefijo de rangos (`[mod]`/`[member L3]`/etc.).
 *
 * Reemplaza la versión plana monocromática por una de "logs de stream
 * tools" donde cada tipo de evento es identificable de un vistazo:
 *   - barra vertical 2px con color de categoría a la izquierda
 *   - emoji de categoría con su color
 *   - level badge (ERROR / WARN solo cuando aplica)
 *   - timestamp opcional (gris claro, tabular)
 *   - message con @user resaltado y `[rangos]` con chips
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

const CATEGORY_BG_TINT: Record<string, string> = {
  gift: 'bg-warning/[0.06] hover:bg-warning/10',
  error: 'bg-danger/[0.07] hover:bg-danger/10',
  warn: 'bg-warning/[0.05] hover:bg-warning/10',
  rule: 'bg-accent/[0.05] hover:bg-accent/10',
  action: 'bg-accent/[0.05] hover:bg-accent/10',
};

const CATEGORY_STRIPE: Record<string, string> = {
  comment: 'bg-info',
  command: 'bg-info',
  emote: 'bg-info',
  gift: 'bg-warning',
  follow: 'bg-success',
  share: 'bg-info',
  like: 'bg-accent-red',
  subscribe: 'bg-warning',
  rule: 'bg-accent',
  action: 'bg-accent',
  social: 'bg-success',
  music: 'bg-success',
  ia: 'bg-info',
  tts: 'bg-info',
  sound: 'bg-info',
  tiktok: 'bg-info',
  profile: 'bg-fg-muted',
  system: 'bg-fg-muted',
  error: 'bg-danger',
  warn: 'bg-warning',
  debug: 'bg-fg-subtle',
};

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return d.toTimeString().slice(0, 8);
}

// Resalta `@username` en el texto del mensaje (color accent + bold).
// También resalta los chips de rangos al inicio: `[mod][member L3]` etc.
function renderMessage(message: string): React.ReactNode {
  // Detectar prefijo de rangos: `[mod][member L3][G5]...:` o sin `:`.
  const rankMatch = /^((?:\[[^\]]+\])+)\s*/.exec(message);
  let rest = message;
  let chips: React.ReactNode = null;
  if (rankMatch && rankMatch[1]) {
    const tags = Array.from(rankMatch[1].matchAll(/\[([^\]]+)\]/g))
      .map((m) => m[1])
      .filter((t): t is string => Boolean(t));
    chips = (
      <span className="inline-flex gap-1 mr-1.5 align-middle">
        {tags.map((t, i) => (
          <span
            key={i}
            className="rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide bg-accent/15 text-accent leading-none"
          >
            {t}
          </span>
        ))}
      </span>
    );
    rest = message.slice(rankMatch[0].length);
  }

  // Resaltar @user mentions.
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

  return (
    <>
      {chips}
      {parts.length === 0 ? rest : parts}
    </>
  );
}

export const LogEntryRow = memo(function LogEntryRow({
  entry,
  showTimestamp = true,
}: LogEntryRowProps) {
  const meta = categoryMeta(entry.category);
  const tint = CATEGORY_BG_TINT[entry.category] ?? 'hover:bg-fg/5';
  const stripe = CATEGORY_STRIPE[entry.category] ?? 'bg-fg-muted';
  const levelBadge = LEVEL_BADGE[entry.level] ?? null;

  return (
    <div
      className={`group flex items-baseline gap-2 px-2 py-[3px] text-[11px] font-mono leading-snug rounded-sm relative pl-3 ${tint}`}
      title={`[${entry.source}] ${entry.message}`}
    >
      <span
        className={`absolute left-0 top-1 bottom-1 w-[2px] rounded-full ${stripe}`}
        aria-hidden="true"
      />
      {showTimestamp && (
        <span className="text-fg-subtle shrink-0 tabular-nums opacity-70 group-hover:opacity-100">
          {fmtTime(entry.ts)}
        </span>
      )}
      <span className={`shrink-0 ${meta.color}`} title={entry.category}>
        {meta.emoji}
      </span>
      {levelBadge && (
        <span
          className={`shrink-0 rounded px-1 py-px text-[9px] font-bold tracking-wide leading-none ${levelBadge.cls}`}
        >
          {levelBadge.text}
        </span>
      )}
      <span className="text-fg break-words flex-1 min-w-0">
        {renderMessage(entry.message)}
      </span>
    </div>
  );
});
