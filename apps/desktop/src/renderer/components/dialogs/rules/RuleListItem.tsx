import { ArrowRight, Copy, Edit3, Play, Shuffle, Trash2 } from 'lucide-react';
import { Badge, Button, Switch } from '@maru/ui';
import { MaruImage } from '@maru/ui';
import type { GameId, Rule } from '@maru/shared';
import { triggerMeta } from './trigger-meta.js';

/**
 * Mapea el `action_type` de una RuleAction → carpeta de imagen dentro
 * de `game_images/<gid>/`.
 *
 * Las reglas guardan el cat_id en singular (entity/item/event) y los
 * legacy types como `spawn`/`give_item`. Las carpetas en bundle son
 * plurales (entities/items/events/valuables).
 */
const ACTION_TYPE_TO_FOLDER: Record<string, string> = {
  // legacy verbs (RuleEngine)
  spawn: 'entities',
  give_item: 'items',
  trigger_event: 'events',
  spawn_valuable: 'valuables',
  // cat_ids singulares (formato GameProfile)
  entity: 'entities',
  item: 'items',
  event: 'events',
  valuable: 'valuables',
  // cat_ids plurales (a veces guardados así)
  entities: 'entities',
  items: 'items',
  events: 'events',
  valuables: 'valuables',
};

function actionFolder(actionType: string): string {
  return ACTION_TYPE_TO_FOLDER[actionType] ?? actionType;
}

/**
 * Resuelve el filename de la imagen del action_value.
 *
 * MARU guarda `action_value` como display name con emoji (ej "🐗 Jabalí").
 * Las imágenes están guardadas por COMMAND name (ej "Boar.png"). Por eso
 * se usa el `nameToCommand` map cuando está disponible. Si falta, se
 * retorna null (caller usa fallback default).
 */
function resolveActionFile(
  actionValue: string,
  folder: string,
  nameToCommand?: Map<string, string>,
): string | null {
  const v = (actionValue ?? '').trim();
  if (!v) return null;
  const key = `${folder}::${v}`;
  const cmd = nameToCommand?.get(key) ?? nameToCommand?.get(v);
  if (cmd) return cmd;
  // Si v ya parece un command (sin emoji ni espacios raros), usarlo.
  if (/^[A-Za-z0-9_\-]+$/.test(v)) return v;
  return null;
}

export interface RuleListItemProps {
  rule: Rule;
  gameId: GameId | null;
  /** Mapa gift_id → iconPath ("donaciones/Rose.png"). */
  giftIcons?: Map<string, string>;
  /** Mapa gift_id → coins (diamantes que cuesta el gift en TikTok). */
  giftCoins?: Map<string, number>;
  /** Mapa "<folder>::<displayName>" o "<displayName>" → command. */
  nameToCommand?: Map<string, string>;
  selected?: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  onSelect?: (id: string) => void;
  /** Click rápido en imagen de donación (paridad MARU `_quick_change_gift`). */
  onQuickChangeGift?: (id: string) => void;
  /** Click rápido en imagen de acción (paridad MARU `_quick_change_entity`). */
  onQuickChangeAction?: (id: string, actionIndex: number) => void;
  busy?: boolean;
}

const EMPTY_GIFT_ICONS = new Map<string, string>();
const EMPTY_GIFT_COINS = new Map<string, number>();
const EMPTY_NAME_TO_CMD = new Map<string, string>();

export function RuleListItem({
  rule,
  gameId,
  giftIcons = EMPTY_GIFT_ICONS,
  giftCoins = EMPTY_GIFT_COINS,
  nameToCommand = EMPTY_NAME_TO_CMD,
  selected = false,
  onToggle,
  onEdit,
  onDuplicate,
  onDelete,
  onTest,
  onSelect,
  onQuickChangeGift,
  onQuickChangeAction,
  busy = false,
}: RuleListItemProps) {
  const meta = triggerMeta(rule.trigger_type);
  const actionCount = rule.actions.length;
  const tts = rule.tts_enabled;
  const cd = rule.cooldown ?? 0;

  // ── Donación / Trigger image ─────────────────────────────────────────
  const isGift = rule.trigger_type === 'gift';
  const tv = (rule.trigger_value ?? '').trim();
  const giftIconPath = isGift
    ? giftIcons.get(tv) ??
      giftIcons.get(tv.toLowerCase()) ??
      null
    : null;
  const giftFile = giftIconPath?.startsWith('donaciones/')
    ? giftIconPath.slice('donaciones/'.length)
    : giftIconPath ?? null;
  // Diamantes que cuesta este gift en TikTok (mostrar al lado de la imagen).
  const giftCost = isGift
    ? giftCoins.get(tv) ?? giftCoins.get(tv.toLowerCase()) ?? null
    : null;

  // ── Acciones (preview principal + thumbnails) ────────────────────────
  const firstAction = rule.actions[0];
  const restActions = rule.actions.slice(1, 3);
  const overflow = actionCount - 1 - restActions.length;

  const firstFolder = firstAction ? actionFolder(firstAction.action_type) : '';
  const firstFile = firstAction
    ? resolveActionFile(firstAction.action_value, firstFolder, nameToCommand)
    : null;

  return (
    <div
      role="listitem"
      onClick={() => onSelect?.(rule.id)}
      className={[
        'group relative flex items-stretch gap-3 px-3 py-2.5 rounded-lg border',
        'transition-colors cursor-pointer',
        selected
          ? 'border-accent bg-accent/10 ring-1 ring-accent/30'
          : 'border-border bg-bg-elev/40 hover:border-fg-muted hover:bg-bg-elev',
        !rule.enabled && 'opacity-60',
      ].join(' ')}
    >
      {/* Switch */}
      <div
        className="flex items-start pt-1 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <Switch
          checked={rule.enabled}
          onChange={(v) => onToggle(rule.id, v)}
          disabled={busy}
          size="sm"
        />
      </div>

      {/* DONACIÓN / Trigger BIG — click cambia gift (paridad MARU). */}
      <div className="flex flex-col items-center justify-center shrink-0 w-[88px]">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (isGift && onQuickChangeGift) onQuickChangeGift(rule.id);
            else onEdit(rule.id);
          }}
          disabled={busy}
          title={
            isGift
              ? 'Click para cambiar la donación'
              : 'Click para editar el trigger'
          }
          className="rounded-md ring-offset-1 ring-offset-bg-base transition-all hover:ring-2 hover:ring-accent/60 hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed cursor-pointer"
        >
          {isGift && giftFile ? (
            <MaruImage
              scope="donaciones"
              path={giftFile}
              size={72}
              fallback="🎁"
              className="rounded-md drop-shadow"
              alt={`Regalo: ${rule.trigger_value}`}
            />
          ) : (
            <div
              className={`flex h-[72px] w-[72px] items-center justify-center rounded-md bg-bg-base/60 ${meta.color}`}
              title={meta.hint}
            >
              <span className="text-4xl font-emoji" aria-hidden>
                {meta.emoji}
              </span>
            </div>
          )}
        </button>
        <span className="mt-1 text-[10px] text-fg-subtle truncate max-w-[88px]">
          {meta.label}
          {!isGift && rule.trigger_value && ` ${rule.trigger_value}`}
        </span>
        {isGift && giftCost != null && giftCost > 0 && (
          <span
            className="mt-0.5 inline-flex items-center gap-0.5 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning"
            title="Costo en diamantes de TikTok"
          >
            💎 {giftCost}
          </span>
        )}
      </div>

      {/* Arrow */}
      <div className="flex items-center text-fg-subtle shrink-0">
        <ArrowRight className="h-5 w-5" />
      </div>

      {/* ACCIÓN BIG — click cambia entity/item/event (paridad MARU). */}
      <div className="flex flex-col items-center justify-center shrink-0 w-[88px]">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (firstAction && onQuickChangeAction)
              onQuickChangeAction(rule.id, 0);
            else onEdit(rule.id);
          }}
          disabled={busy || !gameId}
          title={
            firstAction
              ? 'Click para cambiar la acción'
              : 'Click para editar y agregar acción'
          }
          className="rounded-md ring-offset-1 ring-offset-bg-base transition-all hover:ring-2 hover:ring-accent/60 hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed cursor-pointer"
        >
          {firstAction && gameId && firstFile ? (
            <MaruImage
              scope="game"
              path={`${gameId}/${firstFolder}/${firstFile}.png`}
              size={72}
              fallback={{
                scope: 'game',
                path: `${gameId}/${firstFolder}/_default_${firstFolder}.png`,
              }}
              className="rounded-md drop-shadow"
              alt={firstAction.action_value}
            />
          ) : firstAction && gameId ? (
            <MaruImage
              scope="game"
              path={`${gameId}/${firstFolder}/_default_${firstFolder}.png`}
              size={72}
              fallback="⚙️"
              className="rounded-md drop-shadow opacity-80"
              alt={firstAction.action_value}
            />
          ) : (
            <div className="flex h-[72px] w-[72px] items-center justify-center rounded-md bg-bg-base/60 text-fg-subtle">
              <span className="text-2xl">⚙️</span>
            </div>
          )}
        </button>
        <span className="mt-1 text-[10px] text-fg-subtle truncate max-w-[88px]">
          {firstAction
            ? `×${firstAction.amount || 1} ${firstAction.action_value}`
            : 'sin acción'}
        </span>
      </div>

      {/* Stack tiny acciones extra */}
      {restActions.length > 0 && gameId && (
        <div className="flex items-center gap-1 shrink-0">
          {restActions.map((a, i) => {
            const f = actionFolder(a.action_type);
            const file = resolveActionFile(a.action_value, f, nameToCommand);
            const path = file ? `${gameId}/${f}/${file}.png` : `${gameId}/${f}/_default_${f}.png`;
            return (
              <MaruImage
                key={i}
                scope="game"
                path={path}
                size={36}
                fallback="⚙️"
                className="rounded opacity-80"
                alt={a.action_value}
              />
            );
          })}
          {overflow > 0 && (
            <span className="rounded bg-bg-base/60 px-1.5 py-0.5 text-[10px] text-fg-muted">
              +{overflow}
            </span>
          )}
        </div>
      )}

      {/* Nombre + meta — nombre en su propia línea (truncate full width)
          y badges en línea separada para no sobreponerse con la toolbar.
          Si rule.name es vacío o el placeholder "Sin nombre" del seed,
          derivamos un nombre legible del trigger + acción para que la
          UI no muestre "Sin nombre" en lote. */}
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
        <p className="text-sm font-medium truncate">
          {(() => {
            const raw = (rule.name ?? '').trim();
            if (raw && raw.toLowerCase() !== 'sin nombre') return raw;
            // Fallback inteligente.
            const tt = rule.trigger_type;
            const tv = rule.trigger_value;
            const action = firstAction
              ? (firstAction.action_value || firstAction.action_type_name || '')
              : '';
            let trig = '';
            if (tt === 'command' && tv) trig = `!${tv}`;
            else if (tt === 'gift' && tv) trig = `🎁 ${tv}`;
            else if (tt === 'like' && tv) trig = `❤️ ${tv}+ likes`;
            else if (tt === 'like_milestone' && tv) trig = `🏆 ${tv} likes`;
            else if (tt === 'follow') trig = '➕ Follow';
            else if (tt === 'share') trig = '📤 Share';
            else if (tt === 'subscribe') trig = '⭐ Sub';
            else trig = tt || 'evento';
            return action ? `${trig} → ${action}` : trig;
          })()}
        </p>
        {firstAction && (
          <p className="text-[11px] text-fg-subtle truncate font-mono">
            {actionCount > 1
              ? `${actionCount} acciones · ${firstAction.action_type_name || firstFolder}`
              : firstAction.action_type_name || firstFolder}
            {firstAction.commands?.trim() && ' · cmd'}
          </p>
        )}
        {(rule.random_action && actionCount > 1) || tts || cd > 0 ? (
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            {rule.random_action && actionCount > 1 && (
              <Badge variant="warning" title="Modo aleatorio activo">
                <Shuffle className="h-2.5 w-2.5" /> Random
              </Badge>
            )}
            {tts && <Badge variant="info">TTS</Badge>}
            {cd > 0 && <Badge variant="default">{cd}s CD</Badge>}
          </div>
        ) : null}
      </div>

      {/* Toolbar — slot FIJO a la derecha (ya no `absolute` para no
          sobreponerse con el nombre/badges del centro). */}
      <div
        className="flex items-center gap-0.5 self-center rounded-md bg-bg-elev/40 px-0.5 py-0.5 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <Button variant="ghost" size="sm" onClick={() => onTest(rule.id)} disabled={busy} title="Probar (ejecuta acciones reales en el juego)">
          <Play className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onEdit(rule.id)} disabled={busy} title="Editar">
          <Edit3 className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onDuplicate(rule.id)} disabled={busy} title="Duplicar">
          <Copy className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onDelete(rule.id)} disabled={busy} title="Eliminar">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
