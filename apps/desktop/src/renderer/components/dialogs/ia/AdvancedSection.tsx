import { useId, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button, Input, Label, TextArea } from '@maru/ui';
import type { IaConfig } from '@maru/shared';

/**
 * `AdvancedSection` — TAB IA: max length + cooldown + system prompt +
 * SOYKORU_CONTEXT editable.
 *
 * Mejora vs MARU original: el `SOYKORU_CONTEXT` era hardcoded (323
 * caracteres del bio de Koru). Acá lo expone como campo editable
 * "Contexto del streamer" — cada usuario configura el suyo.
 */
export interface AdvancedSectionProps {
  config: IaConfig;
  patch: (p: Partial<IaConfig>) => void;
  context: string;
  contextDefault: string;
  contextIsDefault: boolean;
  onContextChange: (text: string) => void;
  /** Llamado cuando el usuario pulsa "Restaurar default". */
  onContextReset: () => void;
  disabled?: boolean;
}

const DEFAULT_SYSTEM_PROMPT_HINT = (
  'Vacío = usa el prompt default del sidecar (paridad MARU). ' +
  'Sobreescribir solo si necesitás cambiar el comportamiento base de la IA.'
);

export function AdvancedSection({
  config,
  patch,
  context,
  contextDefault,
  contextIsDefault,
  onContextChange,
  onContextReset,
  disabled = false,
}: AdvancedSectionProps) {
  const idPrefix = useId();
  const [showFullDefault, setShowFullDefault] = useState(false);

  return (
    <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-3">
      <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
        Configuración avanzada
      </legend>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`${idPrefix}-len`}>Largo máx. respuesta</Label>
          <Input
            id={`${idPrefix}-len`}
            type="number"
            min={100}
            max={800}
            step={10}
            value={String(config.max_response_length)}
            onChange={(e) =>
              patch({
                max_response_length: Math.max(
                  100,
                  Math.min(800, parseInt(e.target.value, 10) || 400),
                ),
              })
            }
            disabled={disabled}
            suffix="chars"
          />
          <p className="mt-1 text-[11px] text-fg-subtle">
            Truncado limpio en el último punto. Default 400.
          </p>
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-cd`}>Cooldown por usuario</Label>
          <Input
            id={`${idPrefix}-cd`}
            type="number"
            min={3}
            max={120}
            value={String(config.cooldown_seconds)}
            onChange={(e) =>
              patch({
                cooldown_seconds: Math.max(
                  3,
                  Math.min(120, parseInt(e.target.value, 10) || 10),
                ),
              })
            }
            disabled={disabled}
            suffix="seg"
          />
          <p className="mt-1 text-[11px] text-fg-subtle">
            Mínimo 3s, máximo 120s. Default 10s.
          </p>
        </div>
      </div>

      <div>
        <Label htmlFor={`${idPrefix}-prompt`}>System prompt custom</Label>
        <TextArea
          id={`${idPrefix}-prompt`}
          value={config.system_prompt}
          onChange={(e) => patch({ system_prompt: e.target.value })}
          placeholder="Vacío = usa el prompt default (recomendado)"
          disabled={disabled}
          className="text-xs min-h-[80px]"
        />
        <p className="mt-1 text-[11px] text-fg-subtle">
          {DEFAULT_SYSTEM_PROMPT_HINT}
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor={`${idPrefix}-ctx`}>
            🎤 Contexto del streamer (mejora G8)
          </Label>
          {!contextIsDefault && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onContextReset}
              disabled={disabled}
              title="Restaurar el contexto default"
            >
              <RotateCcw className="h-3 w-3" />
              Restaurar
            </Button>
          )}
        </div>
        <TextArea
          id={`${idPrefix}-ctx`}
          value={context}
          onChange={(e) => onContextChange(e.target.value)}
          placeholder={contextDefault.slice(0, 100) + '...'}
          disabled={disabled}
          className="text-xs min-h-[100px]"
        />
        <p className="mt-1 text-[11px] text-fg-subtle">
          {contextIsDefault ? '⚪ Usando default.' : '✏️ Customizado.'}{' '}
          La IA usa este texto para personalizar respuestas (Soykoru, gaming,
          datos del streamer). Antes era hardcoded en el código —{' '}
          <button
            type="button"
            onClick={() => setShowFullDefault((v) => !v)}
            className="text-info hover:underline"
          >
            {showFullDefault ? 'ocultar' : 'ver'} default completo
          </button>
          .
        </p>
        {showFullDefault && (
          <pre className="mt-2 rounded-md border border-border bg-bg-elev/50 p-2 text-[10px] text-fg-muted whitespace-pre-wrap leading-snug">
            {contextDefault}
          </pre>
        )}
      </div>
    </fieldset>
  );
}
