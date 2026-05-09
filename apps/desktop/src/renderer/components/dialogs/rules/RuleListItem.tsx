import { memo } from 'react';
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
 * PNG default por trigger_type (`resources/data/icons_triggers/`).
 *
 * Cada vez que se suma un trigger nuevo en `trigger-meta.ts`, hay que
 * generar el PNG (ver `scripts/generate_trigger_icons.py`) y registrar
 * la entrada acá. Sin esto, el card del trigger cae al fallback emoji.
 */
const TRIGGER_FILE_BY_TYPE: Record<string, string> = {
  gift: 'trigger_gift.png',
  command: 'trigger_command.png',
  follow: 'trigger_follow.png',
  share: 'trigger_share.png',
  subscribe: 'trigger_subscribe.png',
  like: 'trigger_like.png',
  like_milestone: 'trigger_like_milestone.png',
  emote: 'trigger_emote.png',
  join: 'trigger_join.png',
};

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

/** Densidad visual del card. v1.0.57+:
 *  - `compact`: imágenes 40px, padding y gaps reducidos.
 *  - `normal`: imágenes 72px (default histórico).
 *  - `large`: imágenes 96px, padding amplio.
 *  La elección se persiste en `settings.json` clave `rulesDensity`.
 *
 *  v1.1.4: el modo "cuadrícula vs lista" se separó a un control aparte
 *  (`rulesLayout`) — la densidad combina con cualquier layout. */
export type RuleDensity = 'compact' | 'normal' | 'large';

const DENSITY_TOKENS: Record<
  RuleDensity,
  {
    px: 'px-2' | 'px-3' | 'px-4';
    py: 'py-1.5' | 'py-2.5' | 'py-3.5';
    gap: 'gap-2' | 'gap-3' | 'gap-4';
    img: number;
    cell: 'w-[60px]' | 'w-[88px]' | 'w-[112px]';
    label: 'text-[9px]' | 'text-[10px]' | 'text-[11px]';
    title: 'text-[12px]' | 'text-sm' | 'text-base';
  }
> = {
  compact: {
    px: 'px-2', py: 'py-1.5', gap: 'gap-2',
    img: 40, cell: 'w-[60px]', label: 'text-[9px]', title: 'text-[12px]',
  },
  normal: {
    px: 'px-3', py: 'py-2.5', gap: 'gap-3',
    img: 72, cell: 'w-[88px]', label: 'text-[10px]', title: 'text-sm',
  },
  large: {
    px: 'px-4', py: 'py-3.5', gap: 'gap-4',
    img: 96, cell: 'w-[112px]', label: 'text-[11px]', title: 'text-base',
  },
};

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
  /** Densidad visual del card. Default: 'normal'. */
  density?: RuleDensity;
  /** v1.1.4: cuando es 'grid', el card se renderea más compacto y los
   * textos largos se truncan con ellipsis. La card debe verse bien con
   * ~50% del ancho disponible (en pantallas xl, ~33%). */
  layout?: 'list' | 'grid';
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

function RuleListItemImpl({
  rule,
  gameId,
  layout = 'list',
  giftIcons = EMPTY_GIFT_ICONS,
  giftCoins = EMPTY_GIFT_COINS,
  nameToCommand = EMPTY_NAME_TO_CMD,
  selected = false,
  density = 'normal',
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
  // v1.1.5: cuando layout='grid' renderear la versión cuadrada en
  // columnas. La versión lista (default) sigue exactamente igual.
  if (layout === 'grid') {
    return (
      <RuleGridCardImpl
        rule={rule}
        gameId={gameId}
        giftIcons={giftIcons}
        giftCoins={giftCoins}
        nameToCommand={nameToCommand}
        selected={selected}
        density={density}
        onToggle={onToggle}
        onEdit={onEdit}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        onTest={onTest}
        onSelect={onSelect}
        onQuickChangeGift={onQuickChangeGift}
        onQuickChangeAction={onQuickChangeAction}
        busy={busy}
      />
    );
  }
  const meta = triggerMeta(rule.trigger_type);
  const actionCount = rule.actions.length;
  const tts = rule.tts_enabled;
  const cd = rule.cooldown ?? 0;
  const tokens = DENSITY_TOKENS[density];

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
        // `flex-wrap` clave: en panel angosto el toolbar baja a 2da fila
        // dentro del card en vez de desbordarse fuera. La toolbar usa
        // `ml-auto` para anclarse a la derecha en ambas configuraciones.
        'group relative flex flex-wrap items-stretch rounded-lg border overflow-hidden',
        tokens.gap, tokens.px, tokens.py,
        'transition-all cursor-pointer',
        // v1.1.5: en este punto layout siempre es 'list' (grid retornó
        // antes en RuleGridCardImpl). Mantenemos el comportamiento legacy.
        selected
          ? 'border-accent bg-accent/10 ring-1 ring-accent/30'
          : 'border-border bg-bg-elev/40 hover:border-fg-muted hover:bg-bg-elev',
        !rule.enabled && 'opacity-60',
      ].filter(Boolean).join(' ')}
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
      <div className={`flex flex-col items-center justify-center shrink-0 ${tokens.cell}`}>
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
              size={tokens.img}
              fallback="🎁"
              className="rounded-md drop-shadow"
              alt={`Regalo: ${rule.trigger_value}`}
            />
          ) : TRIGGER_FILE_BY_TYPE[rule.trigger_type] ? (
            <MaruImage
              scope="triggers"
              path={TRIGGER_FILE_BY_TYPE[rule.trigger_type] as string}
              size={tokens.img}
              fallback={meta.emoji}
              className="rounded-md drop-shadow"
              alt={meta.label}
            />
          ) : (
            <div
              className={`flex items-center justify-center rounded-md bg-bg-base/60 ${meta.color}`}
              style={{ height: tokens.img, width: tokens.img }}
              title={meta.hint}
            >
              <span
                className="font-emoji"
                style={{ fontSize: Math.max(20, Math.round(tokens.img * 0.55)) }}
                aria-hidden
              >
                {meta.emoji}
              </span>
            </div>
          )}
        </button>
        {density !== 'compact' && (
          <span className={`mt-1 ${tokens.label} text-fg-subtle truncate max-w-full`}>
            {meta.label}
            {!isGift && rule.trigger_value && ` ${rule.trigger_value}`}
          </span>
        )}
        {isGift && giftCost != null && giftCost > 0 && density !== 'compact' && (
          <span
            className={`mt-0.5 inline-flex items-center gap-0.5 rounded bg-warning/15 px-1.5 py-0.5 ${tokens.label} font-semibold text-warning`}
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
      <div className={`flex flex-col items-center justify-center shrink-0 ${tokens.cell}`}>
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
              size={tokens.img}
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
              size={tokens.img}
              fallback="⚙️"
              className="rounded-md drop-shadow opacity-80"
              alt={firstAction.action_value}
            />
          ) : (
            <div
              className="flex items-center justify-center rounded-md bg-bg-base/60 text-fg-subtle"
              style={{ height: tokens.img, width: tokens.img }}
            >
              <span style={{ fontSize: Math.max(16, Math.round(tokens.img * 0.4)) }}>⚙️</span>
            </div>
          )}
        </button>
        {density !== 'compact' && (
          <span className={`mt-1 ${tokens.label} text-fg-subtle truncate max-w-full`}>
            {firstAction
              ? `×${firstAction.amount || 1} ${firstAction.action_value}`
              : 'sin acción'}
          </span>
        )}
      </div>

      {/* Stack tiny acciones extra — `hidden xl:flex` para que se
          oculten cuando la ventana es estrecha y NO empujen los botones
          de la toolbar fuera del card (bug visual reportado). En
          pantallas anchas (xl+) se ven igual que antes. El `+overflow`
          badge muestra cuántas hay sin importar el tamaño.
          v1.1.5: layout='grid' renderea por RuleGridCardImpl, no llega
          acá. Este branch corre solo en list mode. */}
      {restActions.length > 0 && gameId && (
        <div className="hidden xl:flex items-center gap-1 shrink-0">
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
      {/* Badge "+N acciones" SIEMPRE visible (incluso en pantallas
          estrechas donde escondimos los íconos de restActions). */}
      {actionCount > 1 && (
        <span
          className="xl:hidden self-center shrink-0 rounded bg-bg-base/60 px-2 py-0.5 text-[10px] text-fg-muted whitespace-nowrap"
          title={`${actionCount} acciones totales`}
        >
          +{actionCount - 1}
        </span>
      )}

      {/* Nombre + meta — nombre en su propia línea (truncate full width)
          y badges en línea separada para no sobreponerse con la toolbar.
          Si rule.name es vacío o el placeholder "Sin nombre" del seed,
          derivamos un nombre legible del trigger + acción para que la
          UI no muestre "Sin nombre" en lote. */}
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
        <p className={`${tokens.title} font-medium truncate`}>
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
          sobreponerse con el nombre/badges del centro). `ml-auto` lo
          ancla a la derecha incluso si flex-wrap lo bajó a la 2da fila
          (caso de pantallas estrechas con muchas acciones). */}
      <div
        className="flex items-center gap-0.5 self-center ml-auto rounded-md bg-bg-elev/40 px-0.5 py-0.5 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity"
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

/**
 * Memoizado por shallow-compare de props. Re-renderiza solo si cambia
 * la regla, gameId, selected o busy. Optimización clave cuando hay
 * muchas reglas y llegan eventos del live.
 */
export const RuleListItem = memo(RuleListItemImpl);
RuleListItem.displayName = 'RuleListItem';

// ── RuleGridCard (v1.1.5) ─────────────────────────────────────────────
//
// Variante cuadrada para layout='grid'. Layout vertical:
//   ┌──────────────┐
//   │  [trigger]   │  ← imagen del gift/trigger arriba (centrada)
//   │  ─→ [acción] │  ← flecha + imagen acción
//   │  Nombre      │  ← name de la regla (truncate 2 líneas)
//   │  ⚡▶✏︎🗑️    │  ← toolbar compacta al pie
//   └──────────────┘
// La card es responsive: en density='compact' es más chica, en 'large'
// más grande. El grid container en RulesTab define las columnas.

interface RuleGridCardProps {
  rule: Rule;
  gameId: GameId | null;
  giftIcons: Map<string, string>;
  giftCoins: Map<string, number>;
  nameToCommand: Map<string, string>;
  selected: boolean;
  density: RuleDensity;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  onSelect?: (id: string) => void;
  onQuickChangeGift?: (id: string) => void;
  onQuickChangeAction?: (id: string, actionIndex: number) => void;
  busy: boolean;
}

// Tamaños de imagen y fuente según density en grid mode.
const GRID_TOKENS: Record<RuleDensity, {
  img: number;
  pad: 'p-2' | 'p-3' | 'p-4';
  title: 'text-[11px]' | 'text-xs' | 'text-sm';
  meta: 'text-[9px]' | 'text-[10px]';
}> = {
  compact: { img: 44, pad: 'p-2', title: 'text-[11px]', meta: 'text-[9px]' },
  normal: { img: 64, pad: 'p-3', title: 'text-xs', meta: 'text-[10px]' },
  large: { img: 80, pad: 'p-3', title: 'text-sm', meta: 'text-[10px]' },
};

function RuleGridCardImpl({
  rule,
  gameId,
  giftIcons,
  giftCoins,
  nameToCommand,
  selected,
  density,
  onToggle,
  onEdit,
  onDuplicate,
  onDelete,
  onTest,
  onSelect,
  onQuickChangeGift,
  onQuickChangeAction,
  busy,
}: RuleGridCardProps) {
  const meta = triggerMeta(rule.trigger_type);
  const actionCount = rule.actions.length;
  const tts = rule.tts_enabled;
  const t = GRID_TOKENS[density];

  const isGift = rule.trigger_type === 'gift';
  const tv = (rule.trigger_value ?? '').trim();
  const giftIconPath = isGift
    ? giftIcons.get(tv) ?? giftIcons.get(tv.toLowerCase()) ?? null
    : null;
  const giftFile = giftIconPath?.startsWith('donaciones/')
    ? giftIconPath.slice('donaciones/'.length)
    : giftIconPath ?? null;
  const giftCost = isGift
    ? giftCoins.get(tv) ?? giftCoins.get(tv.toLowerCase()) ?? null
    : null;

  const firstAction = rule.actions[0];
  const firstFolder = firstAction ? actionFolder(firstAction.action_type) : '';
  const firstFile = firstAction
    ? resolveActionFile(firstAction.action_value, firstFolder, nameToCommand)
    : null;

  return (
    <div
      role="listitem"
      onClick={() => onSelect?.(rule.id)}
      className={[
        'group relative flex flex-col rounded-lg border cursor-pointer transition-all overflow-hidden',
        // v1.1.6: aspect-square (1:1) — el user pidió específicamente
        // CUADRADOS. Con 3 secciones (top bar / imágenes en row / footer)
        // el contenido entra cómodo en 1:1.
        'aspect-square',
        t.pad,
        selected
          ? 'border-accent bg-accent/10 ring-1 ring-accent/30'
          : 'border-border bg-bg-elev/40 hover:border-fg-muted hover:bg-bg-elev',
        !rule.enabled && 'opacity-60',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* TOP ROW — switch izquierda + badges derecha */}
      <div className="flex justify-between items-start gap-1 min-w-0">
        <div onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={rule.enabled}
            onChange={(v) => onToggle(rule.id, v)}
            disabled={busy}
            size="sm"
          />
        </div>
        <div className="flex flex-col gap-0.5 items-end shrink-0">
          {giftCost ? (
            <span className="inline-flex items-center gap-0.5 rounded bg-warning/20 px-1.5 py-0.5 text-[9px] font-semibold text-warning whitespace-nowrap">
              💎{giftCost}
            </span>
          ) : null}
          {actionCount > 1 && (
            <Badge
              variant="default"
              className="!text-[9px] !px-1 !py-0 !leading-tight whitespace-nowrap"
            >
              {actionCount} acc.
            </Badge>
          )}
        </div>
      </div>

      {/* CENTER — trigger image + → + action image en HORIZONTAL.
          flex-1 + min-h-0 = ocupa todo el espacio disponible. */}
      <div className="flex-1 flex items-center justify-center gap-1.5 min-h-0 my-1.5 min-w-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (isGift && onQuickChangeGift) onQuickChangeGift(rule.id);
            else onEdit(rule.id);
          }}
          disabled={busy}
          title={isGift ? 'Click para cambiar la donación' : 'Click para editar el trigger'}
          className="rounded-md transition-transform hover:scale-105 cursor-pointer disabled:cursor-not-allowed shrink-0"
        >
          {isGift && giftFile ? (
            <MaruImage
              scope="donaciones"
              path={giftFile}
              size={t.img}
              fallback="🎁"
              className="rounded-md drop-shadow"
              alt={`Regalo: ${rule.trigger_value}`}
            />
          ) : TRIGGER_FILE_BY_TYPE[rule.trigger_type] ? (
            <MaruImage
              scope="triggers"
              path={TRIGGER_FILE_BY_TYPE[rule.trigger_type] as string}
              size={t.img}
              fallback={meta.emoji}
              className="rounded-md drop-shadow"
              alt={meta.label}
            />
          ) : (
            <div
              className={`flex items-center justify-center rounded-md bg-bg-base/60 ${meta.color}`}
              style={{ width: t.img, height: t.img, fontSize: Math.floor(t.img * 0.5) }}
            >
              {meta.emoji}
            </div>
          )}
        </button>

        {firstAction && gameId && (
          <>
            <ArrowRight className="text-fg-subtle h-4 w-4 shrink-0" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (onQuickChangeAction) onQuickChangeAction(rule.id, 0);
                else onEdit(rule.id);
              }}
              disabled={busy}
              title="Click para cambiar la acción"
              className="rounded-md transition-transform hover:scale-105 cursor-pointer disabled:cursor-not-allowed shrink-0"
            >
              {firstFile ? (
                <MaruImage
                  scope="game"
                  path={`${gameId}/${firstFolder}/${firstFile}.png`}
                  size={t.img}
                  fallback="⚙️"
                  className="rounded-md"
                  alt={firstAction.action_value}
                />
              ) : (
                <div
                  className="flex items-center justify-center rounded-md bg-bg-base/60 text-fg-subtle"
                  style={{
                    width: t.img,
                    height: t.img,
                    fontSize: Math.floor(t.img * 0.5),
                  }}
                >
                  ⚙️
                </div>
              )}
            </button>
          </>
        )}
      </div>

      {/* FOOTER — minimalista: solo nombre + 2 botones esenciales.
          v1.1.6 (post-feedback): user pidió "que se vean bonitos los
          cuadrados, podés omitir información si es necesario". Quité
          meta badges (cooldown/tts/shuffle/action_value), Duplicar y
          Eliminar (esos quedan en list mode o al editar la regla). */}
      <div className="flex flex-col gap-0.5 min-w-0">
        <p className={`${t.title} font-medium truncate text-center`} title={rule.name}>
          {rule.name && rule.name !== 'Sin nombre' ? rule.name : (
            <span className="text-fg-subtle italic">Sin nombre</span>
          )}
        </p>
        <div
          className="flex items-center justify-center gap-1 mt-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onTest(rule.id)}
            disabled={busy}
            title="Probar"
            className="!px-2 !h-6"
          >
            <Play className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(rule.id)}
            disabled={busy}
            title="Editar"
            className="!px-2 !h-6"
          >
            <Edit3 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
