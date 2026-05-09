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
  /** Niveles min/max para is_member (fans club) — solo aplica si is_member
   *  está en requiredRanks. undefined = no filtra por nivel. */
  memberLevelMin?: number;
  memberLevelMax?: number;
  /** Niveles min/max para is_gift_giver (ranking del live, 1..50). */
  gifterLevelMin?: number;
  gifterLevelMax?: number;
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
};

function ruleToDraft(rule: Rule): DraftState {
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
    memberLevelMin: rule.member_level_min,
    memberLevelMax: rule.member_level_max,
    gifterLevelMin: rule.gifter_level_min,
    gifterLevelMax: rule.gifter_level_max,
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
  // join + first_action permiten valor vacío = "cualquier viewer"
  // (la UI dice "Vacío = cualquier viewer" pero antes la validación lo
  // bloqueaba — bug v1.0.89-).
  const triggerValueOk =
    draft.triggerType === 'follow' ||
    draft.triggerType === 'share' ||
    draft.triggerType === 'subscribe' ||
    draft.triggerType === 'join' ||
    draft.triggerType === 'first_action' ||
    draft.triggerValue.trim().length > 0;

  const canSave = !busy && nameOk && actionsOk && triggerValueOk;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      // Solo enviamos los rangos de nivel si su rol relacionado está en
      // requiredRanks — sin esa precondición el backend los ignoraría.
      const wantsMemberLevel = draft.requiredRanks.includes('is_member');
      const wantsGifterLevel = draft.requiredRanks.includes('is_gift_giver');

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
        ...(wantsMemberLevel && draft.memberLevelMin !== undefined
          ? { member_level_min: draft.memberLevelMin }
          : {}),
        ...(wantsMemberLevel && draft.memberLevelMax !== undefined
          ? { member_level_max: draft.memberLevelMax }
          : {}),
        ...(wantsGifterLevel && draft.gifterLevelMin !== undefined
          ? { gifter_level_min: draft.gifterLevelMin }
          : {}),
        ...(wantsGifterLevel && draft.gifterLevelMax !== undefined
          ? { gifter_level_max: draft.gifterLevelMax }
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
            memberLevelMin={draft.memberLevelMin}
            memberLevelMax={draft.memberLevelMax}
            onMemberLevelChange={(min, max) =>
              setDraft((d) => ({ ...d, memberLevelMin: min, memberLevelMax: max }))
            }
            gifterLevelMin={draft.gifterLevelMin}
            gifterLevelMax={draft.gifterLevelMax}
            onGifterLevelChange={(min, max) =>
              setDraft((d) => ({ ...d, gifterLevelMin: min, gifterLevelMax: max }))
            }
            disabled={busy}
          />

          {/* Multiplicador por rol fue removido (v1.0.90+). Para
              multiplicar ejecuciones según rol/nivel ahora se usa el
              sistema de Boosts externos (botón "🚀 Boosts" del header) —
              más flexible, acumulable y editable sin abrir la regla. */}

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

