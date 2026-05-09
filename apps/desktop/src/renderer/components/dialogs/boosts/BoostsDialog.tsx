/**
 * `BoostsDialog` (v1.0.55) — panel EXTERNO de multiplicadores acumulables.
 *
 * Rediseño visual: cards con gradientes por target kind, imágenes
 * reales (donación + acción) en el multi-select de reglas, empty state
 * premium, badges visuales por target.
 *
 * Acumulación multiplicativa: una regla puede recibir N boosts y los
 * factores se MULTIPLICAN, topados en x100. Wire al engine via
 * monkey-patch del `_role_multiplier` (ver `rule_dispatcher.py`).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Save,
  Check,
  Sparkles,
  Search,
  Crown,
  Shield,
  Heart,
  Star,
  Gem,
  User,
  Zap,
} from 'lucide-react';
import {
  Button,
  Dialog,
  Input,
  Label,
  Switch,
  MaruImage,
} from '@maru/ui';
import type {
  GameId,
  Rule,
  RuleBoost,
  RuleBoostKind,
  RuleBoostTarget,
} from '@maru/shared';
import { useAppStore } from '../../../lib/store/index.js';
import { useRules } from '../../../lib/use-rules.js';
import { useGifts } from '../../../lib/use-gifts.js';
import { rpcCall } from '../../../lib/rpc.js';

const ACTION_TYPE_TO_FOLDER: Record<string, string> = {
  spawn: 'entities',
  give_item: 'items',
  trigger_event: 'events',
  spawn_valuable: 'valuables',
  entity: 'entities',
  item: 'items',
  event: 'events',
  valuable: 'valuables',
  entities: 'entities',
  items: 'items',
  events: 'events',
  valuables: 'valuables',
};

interface KindMeta {
  id: RuleBoostKind;
  label: string;
  desc: string;
  icon: typeof Crown;
  /** Color HEX para borde + glow del card cuando ese boost está activo. */
  hex: string;
}

const KIND_META: KindMeta[] = [
  { id: 'super_fan', label: 'Super Fan', desc: 'Suscriptor activo', icon: Crown, hex: '#ffc83d' },
  { id: 'mod', label: 'Moderador', desc: 'Mod del live', icon: Shield, hex: '#5cd0ff' },
  { id: 'follower', label: 'Seguidor', desc: 'Follower del canal', icon: Heart, hex: '#ff6cb5' },
  { id: 'member', label: 'Miembro', desc: 'Rango de niveles', icon: Star, hex: '#6ce687' },
  { id: 'donor', label: 'Donador', desc: 'Gifter level rango', icon: Gem, hex: '#ff9f4d' },
  { id: 'user', label: 'Usuario', desc: '@username específico', icon: User, hex: '#a78bfa' },
];

function metaFor(kind: RuleBoostKind): KindMeta {
  return KIND_META.find((k) => k.id === kind) ?? KIND_META[0]!;
}

function emptyBoost(): RuleBoost {
  return {
    id: '',
    name: '',
    enabled: true,
    factor: 2,
    target: { kind: 'super_fan' },
    rule_ids: ['all'],
  };
}

// ── Dialog ─────────────────────────────────────────────────────────────

export function BoostsDialog() {
  const open = useAppStore((s) => s.modalStack.some((f) => f.id === 'boosts'));
  const closeModal = useAppStore((s) => s.closeModal);
  const selectedGameId = useAppStore((s) => s.selectedGameId);
  const rules = useRules(selectedGameId as GameId | null, { autoLoad: open });

  const [boosts, setBoosts] = useState<RuleBoost[]>([]);
  // `loaded` evita el flash "no hay boosts" al cambiar de perfil:
  // antes setBoosts([]) ejecutaba ANTES del fetch async → render con
  // EmptyState durante 1 frame y luego rehidrataba con los boosts reales.
  // Ahora solo mostramos EmptyState cuando el fetch terminó realmente.
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<RuleBoost | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mapa "<folder>::<displayName>" + "<displayName>" → command, igual
  // que RulesTab. Sin esto el `action_value` ("🐗 Jabalí") no resuelve
  // a "Boar.png" y el selector cae al default por entidades/items/events.
  const [nameToCommand, setNameToCommand] = useState<Map<string, string>>(
    () => new Map(),
  );
  useEffect(() => {
    if (!open || !selectedGameId) {
      setNameToCommand(new Map());
      return;
    }
    let aborted = false;
    void rpcCall('data.all-categories', { gameId: selectedGameId as GameId })
      .then((res) => {
        if (aborted) return;
        const m = new Map<string, string>();
        const cats = (
          res as { categories: Record<string, { entries: Array<{ name: string; command: string }> }> }
        ).categories || {};
        for (const [folder, cat] of Object.entries(cats)) {
          for (const e of cat.entries || []) {
            if (!e || !e.name || !e.command) continue;
            m.set(`${folder}::${e.name}`, e.command);
            if (!m.has(e.name)) m.set(e.name, e.command);
          }
        }
        setNameToCommand(m);
      })
      .catch(() => undefined);
    return () => {
      aborted = true;
    };
  }, [open, selectedGameId]);

  // v1.0.70: los boosts viven en archivos POR JUEGO
  // (`rule_boosts_<gameId>.json`). Cuando el user cambia de juego, la
  // lista del dialog DEBE refrescarse para mostrar SOLO los del juego
  // activo. Antes el dialog usaba un único archivo global → al cambiar
  // de juego seguían apareciendo los boosts del juego anterior.
  useEffect(() => {
    if (!open) {
      setEditing(null);
      setError(null);
      setBoosts([]);
      setLoaded(false);
      return;
    }
    if (!selectedGameId) {
      setBoosts([]);
      setLoaded(true); // sin gameId no hay nada que cargar — banner amber se muestra
      return;
    }
    // No resetear boosts a [] aún: mostrar lista anterior con loaded=false
    // hasta que llegue el nuevo fetch. EmptyState solo aparece cuando
    // realmente terminó la carga (ver render).
    setLoaded(false);
    void rpcCall('boosts.list', { gameId: selectedGameId })
      .then((r) => {
        setBoosts(r.boosts);
        setLoaded(true);
      })
      .catch((ex) => {
        setError(ex instanceof Error ? ex.message : String(ex));
        setLoaded(true);
      });
  }, [open, selectedGameId]);

  if (!open) return null;

  async function reload() {
    if (!selectedGameId) {
      setBoosts([]);
      return;
    }
    try {
      const r = await rpcCall('boosts.list', { gameId: selectedGameId });
      setBoosts(r.boosts);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    }
  }

  async function handleDelete(id: string) {
    if (!selectedGameId) return;
    setBusy(true);
    try {
      await rpcCall('boosts.delete', { id, gameId: selectedGameId });
      await reload();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(b: RuleBoost) {
    if (!selectedGameId) return;
    setBusy(true);
    try {
      await rpcCall('boosts.upsert', {
        gameId: selectedGameId,
        boost: { ...b, enabled: !b.enabled },
      });
      await reload();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEditing() {
    if (!editing) return;
    if (!selectedGameId) {
      setError('No hay juego activo seleccionado');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await rpcCall('boosts.upsert', {
        gameId: selectedGameId,
        boost: editing,
      });
      await reload();
      setEditing(null);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }

  const activeCount = boosts.filter((b) => b.enabled).length;

  return (
    <Dialog
      open
      onClose={() => !busy && closeModal()}
      size="xl"
      title="🚀 Multiplicadores de Reglas"
      description="Aplicá factor x2/x3/x4 a un grupo de reglas según el rol del user que las dispare. Acumulables (factor·factor·factor con techo x100)."
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            ⚠ {error}
          </div>
        )}

        {/* Stats header */}
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-accent/20 bg-gradient-to-br from-accent/10 via-accent/5 to-transparent px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent/20 text-accent shadow-inner">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">
                {activeCount} activo{activeCount === 1 ? '' : 's'}
                <span className="text-fg-subtle"> · {boosts.length} total</span>
              </p>
              <p className="text-[11px] text-fg-subtle leading-tight">
                Cada evento consulta los boosts y multiplica el factor
                según el rol del user.
              </p>
            </div>
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={() => setEditing(emptyBoost())}
            disabled={busy}
          >
            <Plus className="h-4 w-4" />
            Nuevo boost
          </Button>
        </div>

        {!selectedGameId && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Seleccioná un juego en el sidebar para ver la lista de
            reglas con sus imágenes en el editor de boosts.
          </div>
        )}

        {/* Lista de boosts */}
        {!loaded ? (
          // Skeleton sutil mientras carga — evita flash de EmptyState
          // al cambiar de perfil con boosts pendientes.
          <div className="grid gap-2.5 grid-cols-1 lg:grid-cols-2">
            <div className="h-20 rounded-2xl border border-border/40 bg-bg-elev/20 animate-pulse" />
            <div className="h-20 rounded-2xl border border-border/40 bg-bg-elev/20 animate-pulse" />
          </div>
        ) : boosts.length === 0 ? (
          <EmptyState onCreate={() => setEditing(emptyBoost())} />
        ) : (
          <div className="grid gap-2.5 grid-cols-1 lg:grid-cols-2">
            {boosts.map((b) => (
              <BoostCard
                key={b.id}
                boost={b}
                rules={rules.allRules}
                onToggle={() => void handleToggle(b)}
                onEdit={() => setEditing(b)}
                onDelete={() => void handleDelete(b.id)}
                disabled={busy}
              />
            ))}
          </div>
        )}

        {/* Editor inline */}
        {editing && (
          <BoostEditor
            boost={editing}
            rules={rules.allRules}
            gameId={selectedGameId as GameId | null}
            nameToCommand={nameToCommand}
            onChange={setEditing}
            onCancel={() => setEditing(null)}
            onSave={() => void handleSaveEditing()}
            busy={busy}
          />
        )}
      </div>
    </Dialog>
  );
}

// ── Empty State ─────────────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-bg-elev/20 px-6 py-10 text-center">
      <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-accent/15 text-accent">
        <Sparkles className="h-7 w-7" />
      </div>
      <h3 className="text-sm font-semibold">Sin boosts configurados</h3>
      <p className="mx-auto mt-1 max-w-md text-[12px] text-fg-muted leading-relaxed">
        Creá tu primer boost para que las reglas se ejecuten N veces
        cuando un super fan, mod, o user específico las dispare.
        Ejemplos: "x3 super fans a TODAS", "x4 a miembros nivel 40-50".
      </p>
      <Button variant="primary" size="md" onClick={onCreate} className="mt-4">
        <Plus className="h-4 w-4" />
        Crear primer boost
      </Button>
    </div>
  );
}

// ── Card ────────────────────────────────────────────────────────────────

function BoostCard({
  boost,
  rules,
  onToggle,
  onEdit,
  onDelete,
  disabled,
}: {
  boost: RuleBoost;
  rules: Rule[];
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const meta = metaFor(boost.target.kind);
  const Icon = meta.icon;
  const targetLine = describeTarget(boost.target);
  const ruleSummary = useMemo(() => {
    if (boost.rule_ids.includes('all')) {
      return { label: 'TODAS las reglas', count: rules.length };
    }
    const matched = rules.filter((r) => boost.rule_ids.includes(r.id));
    return { label: `${matched.length} regla${matched.length === 1 ? '' : 's'}`, count: matched.length };
  }, [boost.rule_ids, rules]);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border transition-all"
      style={{
        borderColor: boost.enabled ? `${meta.hex}55` : 'rgb(var(--maru-border))',
        background: boost.enabled
          ? `linear-gradient(135deg, ${meta.hex}15 0%, ${meta.hex}05 60%, transparent 100%)`
          : 'rgb(var(--maru-bg-elev) / 0.3)',
        opacity: boost.enabled ? 1 : 0.55,
      }}
    >
      {/* Glow strip a la izquierda con el color del kind */}
      <div
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ background: meta.hex, opacity: boost.enabled ? 0.8 : 0.3 }}
      />

      <div className="flex items-stretch gap-3 pl-4 pr-3 py-3">
        {/* Icon big con factor */}
        <div className="flex flex-col items-center justify-center gap-1.5 shrink-0">
          <div
            className="grid h-12 w-12 place-items-center rounded-xl"
            style={{
              background: `${meta.hex}22`,
              border: `1px solid ${meta.hex}55`,
              color: meta.hex,
            }}
          >
            <Icon className="h-6 w-6" />
          </div>
          <span
            className="rounded-md px-2 py-0.5 text-[12px] font-extrabold tracking-tight"
            style={{
              background: `${meta.hex}30`,
              color: meta.hex,
              textShadow: `0 0 8px ${meta.hex}50`,
            }}
          >
            x{boost.factor}
          </span>
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
          <p className="text-[13px] font-semibold truncate" title={boost.name}>
            {boost.name || <span className="text-fg-subtle italic">(sin nombre)</span>}
          </p>
          <p className="text-[11px] text-fg-muted truncate" title={targetLine}>
            {targetLine}
          </p>
          <div className="flex items-center gap-1.5 text-[10px] text-fg-subtle">
            <span
              className="inline-flex items-center gap-1 rounded-md border border-border bg-bg-base/40 px-1.5 py-0.5"
              title={ruleSummary.label}
            >
              🎯 {ruleSummary.label}
            </span>
            {!boost.enabled && (
              <span className="inline-flex items-center rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-300">
                Desactivado
              </span>
            )}
          </div>
        </div>

        {/* Acciones */}
        <div className="flex flex-col items-end justify-between gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onToggle}
            disabled={disabled}
            className={[
              'grid h-7 w-7 place-items-center rounded-full border transition-all',
              boost.enabled
                ? 'text-bg shadow-md'
                : 'border-border text-fg-muted',
            ].join(' ')}
            style={
              boost.enabled
                ? { background: meta.hex, borderColor: meta.hex }
                : undefined
            }
            title={boost.enabled ? 'Desactivar' : 'Activar'}
          >
            <Check className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="sm" onClick={onEdit} disabled={disabled} title="Editar">
              Editar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              disabled={disabled}
              title="Eliminar boost"
            >
              <Trash2 className="h-3.5 w-3.5 text-red-400" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function describeTarget(t: RuleBoostTarget): string {
  switch (t.kind) {
    case 'super_fan':
      return 'Aplicado cuando el user es Super Fan';
    case 'mod':
      return 'Aplicado cuando el user es Moderador';
    case 'follower':
      return 'Aplicado cuando el user te sigue';
    case 'member':
      return `Miembros nivel ${t.level_min ?? 1}-${t.level_max ?? 50}`;
    case 'donor':
      return `Donadores nivel ${t.level_min ?? 1}-${t.level_max ?? 50}`;
    case 'user':
      return `Solo @${t.username || ''}`;
    default:
      return '';
  }
}

// ── Editor ──────────────────────────────────────────────────────────────

function BoostEditor({
  boost,
  rules,
  gameId,
  nameToCommand,
  onChange,
  onCancel,
  onSave,
  busy,
}: {
  boost: RuleBoost;
  rules: Rule[];
  gameId: GameId | null;
  nameToCommand: Map<string, string>;
  onChange: (b: RuleBoost) => void;
  onCancel: () => void;
  onSave: () => void;
  busy?: boolean;
}) {
  const [search, setSearch] = useState('');
  const updateTarget = (patch: Partial<RuleBoostTarget>) =>
    onChange({ ...boost, target: { ...boost.target, ...patch } });

  const allSelected = boost.rule_ids.includes('all');

  const toggleAll = () => {
    onChange({ ...boost, rule_ids: allSelected ? [] : ['all'] });
  };
  const toggleRule = (id: string) => {
    const next = new Set(boost.rule_ids.filter((x) => x !== 'all'));
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...boost, rule_ids: Array.from(next) });
  };

  const filteredRules = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return rules;
    return rules.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.trigger_value.toLowerCase().includes(q),
    );
  }, [search, rules]);

  const canSave =
    boost.name.trim().length > 0 &&
    boost.factor >= 1 &&
    boost.factor <= 100 &&
    (boost.target.kind !== 'user' || (boost.target.username || '').trim().length > 0) &&
    boost.rule_ids.length > 0;

  return (
    <div className="rounded-2xl border-2 border-accent/40 bg-bg-elev/40 p-4 space-y-4 shadow-lg">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" />
          {boost.id ? 'Editar boost' : 'Nuevo boost'}
        </h3>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onSave}
            disabled={!canSave || busy}
          >
            <Save className="h-3.5 w-3.5" />
            Guardar
          </Button>
        </div>
      </div>

      {/* Nombre + factor + enabled */}
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-7">
          <Label>Nombre</Label>
          <Input
            value={boost.name}
            onChange={(e) => onChange({ ...boost, name: e.target.value })}
            placeholder="Ej: Super fans x3"
            maxLength={80}
          />
        </div>
        <div className="col-span-3">
          <Label>Multiplicador</Label>
          <Input
            type="number"
            min={1}
            max={100}
            value={String(boost.factor)}
            onChange={(e) =>
              onChange({
                ...boost,
                factor: Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)),
              })
            }
            suffix="x"
          />
        </div>
        <div className="col-span-2 flex items-end">
          <Switch
            checked={boost.enabled}
            onChange={(v) => onChange({ ...boost, enabled: v })}
            label="Activo"
          />
        </div>
      </div>

      {/* Target */}
      <fieldset className="rounded-xl border border-border bg-bg-surface/30 p-3 space-y-3">
        <legend className="px-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
          Aplicar cuando el user es
        </legend>
        <div className="grid grid-cols-3 gap-2">
          {KIND_META.map((opt) => {
            const Icon = opt.icon;
            const selected = boost.target.kind === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => updateTarget({ kind: opt.id })}
                className="rounded-xl border px-3 py-2.5 text-left text-xs transition-all"
                style={{
                  borderColor: selected ? opt.hex : 'rgb(var(--maru-border))',
                  background: selected
                    ? `linear-gradient(135deg, ${opt.hex}25, ${opt.hex}08)`
                    : 'rgb(var(--maru-bg-elev) / 0.3)',
                  boxShadow: selected ? `0 0 0 1px ${opt.hex}80 inset` : undefined,
                }}
              >
                <div className="flex items-center gap-2">
                  <Icon
                    className="h-4 w-4 shrink-0"
                    style={{ color: opt.hex }}
                  />
                  <span className="font-semibold text-fg">{opt.label}</span>
                </div>
                <div className="mt-0.5 text-[10px] text-fg-subtle">{opt.desc}</div>
              </button>
            );
          })}
        </div>

        {(boost.target.kind === 'member' || boost.target.kind === 'donor') && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <Label>Nivel mínimo</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={String(boost.target.level_min ?? 1)}
                onChange={(e) =>
                  updateTarget({
                    level_min: Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1)),
                  })
                }
              />
            </div>
            <div>
              <Label>Nivel máximo</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={String(boost.target.level_max ?? 50)}
                onChange={(e) =>
                  updateTarget({
                    level_max: Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 50)),
                  })
                }
              />
            </div>
          </div>
        )}
        {boost.target.kind === 'user' && (
          <div className="pt-1">
            <Label>@username</Label>
            <Input
              value={boost.target.username || ''}
              onChange={(e) =>
                updateTarget({ username: e.target.value.replace(/^@/, '').toLowerCase() })
              }
              placeholder="ej: cristian_rivasxd"
              prefix="@"
            />
            <p className="mt-1 text-[10px] text-fg-subtle">
              Sin @ — el sistema lo agrega automáticamente.
            </p>
          </div>
        )}
      </fieldset>

      {/* Reglas afectadas — con imágenes reales */}
      <fieldset className="rounded-xl border border-border bg-bg-surface/30 p-3 space-y-3">
        <legend className="px-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
          Reglas afectadas
          {' · '}
          <span className="text-accent">
            {allSelected ? 'TODAS' : `${boost.rule_ids.length} seleccionadas`}
          </span>
        </legend>

        <button
          type="button"
          onClick={toggleAll}
          className="w-full rounded-xl border px-3 py-2.5 text-left text-xs transition-all"
          style={{
            borderColor: allSelected ? 'rgb(var(--maru-accent))' : 'rgb(var(--maru-border))',
            background: allSelected
              ? 'rgb(var(--maru-accent) / 0.15)'
              : 'rgb(var(--maru-bg-elev) / 0.3)',
          }}
        >
          <span className="font-semibold flex items-center gap-2">
            <span className="text-base">🌐</span>
            <span>Aplicar a TODAS las reglas del juego</span>
            {allSelected && (
              <Check className="ml-auto h-4 w-4 text-accent" />
            )}
          </span>
          <div className="mt-1 text-[10px] text-fg-subtle">
            Se incluyen las reglas nuevas que crees en el futuro
            automáticamente.
          </div>
        </button>

        {!allSelected && (
          <>
            <Input
              prefix={<Search className="h-3.5 w-3.5" />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar regla por nombre o donación…"
              className="text-xs"
            />
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-bg-surface/40">
              {filteredRules.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-fg-subtle">
                  {rules.length === 0
                    ? 'Sin reglas en el juego activo. Cambiá de juego o creá reglas primero.'
                    : 'Sin resultados para esa búsqueda.'}
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {filteredRules.map((r) => (
                    <RuleSelectorRow
                      key={r.id}
                      rule={r}
                      gameId={gameId}
                      nameToCommand={nameToCommand}
                      checked={boost.rule_ids.includes(r.id)}
                      onToggle={() => toggleRule(r.id)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </fieldset>
    </div>
  );
}

// ── Rule selector row con IMÁGENES REALES ──────────────────────────────

function RuleSelectorRow({
  rule,
  gameId,
  nameToCommand,
  checked,
  onToggle,
}: {
  rule: Rule;
  gameId: GameId | null;
  nameToCommand: Map<string, string>;
  checked: boolean;
  onToggle: () => void;
}) {
  // Imágenes de gift de la regla (si trigger es gift).
  const { allGifts } = useGifts({ autoLoad: true });
  const giftFile = useMemo(() => {
    if (rule.trigger_type !== 'gift') return null;
    const tv = (rule.trigger_value || '').toLowerCase().trim();
    const g = allGifts.find(
      (gg) =>
        gg.id === rule.trigger_value ||
        gg.id.toLowerCase().trim() === tv ||
        gg.name?.toLowerCase().trim() === tv,
    );
    if (!g?.iconPath) return null;
    return g.iconPath.startsWith('donaciones/')
      ? g.iconPath.slice('donaciones/'.length)
      : g.iconPath;
  }, [rule.trigger_type, rule.trigger_value, allGifts]);

  // Primera acción (preview) — resolver con nameToCommand igual que
  // RuleListItem para que "🐗 Jabalí" se mapee a "Boar.png" real.
  const firstAction = rule.actions[0];
  const actionFolder = firstAction
    ? ACTION_TYPE_TO_FOLDER[firstAction.action_type] ?? firstAction.action_type
    : '';
  const actionFile = firstAction?.action_value
    ? resolveActionFile(firstAction.action_value, actionFolder, nameToCommand)
    : null;

  const triggerEmoji = TRIGGER_EMOJI[rule.trigger_type] ?? '⚙️';

  return (
    <li>
      <label
        className={[
          'flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors',
          checked
            ? 'bg-accent/10 hover:bg-accent/15'
            : 'hover:bg-bg-elev/40',
        ].join(' ')}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-4 w-4 accent-accent shrink-0"
        />

        {/* Donación o imagen default del trigger */}
        <div className="shrink-0">
          {giftFile ? (
            <MaruImage
              scope="donaciones"
              path={giftFile}
              size={32}
              fallback="🎁"
              className="rounded"
              alt={rule.trigger_value}
            />
          ) : TRIGGER_FILE_BY_TYPE[rule.trigger_type] ? (
            <MaruImage
              scope="triggers"
              path={TRIGGER_FILE_BY_TYPE[rule.trigger_type]}
              size={32}
              fallback={triggerEmoji}
              className="rounded"
              alt={rule.trigger_type}
            />
          ) : (
            <div className="grid h-8 w-8 place-items-center rounded bg-bg-base/60 text-lg">
              {triggerEmoji}
            </div>
          )}
        </div>

        {/* Acción */}
        <div className="shrink-0 text-fg-subtle">→</div>
        <div className="shrink-0">
          {firstAction && gameId && actionFile ? (
            <MaruImage
              scope="game"
              path={`${gameId}/${actionFolder}/${actionFile}.png`}
              size={32}
              fallback={{
                scope: 'game',
                path: `${gameId}/${actionFolder}/_default_${actionFolder}.png`,
              }}
              className="rounded opacity-90"
              alt={firstAction.action_value}
            />
          ) : firstAction && gameId ? (
            <MaruImage
              scope="game"
              path={`${gameId}/${actionFolder}/_default_${actionFolder}.png`}
              size={32}
              fallback="⚙️"
              className="rounded opacity-70"
              alt={firstAction.action_value}
            />
          ) : (
            <div className="grid h-8 w-8 place-items-center rounded bg-bg-base/60 text-fg-subtle">
              ⚙️
            </div>
          )}
        </div>

        {/* Texto */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{rule.name || '(sin nombre)'}</p>
          <p className="text-[10px] text-fg-subtle truncate">
            {rule.trigger_type}
            {rule.trigger_value && ` · ${rule.trigger_value}`}
            {rule.actions.length > 1 && ` · +${rule.actions.length - 1} acción${rule.actions.length > 2 ? 'es' : ''}`}
          </p>
        </div>

        {!rule.enabled && (
          <span className="shrink-0 rounded bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[9px] text-amber-300">
            off
          </span>
        )}
      </label>
    </li>
  );
}

const TRIGGER_EMOJI: Record<string, string> = {
  gift: '🎁',
  command: '💬',
  follow: '➕',
  share: '📤',
  like: '❤️',
  like_milestone: '🏆',
  subscribe: '⭐',
  emote: '😀',
  join: '👋',
};

/** Mapa trigger_type → PNG default. Sincronizar con
 *  `RuleListItem.tsx:TRIGGER_FILE_BY_TYPE` y los archivos en
 *  `resources/data/icons_triggers/`. */
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

/** Resuelve display name → command file usando el map del juego.
 *  MARU guarda `action_value` con emoji ("🐗 Jabalí") pero las
 *  imágenes están guardadas por command name ("Boar.png"). El map
 *  viene de `data.all-categories` y mapea ambos formatos. Si el
 *  display name no matchea pero ya parece un command (sin emoji),
 *  se retorna tal cual. */
function resolveActionFile(
  actionValue: string,
  folder: string,
  nameToCommand: Map<string, string>,
): string | null {
  const v = (actionValue ?? '').trim();
  if (!v) return null;
  const cmd = nameToCommand.get(`${folder}::${v}`) ?? nameToCommand.get(v);
  if (cmd) return cmd;
  if (/^[A-Za-z0-9_\-]+$/.test(v)) return v;
  return null;
}
