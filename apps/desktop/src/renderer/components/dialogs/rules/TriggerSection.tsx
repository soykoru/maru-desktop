import { useId } from 'react';
import { ImageIcon } from 'lucide-react';
import { Button, Input, Label, Select } from '@maru/ui';
import type { RuleTriggerType } from '@maru/shared';
import { TRIGGER_KEYS, triggerMeta } from './trigger-meta.js';

/**
 * `TriggerSection` — selector de trigger + paneles condicionales.
 *
 * Réplica de la sección "📋 Información" + las 4 sub-secciones que
 * MARU original muestra/oculta según `event.currentData()`.
 */
export interface TriggerSectionProps {
  name: string;
  onNameChange: (v: string) => void;
  triggerType: RuleTriggerType;
  onTriggerTypeChange: (v: RuleTriggerType) => void;
  triggerValue: string;
  onTriggerValueChange: (v: string) => void;
  /** Llamado cuando el usuario clickea "Galería visual" en gift. */
  onOpenGiftGallery?: () => void;
  disabled?: boolean;
}

export function TriggerSection({
  name,
  onNameChange,
  triggerType,
  onTriggerTypeChange,
  triggerValue,
  onTriggerValueChange,
  onOpenGiftGallery,
  disabled = false,
}: TriggerSectionProps) {
  const idPrefix = useId();
  const meta = triggerMeta(triggerType);

  return (
    <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-3">
      <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
        📋 Información
      </legend>

      <div>
        <Label htmlFor={`${idPrefix}-name`} required>
          Nombre de la regla
        </Label>
        <Input
          id={`${idPrefix}-name`}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Ej: Rosa = 5 Trolls"
          disabled={disabled}
          invalid={!name.trim() && name.length > 0}
        />
      </div>

      <div>
        <Label htmlFor={`${idPrefix}-trigger`} required>
          Trigger (evento que dispara la regla)
        </Label>
        <Select
          id={`${idPrefix}-trigger`}
          value={triggerType}
          onChange={(e) => {
            onTriggerTypeChange(e.target.value as RuleTriggerType);
            onTriggerValueChange('');
          }}
          disabled={disabled}
        >
          {TRIGGER_KEYS.map((t) => {
            const m = triggerMeta(t);
            return (
              <option key={t} value={t}>
                {m.emoji} {m.label}
              </option>
            );
          })}
        </Select>
        <p className="mt-1 text-[11px] text-fg-subtle">{meta.hint}</p>
      </div>

      {/* Panel condicional: gift */}
      {triggerType === 'gift' && (
        <div className="rounded-lg border border-border bg-bg-elev p-3 space-y-2">
          <Label htmlFor={`${idPrefix}-gift`} required>
            🎁 ID del regalo TikTok
          </Label>
          <div className="flex gap-2">
            <Input
              id={`${idPrefix}-gift`}
              value={triggerValue}
              onChange={(e) => onTriggerValueChange(e.target.value)}
              placeholder="Rose, Heart Me, Galaxy..."
              disabled={disabled}
              className="font-mono text-xs"
            />
            {onOpenGiftGallery && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onOpenGiftGallery}
                disabled={disabled}
                title="Abrir galería visual de regalos"
              >
                <ImageIcon className="h-3.5 w-3.5" />
                Galería
              </Button>
            )}
          </div>
          <p className="text-[11px] text-fg-subtle">
            Escribí el id exacto del gift (case-sensitive) o usá la galería.
          </p>
        </div>
      )}

      {/* Panel condicional: like */}
      {triggerType === 'like' && (
        <div className="rounded-lg border border-border bg-bg-elev p-3 space-y-2">
          <Label htmlFor={`${idPrefix}-like`} required>
            ❤️ Activar cada N likes
          </Label>
          <Input
            id={`${idPrefix}-like`}
            type="number"
            min={1}
            max={10000}
            value={triggerValue || '10'}
            onChange={(e) => onTriggerValueChange(e.target.value)}
            disabled={disabled}
          />
          <p className="text-[11px] text-fg-subtle">
            La regla se activará cada vez que se acumulen X likes.
          </p>
        </div>
      )}

      {/* Panel condicional: like_milestone */}
      {triggerType === 'like_milestone' && (
        <div className="rounded-lg border border-border bg-bg-elev p-3 space-y-2">
          <Label htmlFor={`${idPrefix}-milestone`} required>
            🎯 Meta de likes total
          </Label>
          <Input
            id={`${idPrefix}-milestone`}
            type="number"
            min={100}
            max={1_000_000}
            step={100}
            value={triggerValue || '1000'}
            onChange={(e) => onTriggerValueChange(e.target.value)}
            disabled={disabled}
          />
          <p className="text-[11px] text-fg-subtle">
            Se activará UNA VEZ cuando el stream alcance esta meta.
          </p>
        </div>
      )}

      {/* Panel condicional: command */}
      {triggerType === 'command' && (
        <div className="rounded-lg border border-border bg-bg-elev p-3 space-y-2">
          <Label htmlFor={`${idPrefix}-cmd`} required>
            💬 Texto del comando
          </Label>
          <Input
            id={`${idPrefix}-cmd`}
            value={triggerValue}
            onChange={(e) => onTriggerValueChange(e.target.value)}
            placeholder="!spawn, !zombie, !help..."
            disabled={disabled}
            className="font-mono text-xs"
          />
        </div>
      )}
    </fieldset>
  );
}
