import { useEffect, useMemo, useState } from 'react';
import { Button, Dialog } from '@maru/ui';
import type {
  GameId,
  RankFlag,
  Rule,
  RuleAction,
  RuleInput,
  RuleTriggerType,
} from '@maru/shared';
import { useAppStore } from '../../../lib/store/index.js';
import { useGames } from '../../../lib/use-games.js';
import { useRules } from '../../../lib/use-rules.js';
import type { MultiSelection } from '../data/index.js';
import { ActionsSection } from './ActionsSection.js';
import { CooldownTtsSection } from './CooldownTtsSection.js';
import { RolesSection } from './RolesSection.js';
import { TriggerSection } from './TriggerSection.js';

/**
 * `RuleDialog` — modal de creación / edición de regla.
 *
 * Réplica de `rule_dialog.py:RuleDialog` (1259 líneas) integrado en
 * 3 secciones colapsables verticalmente:
 *   1. TriggerSection — info + trigger + paneles condicionales.
 *   2. ActionsSection — multi-acción + galería + test.
 *   3. CooldownTtsSection — cooldown, TTS, allowed users.
 *
 * Mejoras vs original:
 *   - Sin sub-modal "editar acción": el form de ActionsSection hace
 *     doble duty (crear / editar inline) — menos clicks.
 *   - Validación inline: botón Guardar deshabilitado si nombre vacío,
 *     trigger value requerido para gift/like/milestone/command, o no
 *     hay al menos 1 acción.
 *   - Galería visual reusa `EntitySelectorDialog` (G5) con multi-select.
 */
export interface RuleDialogProps {
  open: boolean;
  onClose: () => void;
  gameId: GameId;
  /** Si presente → editar; si null → crear. */
  ruleId?: string | null;
}

/** v1.0.49: multiplicador opcional por rol/nivel del user. */
export type RepeatRank = 'mod' | 'superfan' | 'donor' | 'follower' | 'member';
export interface RepeatForState {
  enabled: boolean;
  rank: RepeatRank;
  level_min: number;
  level_max: number;
  times: number;
}
const DEFAULT_REPEAT_FOR: RepeatForState = {
  enabled: false,
  rank: 'mod',
  level_min: 1,
  level_max: 50,
  times: 2,
};

interface DraftState {
  name: string;
  triggerType: RuleTriggerType;
  triggerValue: string;
  actions: RuleAction[];
  randomAction: boolean;
  cooldown: number;
  ttsEnabled: boolean;
  ttsMessage: string;
  ttsVoice: string;
  allowedUsers: string[];
  requiredRanks: RankFlag[];
  excludedRanks: RankFlag[];
  repeatFor: RepeatForState;
}

const EMPTY_DRAFT: DraftState = {
  name: '',
  triggerType: 'gift',
  triggerValue: '',
  actions: [],
  randomAction: false,
  cooldown: 0,
  ttsEnabled: false,
  ttsMessage: '',
  ttsVoice: 'es_mx_002',
  allowedUsers: [],
  requiredRanks: [],
  excludedRanks: [],
  repeatFor: { ...DEFAULT_REPEAT_FOR },
};

function ruleToDraft(rule: Rule): DraftState {
  const rf = (rule as { repeat_for?: Partial<RepeatForState> }).repeat_for;
  return {
    name: rule.name,
    triggerType: rule.trigger_type,
    triggerValue: rule.trigger_value,
    actions: rule.actions,
    randomAction: rule.random_action,
    cooldown: rule.cooldown,
    ttsEnabled: rule.tts_enabled,
    ttsMessage: rule.tts_message,
    ttsVoice: rule.tts_voice,
    allowedUsers: rule.allowed_users,
    requiredRanks: rule.required_ranks ?? [],
    excludedRanks: rule.excluded_ranks ?? [],
    repeatFor: {
      ...DEFAULT_REPEAT_FOR,
      ...(rf && typeof rf === 'object' ? rf : {}),
    } as RepeatForState,
  };
}

export function RuleDialog({
  open,
  onClose,
  gameId,
  ruleId = null,
}: RuleDialogProps) {
  const openModal = useAppStore((s) => s.openModal);

  const { byId } = useGames({ autoLoad: open });
  const profile = byId(gameId);
  const { allRules, upsert } = useRules(open ? gameId : null, {
    autoLoad: open,
  });

  const editing = useMemo(
    () => (ruleId ? allRules.find((r) => r.id === ruleId) ?? null : null),
    [allRules, ruleId],
  );

  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(editing ? ruleToDraft(editing) : EMPTY_DRAFT);
    setError(null);
    setBusy(false);
  }, [open, editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  if (!gameId) return null;

  function patch<K extends keyof DraftState>(k: K, v: DraftState[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  function openGiftPicker() {
    openModal('gift-selector', {
      onSelect: (gift: { id: string }) => {
        patch('triggerValue', gift.id);
      },
    });
  }

  function openEntityGallery() {
    openModal('entity-selector', {
      gameId,
      multiSelect: true,
      title: '🐉 Elegir acciones',
      onConfirmMulti: (selections: MultiSelection[]) => {
        const cats = profile?.categories ?? [];
        const next = selections.map<RuleAction>((s) => {
          const cat = cats.find((c) => c.id === s.category);
          return {
            action_type: s.category,
            action_type_name: s.catLabel || cat?.name || s.category,
            action_value: s.displayName,
            amount: s.amount,
            commands: '',
          };
        });
        // REEMPLAZAR — si el usuario abre la galería para elegir acciones,
        // las que selecciona son la nueva lista. Antes se sumaban (bug:
        // editar regla → galería → agregaba duplicados a las existentes).
        setDraft((d) => ({ ...d, actions: next }));
      },
    });
  }

  // Validación.
  const nameOk = draft.name.trim().length > 0;
  const actionsOk = draft.actions.length > 0;
  const triggerValueOk =
    draft.triggerType === 'follow' ||
    draft.triggerType === 'share' ||
    draft.triggerType === 'subscribe' ||
    draft.triggerValue.trim().length > 0;

  const canSave = !busy && nameOk && actionsOk && triggerValueOk;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const input: RuleInput = {
        ...(editing ? { id: editing.id } : {}),
        name: draft.name.trim(),
        enabled: editing?.enabled ?? true,
        trigger_type: draft.triggerType,
        trigger_value: draft.triggerValue.trim(),
        actions: draft.actions,
        random_action: draft.randomAction && draft.actions.length > 1,
        cooldown: draft.cooldown,
        tts_enabled: draft.ttsEnabled,
        tts_message: draft.ttsMessage,
        tts_voice: draft.ttsVoice,
        allowed_users: draft.allowedUsers,
        required_ranks: draft.requiredRanks,
        excluded_ranks: draft.excludedRanks,
        // v1.0.49: solo persistimos repeat_for cuando está habilitado y
        // tiene al menos times>=2. Sino guardamos {} para no inflar el
        // JSON con configs default que el backend ignoraría igual.
        ...(draft.repeatFor.enabled && draft.repeatFor.times >= 2
          ? { repeat_for: draft.repeatFor }
          : {}),
      } as RuleInput;
      await upsert(input);
      onClose();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      bodyFlush
      title={editing ? '✏️ Editar Regla' : '➕ Nueva Regla'}
      description={`Juego: ${profile?.icon ?? '🎮'} ${profile?.name ?? gameId}`}
    >
      <form
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col min-h-0 overflow-hidden"
      >
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          <TriggerSection
            name={draft.name}
            onNameChange={(v) => patch('name', v)}
            triggerType={draft.triggerType}
            onTriggerTypeChange={(v) => patch('triggerType', v)}
            triggerValue={draft.triggerValue}
            onTriggerValueChange={(v) => patch('triggerValue', v)}
            onOpenGiftGallery={openGiftPicker}
            disabled={busy}
          />

          <ActionsSection
            gameId={gameId}
            profile={profile}
            actions={draft.actions}
            onChange={(next) => patch('actions', next)}
            randomAction={draft.randomAction}
            onRandomChange={(v) => patch('randomAction', v)}
            onOpenGallery={openEntityGallery}
            disabled={busy}
          />

          <CooldownTtsSection
            cooldown={draft.cooldown}
            onCooldownChange={(n) => patch('cooldown', n)}
            ttsEnabled={draft.ttsEnabled}
            onTtsEnabledChange={(v) => patch('ttsEnabled', v)}
            ttsMessage={draft.ttsMessage}
            onTtsMessageChange={(s) => patch('ttsMessage', s)}
            ttsVoice={draft.ttsVoice}
            onTtsVoiceChange={(s) => patch('ttsVoice', s)}
            allowedUsers={draft.allowedUsers}
            onAllowedUsersChange={(u) => patch('allowedUsers', u)}
            disabled={busy}
          />

          <RolesSection
            requiredRanks={draft.requiredRanks}
            excludedRanks={draft.excludedRanks}
            onRequiredChange={(r) => patch('requiredRanks', r)}
            onExcludedChange={(r) => patch('excludedRanks', r)}
            disabled={busy}
          />

          <RepeatForSection
            value={draft.repeatFor}
            onChange={(v) => patch('repeatFor', v)}
            disabled={busy}
          />

          {error && (
            <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3 bg-bg-base/50">
          <div className="text-[11px] text-fg-subtle">
            {!nameOk && '· Nombre requerido '}
            {!triggerValueOk && '· Falta valor de trigger '}
            {!actionsOk && '· Mínimo 1 acción '}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={!canSave}>
              {editing ? 'Guardar cambios' : '✅ Crear regla'}
            </Button>
          </div>
        </footer>
      </form>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────
// RepeatForSection — multiplicador de ejecuciones por rol/nivel del user
// ────────────────────────────────────────────────────────────────────

interface RepeatForSectionProps {
  value: RepeatForState;
  onChange: (v: RepeatForState) => void;
  disabled?: boolean;
}

const RANK_OPTIONS: { id: RepeatRank; label: string; emoji: string }[] = [
  { id: 'mod',       label: 'Moderador',         emoji: '🛡️' },
  { id: 'superfan',  label: 'Super Fan',         emoji: '⭐' },
  { id: 'donor',     label: 'Donador / Member',  emoji: '💎' },
  { id: 'follower',  label: 'Sigue al streamer', emoji: '➕' },
  { id: 'member',    label: 'Miembro (con nivel)', emoji: '🎖️' },
];

function RepeatForSection({ value, onChange, disabled = false }: RepeatForSectionProps) {
  function patch<K extends keyof RepeatForState>(k: K, v: RepeatForState[K]) {
    onChange({ ...value, [k]: v });
  }
  const showLevels = value.rank === 'member';

  return (
    <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-3">
      <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
        🔁 Multiplicador por rol (opcional)
      </legend>

      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          className="accent-accent"
          checked={value.enabled}
          onChange={(e) => patch('enabled', e.target.checked)}
          disabled={disabled}
        />
        <span>
          Multiplicar las ejecuciones de esta regla cuando el user cumpla
          un rol/nivel
        </span>
      </label>

      {value.enabled && (
        <div className="grid grid-cols-2 gap-2 pl-6">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-fg-subtle mb-1">
              Rol
            </label>
            <select
              className="maru-input w-full text-sm"
              value={value.rank}
              onChange={(e) => patch('rank', e.target.value as RepeatRank)}
              disabled={disabled}
            >
              {RANK_OPTIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.emoji} {r.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-fg-subtle mb-1">
              Veces (×N)
            </label>
            <input
              type="number"
              min={2}
              max={100}
              className="maru-input w-full text-sm"
              value={value.times}
              onChange={(e) =>
                patch('times', Math.max(2, Math.min(100, parseInt(e.target.value, 10) || 2)))
              }
              disabled={disabled}
            />
          </div>

          {showLevels && (
            <>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-fg-subtle mb-1">
                  Nivel min
                </label>
                <input
                  type="number"
                  min={1}
                  max={999}
                  className="maru-input w-full text-sm"
                  value={value.level_min}
                  onChange={(e) =>
                    patch('level_min', Math.max(1, Math.min(999, parseInt(e.target.value, 10) || 1)))
                  }
                  disabled={disabled}
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-fg-subtle mb-1">
                  Nivel max
                </label>
                <input
                  type="number"
                  min={1}
                  max={999}
                  className="maru-input w-full text-sm"
                  value={value.level_max}
                  onChange={(e) =>
                    patch('level_max', Math.max(1, Math.min(999, parseInt(e.target.value, 10) || 1)))
                  }
                  disabled={disabled}
                />
              </div>
            </>
          )}

          <p className="col-span-2 text-[11px] text-fg-subtle">
            Si el user del evento cumple el rol seleccionado, la regla se
            ejecutará <strong>×{value.times}</strong> en lugar de 1 vez.
            Para "Miembro" se valida que el nivel esté entre {value.level_min}
            y {value.level_max}.
          </p>
        </div>
      )}
    </fieldset>
  );
}
