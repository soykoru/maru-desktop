import { useId, useState } from 'react';
import { Loader2, Wand2 } from 'lucide-react';
import { Button, Input, Label } from '@maru/ui';
import type { IaTestResult } from '@maru/shared';

/**
 * `TestPanel` — botón de prueba inline + último resultado.
 *
 * Réplica del botón "🧪 Probar IA" del MARU original. El sidecar G8
 * dispara `ia.test` con timeout 15s + mide latencia. Devuelve respuesta
 * + meta (tokens, costo) si el provider lo expone.
 */
export interface TestPanelProps {
  ready: boolean;
  lastTest: IaTestResult | null;
  onTest: (question?: string) => Promise<IaTestResult>;
  disabled?: boolean;
}

export function TestPanel({
  ready,
  lastTest,
  onTest,
  disabled = false,
}: TestPanelProps) {
  const idPrefix = useId();
  const [question, setQuestion] = useState('');
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    try {
      await onTest(question.trim() || undefined);
    } finally {
      setRunning(false);
    }
  }

  return (
    <fieldset className="rounded-xl border border-info/40 bg-info/5 p-3 space-y-2">
      <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-info">
        🧪 Probar IA
      </legend>

      <div>
        <Label htmlFor={`${idPrefix}-q`}>
          Pregunta (vacío = saludo de prueba)
        </Label>
        <div className="flex gap-2">
          <Input
            id={`${idPrefix}-q`}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="¿Cuántos planetas tiene el sistema solar?"
            disabled={disabled || running}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && ready) void run();
            }}
          />
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void run()}
            disabled={disabled || running || !ready}
            title={!ready ? 'Configurá provider + API key + activar primero' : 'Enviar test'}
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="h-3.5 w-3.5" />
            )}
            Probar
          </Button>
        </div>
        {!ready && (
          <p className="mt-1 text-[11px] text-warning">
            ⚠️ La IA no está lista — falta provider, API key o no está habilitada.
          </p>
        )}
      </div>

      {lastTest && (
        <div
          aria-live="polite"
          className={[
            'rounded-md border px-3 py-2 text-xs space-y-1',
            lastTest.ok
              ? 'border-success/40 bg-success/10'
              : 'border-danger/40 bg-danger/10',
          ].join(' ')}
        >
          <p className="text-fg whitespace-pre-wrap leading-relaxed">
            {lastTest.answer}
          </p>
          <p className="text-[10px] font-mono text-fg-subtle">
            {lastTest.ok ? '✓' : '✗'} latencia {lastTest.latencyMs}ms
            {lastTest.meta?.provider && ` · ${lastTest.meta.provider}`}
            {lastTest.meta?.model && ` · ${lastTest.meta.model}`}
            {lastTest.meta?.input_tokens !== undefined &&
              ` · ${lastTest.meta.input_tokens}+${lastTest.meta.output_tokens ?? 0} tokens`}
            {lastTest.meta?.cost_usd !== undefined &&
              ` · ~$${lastTest.meta.cost_usd.toFixed(6)}`}
          </p>
        </div>
      )}
    </fieldset>
  );
}
