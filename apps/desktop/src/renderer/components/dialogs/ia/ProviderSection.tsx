import { useId } from 'react';
import { ExternalLink } from 'lucide-react';
import { Input, Label, Select, Switch } from '@maru/ui';
import type {
  IaConfig,
  IaCostRate,
  IaProviderId,
  IaProvidersMeta,
} from '@maru/shared';
import { IA_PROVIDER_IDS } from '@maru/shared';

/**
 * `ProviderSection` — TAB IA: provider + API key + model + cost preview.
 *
 * Replica de la sección "Configuración API" del MARU original.
 *
 * Mejoras vs original:
 *   - Cost preview con cálculo USD/1M tokens (in + out) cuando aplica.
 *   - Help URL clickeable inline.
 *   - Switch master "IA habilitada" arriba (en MARU el checkbox está
 *     fuera de la card).
 */
export interface ProviderSectionProps {
  config: IaConfig;
  providersMeta: IaProvidersMeta;
  /** Cambia provider y rellena api_key+model desde el slice. */
  onChangeProvider: (p: IaProviderId) => void;
  patch: (p: Partial<IaConfig>) => void;
  costRate: IaCostRate | null;
  disabled?: boolean;
}

export function ProviderSection({
  config,
  providersMeta,
  onChangeProvider,
  patch,
  costRate,
  disabled = false,
}: ProviderSectionProps) {
  const idPrefix = useId();
  const providerMeta = providersMeta.providers[config.provider];
  const models = providersMeta.models[config.provider] ?? [];

  return (
    <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-3">
      <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
        Configuración del proveedor
      </legend>

      <Switch
        checked={config.enabled}
        onChange={(v) => patch({ enabled: v })}
        disabled={disabled}
        label="🤖 IA activada (comando !ia)"
        description="Si está apagado, el comando !ia se ignora silenciosamente."
      />

      <div>
        <Label htmlFor={`${idPrefix}-prov`} required>
          Proveedor
        </Label>
        <Select
          id={`${idPrefix}-prov`}
          value={config.provider}
          onChange={(e) => onChangeProvider(e.target.value as IaProviderId)}
          disabled={disabled}
        >
          {IA_PROVIDER_IDS.map((pid) => {
            const meta = providersMeta.providers[pid];
            if (!meta) return null;
            return (
              <option key={pid} value={pid}>
                {meta.icon} {meta.name}
              </option>
            );
          })}
        </Select>
        {providerMeta?.help_text && (
          <p className="mt-1 text-[11px] text-fg-subtle">
            {providerMeta.help_text}{' '}
            {providerMeta.help_url && (
              <a
                href={providerMeta.help_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-info hover:underline"
              >
                Dashboard <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor={`${idPrefix}-key`} required>
          API key (privada)
        </Label>
        <Input
          id={`${idPrefix}-key`}
          type="password"
          value={config.api_key}
          onChange={(e) => patch({ api_key: e.target.value })}
          placeholder={
            config.provider === 'groq'
              ? 'gsk_...'
              : config.provider === 'claude'
                ? 'sk-ant-...'
                : config.provider === 'openai'
                  ? 'sk-...'
                  : 'AIza...'
          }
          disabled={disabled}
          className="font-mono text-xs"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="mt-1 text-[11px] text-fg-subtle">
          La key se guarda localmente en <code>data/ia.json</code> + por
          proveedor (cambiar de proveedor preserva la del anterior).
        </p>
      </div>

      <div>
        <Label htmlFor={`${idPrefix}-model`}>Modelo</Label>
        <Select
          id={`${idPrefix}-model`}
          value={config.model}
          onChange={(e) => patch({ model: e.target.value })}
          disabled={disabled}
        >
          {models.length === 0 && (
            <option value="">(sin modelos disponibles)</option>
          )}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          {/* fallback si el modelo actual no está listado */}
          {!models.some((m) => m.id === config.model) && config.model && (
            <option value={config.model}>{config.model}</option>
          )}
        </Select>
        {providerMeta && (
          <p className="mt-1 text-[11px] text-fg-subtle">
            {providerMeta.free
              ? '✅ Tier gratis disponible.'
              : '💵 Modelo de pago — ver tarifas debajo.'}
          </p>
        )}
      </div>

      {costRate && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs space-y-1">
          <p className="font-semibold text-warning">
            💰 Tarifa estimada de {config.model}
          </p>
          <p className="font-mono text-[11px] text-fg-muted">
            input: ${costRate.input.toFixed(2)} / 1M tokens · output: ${costRate.output.toFixed(2)} / 1M tokens
          </p>
          <p className="text-[10px] text-fg-subtle">
            Cada respuesta consume típicamente 100-500 tokens — costos por
            request ≪ $0.01 USD. El sidecar registra el costo exacto en el log.
          </p>
        </div>
      )}
    </fieldset>
  );
}
