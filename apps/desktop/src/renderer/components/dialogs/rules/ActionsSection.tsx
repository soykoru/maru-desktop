import { useEffect, useId, useState } from 'react';
import {
  Edit3,
  Gamepad2,
  ImageIcon,
  Keyboard as KeyboardIcon,
  Loader2,
  Play,
  Plus,
  Shuffle,
  Trash2,
} from 'lucide-react';
import {
  Button,
  Input,
  Label,
  Select,
  Switch,
  TextArea,
} from '@maru/ui';
import type {
  GameId,
  GameProfile,
  RuleAction,
} from '@maru/shared';
import { rpcCall } from '../../../lib/rpc.js';
import {
  KeyboardActionEditor,
  emptyKeyboardDraft,
  parseKeyboardCommands,
  serializeKeyboardDraft,
  type KeyboardActionDraft,
} from './KeyboardActionEditor.js';

const KEYBOARD_ACTION_TYPE = 'keyboard';
const KEYBOARD_ACTION_TYPE_NAME = '⌨️ Tecla del teclado';

/**
 * `ActionsSection` — sección "⚡ Acciones" del RuleDialog.
 *
 * Réplica de la sección 7 del MARU original:
 *   - Lista de acciones añadidas (multi-acción).
 *   - Modo aleatorio (random_action).
 *   - Form de añadir nueva acción (tipo + valor + cantidad).
 *   - Botón galería visual → EntitySelectorDialog multi-select.
 *   - Botón test inline.
 *   - Sub-modal "Editar acción" (acá hacemos edit inline en el form).
 */
export interface ActionsSectionProps {
  gameId: GameId;
  profile: GameProfile | null;
  actions: RuleAction[];
  onChange: (next: RuleAction[]) => void;
  randomAction: boolean;
  onRandomChange: (v: boolean) => void;
  /** Callback para abrir EntitySelectorDialog multi. Recibe el resultado. */
  onOpenGallery?: () => void;
  disabled?: boolean;
}

interface CategoryOption {
  id: string;
  name: string;
}

function deriveCategoryOptions(profile: GameProfile | null): CategoryOption[] {
  if (!profile) return [];
  if (!profile.isStandard && profile.categories.length > 0) {
    return profile.categories.map((c) => ({ id: c.id, name: c.name }));
  }
  // Standard: derivar de hasEntities/hasItems/hasEvents.
  const out: CategoryOption[] = [];
  if (profile.hasEntities) {
    out.push({
      id: 'entities',
      name: profile.tabNames?.entities ?? '🐉 Entidad',
    });
  }
  if (profile.hasItems) {
    out.push({
      id: 'items',
      name: profile.tabNames?.items ?? '📦 Item',
    });
  }
  if (profile.hasEvents) {
    out.push({
      id: 'events',
      name: profile.tabNames?.events ?? '⚡ Evento',
    });
  }
  return out;
}

export function ActionsSection({
  gameId,
  profile,
  actions,
  onChange,
  randomAction,
  onRandomChange,
  onOpenGallery,
  disabled = false,
}: ActionsSectionProps) {
  const idPrefix = useId();
  const categoryOptions = deriveCategoryOptions(profile);
  const isMultiline =
    profile?.connectionType === 'rcon' || gameId === 'minecraft';

  // Form state — para "añadir acción".
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  // Modo del editor: 'game' usa el form clásico (entity/item/event),
  // 'keyboard' usa KeyboardActionEditor (action_type='keyboard').
  const [formMode, setFormMode] = useState<'game' | 'keyboard'>('game');
  const [actionType, setActionType] = useState<string>(
    categoryOptions[0]?.id ?? '',
  );
  const [valueOptions, setValueOptions] = useState<
    { name: string; command: string }[]
  >([]);
  const [valueLoading, setValueLoading] = useState(false);
  const [actionValue, setActionValue] = useState('');
  const [amount, setAmount] = useState(1);
  const [commands, setCommands] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] =
    useState<{ ok: boolean; message: string } | null>(null);
  const [keyboardDraft, setKeyboardDraft] =
    useState<KeyboardActionDraft>(emptyKeyboardDraft());

  // Toggle global keyboardActionsEnabled — leído al montar y refresh
  // cuando se activa desde el banner del editor.
  const [keyboardEnabled, setKeyboardEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    void rpcCall('settings.get', {})
      .then((r) => {
        if (!alive) return;
        const cfg = (r as { config?: { keyboardActionsEnabled?: boolean } }).config;
        setKeyboardEnabled(Boolean(cfg?.keyboardActionsEnabled));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  function activateKeyboardGlobally() {
    setKeyboardEnabled(true);
    void rpcCall('settings.set', {
      patch: { keyboardActionsEnabled: true },
    }).catch(() => undefined);
  }

  // Sync default actionType cuando cambia profile.
  useEffect(() => {
    const first = categoryOptions[0];
    if (!first) return;
    if (!categoryOptions.some((c) => c.id === actionType)) {
      setActionType(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, profile?.id]);

  // Cargar entries del kind activo para el combo de valor.
  useEffect(() => {
    if (!gameId || !actionType) {
      setValueOptions([]);
      return;
    }
    let alive = true;
    setValueLoading(true);
    void rpcCall('data.list', { gameId, kind: actionType })
      .then((res) => {
        if (!alive) return;
        setValueOptions(
          res.entries.map((e) => ({ name: e.name, command: e.command })),
        );
        if (!actionValue && res.entries[0]) {
          setActionValue(res.entries[0].name);
        }
      })
      .catch(() => {
        if (alive) setValueOptions([]);
      })
      .finally(() => {
        if (alive) setValueLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, actionType]);

  function resetForm() {
    setEditingIdx(null);
    setActionValue('');
    setAmount(1);
    setCommands('');
    setTestResult(null);
    setKeyboardDraft(emptyKeyboardDraft());
    if (categoryOptions[0]) setActionType(categoryOptions[0].id);
    // No reseteamos formMode — el user mantiene su selección.
  }

  function addOrUpdate() {
    let action: RuleAction;
    if (formMode === 'keyboard') {
      if (!keyboardDraft.keys.trim()) return;
      const ser = serializeKeyboardDraft(keyboardDraft);
      action = {
        action_type: KEYBOARD_ACTION_TYPE,
        action_type_name: KEYBOARD_ACTION_TYPE_NAME,
        action_value: ser.action_value,
        amount: ser.amount,
        commands: ser.commands,
      };
    } else {
      if (!actionType || !actionValue.trim()) return;
      const cat = categoryOptions.find((c) => c.id === actionType);
      action = {
        action_type: actionType,
        action_type_name: cat?.name ?? actionType,
        action_value: actionValue.trim(),
        amount: Math.max(1, Math.min(999_999, amount)),
        commands: commands.trim(),
      };
    }
    if (editingIdx !== null) {
      const next = actions.slice();
      next[editingIdx] = action;
      onChange(next);
    } else {
      onChange([...actions, action]);
    }
    resetForm();
  }

  function deleteAction(idx: number) {
    onChange(actions.filter((_, i) => i !== idx));
    if (editingIdx === idx) resetForm();
  }

  function startEdit(idx: number) {
    const a = actions[idx];
    if (!a) return;
    setEditingIdx(idx);
    setTestResult(null);
    if (a.action_type === KEYBOARD_ACTION_TYPE) {
      const parsed = parseKeyboardCommands(a.commands);
      setFormMode('keyboard');
      setKeyboardDraft({
        keys: a.action_value,
        mode: parsed.mode,
        holdMs: parsed.holdMs,
        repeat: Math.max(1, Math.min(50, a.amount || 1)),
        windowFilter: parsed.windowFilter,
      });
    } else {
      setFormMode('game');
      setActionType(a.action_type);
      setActionValue(a.action_value);
      setAmount(a.amount);
      setCommands(a.commands);
    }
  }

  async function runTest() {
    if (!gameId || !actionValue.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      let res: { ok: boolean; message: string };
      if (commands.trim()) {
        // Si hay commands explícitos (Minecraft RCON o juegos custom),
        // mandamos el bloque ENTERO al backend. El backend ya hace split
        // por '\n' y ejecuta cada línea (ver `MinecraftGame.execute_commands`
        // en core/games.py:580 — cl = cmds.strip().split('\n')).
        //
        // BUG raíz histórico: hasta v1.0.94 esta línea hacía
        //   `commands.split('\n')[0]?.trim()` truncando a la 1ra línea
        // → si el user metía un comando multi-línea (ej.
        //   "execute as soykoru run identity equip @s minecraft:wolf
        //    title @a actionbar [...] ha cambiado de entidad")
        // solo se ejecutaba el primero. Doble-click del DataDialog y
        // `rules.test` (RulesTab) sí mandaban el bloque entero — la
        // asimetría era confusa: en uno funcionaba, en otro no.
        res = await rpcCall('games.trigger-event', {
          gameId,
          event: commands.trim() || actionValue,
          user: 'TestUser',
        });
      } else if (actionType === 'items' || actionType === 'item') {
        const target = valueOptions.find((v) => v.name === actionValue);
        res = await rpcCall('games.give-item', {
          gameId,
          item: target?.command ?? actionValue,
          amount,
          user: 'TestUser',
        });
      } else if (actionType === 'events' || actionType === 'event') {
        const target = valueOptions.find((v) => v.name === actionValue);
        res = await rpcCall('games.trigger-event', {
          gameId,
          event: target?.command ?? actionValue,
          user: 'TestUser',
        });
      } else {
        const target = valueOptions.find((v) => v.name === actionValue);
        res = await rpcCall('games.spawn', {
          gameId,
          entity: target?.command ?? actionValue,
          amount,
          user: 'TestUser',
        });
      }
      setTestResult(res);
    } catch (ex) {
      setTestResult({
        ok: false,
        message: ex instanceof Error ? ex.message : String(ex),
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-3">
      <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
        ⚡ Acciones ({actions.length})
      </legend>

      {/* Lista */}
      {actions.length === 0 ? (
        <p className="text-xs text-fg-subtle italic px-2 py-3 text-center rounded-md border border-dashed border-border">
          Sin acciones todavía. Configurá una abajo.
        </p>
      ) : (
        <ul className="space-y-1">
          {actions.map((a, i) => (
            <li
              key={`${a.action_type}::${a.action_value}::${i}`}
              className={[
                'group flex items-center gap-2 rounded-md px-2 py-1.5 border',
                editingIdx === i
                  ? 'border-accent bg-accent/10'
                  : 'border-border bg-bg-elev',
              ].join(' ')}
            >
              <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle shrink-0 w-14 truncate">
                {a.action_type_name.replace(/^[\W]+/, '').slice(0, 8)}
              </span>
              <span className="text-sm flex-1 truncate" title={a.action_value}>
                {a.action_value || '(sin valor)'}
              </span>
              <span className="text-xs text-fg-muted">×{a.amount}</span>
              {a.commands && (
                <span
                  className="text-[10px] font-mono text-info shrink-0"
                  title={a.commands}
                >
                  📝
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => startEdit(i)}
                title="Editar"
                disabled={disabled}
              >
                <Edit3 className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => deleteAction(i)}
                title="Eliminar"
                disabled={disabled}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {actions.length > 1 && (
        <Switch
          checked={randomAction}
          onChange={onRandomChange}
          disabled={disabled}
          label="🎲 Modo aleatorio"
          description="Ejecuta UNA al azar en vez de TODAS."
        />
      )}

      {/* Form add/edit */}
      <div className="rounded-lg border border-border bg-bg-elev p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wider text-fg-subtle">
            {editingIdx !== null ? `Editando acción #${editingIdx + 1}` : 'Nueva acción'}
          </p>
          {/* Selector de modo: juego vs teclado. Permanece visible siempre
              para que el user pueda alternar al crear nuevas acciones. */}
          <div
            role="tablist"
            aria-label="Tipo de acción"
            className="inline-flex rounded-md border border-border bg-bg-base p-0.5 text-[11px]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={formMode === 'game'}
              onClick={() => {
                setFormMode('game');
                setTestResult(null);
              }}
              disabled={disabled}
              className={[
                'inline-flex items-center gap-1 rounded px-2 py-1 transition',
                formMode === 'game'
                  ? 'bg-accent text-on-accent shadow-sm'
                  : 'text-fg-muted hover:text-fg-base',
              ].join(' ')}
            >
              <Gamepad2 className="h-3 w-3" />
              Juego
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={formMode === 'keyboard'}
              onClick={() => {
                setFormMode('keyboard');
                setTestResult(null);
              }}
              disabled={disabled}
              className={[
                'inline-flex items-center gap-1 rounded px-2 py-1 transition',
                formMode === 'keyboard'
                  ? 'bg-accent text-on-accent shadow-sm'
                  : 'text-fg-muted hover:text-fg-base',
              ].join(' ')}
              title="Simular pulsación de teclado en el SO"
            >
              <KeyboardIcon className="h-3 w-3" />
              Teclado
            </button>
          </div>
        </div>

        {formMode === 'keyboard' ? (
          <KeyboardActionEditor
            draft={keyboardDraft}
            onChange={setKeyboardDraft}
            onSubmit={addOrUpdate}
            onCancel={editingIdx !== null ? resetForm : undefined}
            editingIdx={editingIdx}
            disabled={disabled}
            globallyEnabled={keyboardEnabled}
            onRequestEnable={activateKeyboardGlobally}
          />
        ) : categoryOptions.length === 0 ? (
          <p className="text-xs text-warning">
            El perfil no tiene categorías configuradas — agregalas en
            ManageGames → Custom Game.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_2fr_80px] gap-2">
              <div>
                <Label htmlFor={`${idPrefix}-type`}>Tipo</Label>
                <Select
                  id={`${idPrefix}-type`}
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value)}
                  disabled={disabled}
                >
                  {categoryOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor={`${idPrefix}-val`} required>
                  Valor
                </Label>
                <div className="flex gap-1">
                  <Select
                    id={`${idPrefix}-val`}
                    value={actionValue}
                    onChange={(e) => setActionValue(e.target.value)}
                    disabled={disabled || valueLoading}
                  >
                    <option value="">
                      {valueLoading ? 'Cargando…' : '-- seleccionar --'}
                    </option>
                    {valueOptions.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name}
                        {v.name !== v.command ? ` (${v.command})` : ''}
                      </option>
                    ))}
                  </Select>
                  {onOpenGallery && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={onOpenGallery}
                      disabled={disabled}
                      title="Galería visual con multi-select"
                    >
                      <ImageIcon className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              <div>
                <Label htmlFor={`${idPrefix}-amt`}>Cantidad</Label>
                <Input
                  id={`${idPrefix}-amt`}
                  type="number"
                  min={1}
                  max={999_999}
                  value={String(amount)}
                  onChange={(e) =>
                    setAmount(Math.max(1, parseInt(e.target.value, 10) || 1))
                  }
                  disabled={disabled}
                />
              </div>
            </div>

            {isMultiline && (
              <div>
                <Label htmlFor={`${idPrefix}-cmds`}>
                  Comandos RCON (opcional, uno por línea)
                </Label>
                <TextArea
                  id={`${idPrefix}-cmds`}
                  value={commands}
                  onChange={(e) => setCommands(e.target.value)}
                  placeholder={
                    'summon zombie ~ ~1 ~ {CustomName:\\"{username}\\"}\nVariables: {user}, {username}'
                  }
                  disabled={disabled}
                  className="font-mono text-xs min-h-[60px]"
                />
              </div>
            )}

            {testResult && (
              <div
                aria-live="polite"
                className={
                  'rounded-md px-3 py-1.5 text-xs ' +
                  (testResult.ok
                    ? 'border border-success/40 bg-success/10 text-success'
                    : 'border border-danger/40 bg-danger/10 text-danger')
                }
              >
                {testResult.message || (testResult.ok ? 'OK' : 'Fallo')}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void runTest()}
                disabled={disabled || testing || !actionValue.trim()}
                title="Probar acción contra el juego"
              >
                {testing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
                Probar
              </Button>

              <div className="flex gap-2">
                {editingIdx !== null && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={resetForm}
                    disabled={disabled}
                  >
                    Cancelar
                  </Button>
                )}
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={addOrUpdate}
                  disabled={disabled || !actionValue.trim()}
                >
                  {editingIdx !== null ? (
                    <>
                      <Edit3 className="h-3 w-3" /> Guardar
                    </>
                  ) : (
                    <>
                      <Plus className="h-3 w-3" /> Añadir
                    </>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {actions.length > 1 && randomAction && (
        <p className="flex items-center gap-1 text-[11px] text-warning">
          <Shuffle className="h-3 w-3" />
          Modo aleatorio activo: solo UNA de las {actions.length} acciones se ejecutará por trigger.
        </p>
      )}
    </fieldset>
  );
}
