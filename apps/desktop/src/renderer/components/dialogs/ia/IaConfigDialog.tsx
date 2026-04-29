import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { Button, Dialog } from '@maru/ui';
import type { IaConfig, IaProviderId } from '@maru/shared';
import { useAppStore } from '../../../lib/store/index.js';
import { useIa } from '../../../lib/use-ia.js';
import { AdvancedSection } from './AdvancedSection.js';
import { ProviderSection } from './ProviderSection.js';
import { TestPanel } from './TestPanel.js';

/**
 * `IaConfigDialog` (G8) — modal de configuración del motor IA.
 *
 * Réplica de la tab IA del MARU original (`social_config.py:tab IA`)
 * + persistencia propia del sidecar + SOYKORU_CONTEXT editable.
 *
 * Layout (lg):
 *   - ProviderSection: enabled + provider + key + model + cost preview.
 *   - AdvancedSection: max length + cooldown + system prompt + context.
 *   - TestPanel: test inline con timing + meta.
 *
 * Save aplica config + context en orden y refresca para mostrar el
 * estado real (ready, model resolved, etc.).
 */
export function IaConfigDialog() {
  const open = useAppStore((s) => s.modalStack.some((f) => f.id === 'ia-config'));
  const closeModal = useAppStore((s) => s.closeModal);

  const ia = useIa({ autoLoad: open });

  const [draftConfig, setDraftConfig] = useState<IaConfig>(ia.config);
  const [draftContext, setDraftContext] = useState<string>(ia.context);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync draft cuando se carga / re-carga.
  useEffect(() => {
    setDraftConfig(ia.config);
  }, [ia.config]);

  useEffect(() => {
    setDraftContext(ia.context);
  }, [ia.context]);

  // Reset al cerrar.
  useEffect(() => {
    if (!open) {
      setSaveError(null);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  function patchDraft(p: Partial<IaConfig>) {
    setDraftConfig((d) => ({ ...d, ...p }));
  }

  function changeProvider(provider: IaProviderId) {
    const storedKey = draftConfig.api_keys[provider] ?? '';
    const defaultModel =
      ia.providersMeta.providers[provider]?.default_model ?? '';
    setDraftConfig((d) => ({
      ...d,
      provider,
      api_key: storedKey,
      model: defaultModel,
    }));
  }

  const dirtyConfig =
    JSON.stringify(draftConfig) !== JSON.stringify(ia.config);
  const dirtyContext = draftContext !== ia.context;
  const dirty = dirtyConfig || dirtyContext;

  async function handleSave() {
    setBusy(true);
    setSaveError(null);
    try {
      if (dirtyConfig) await ia.saveConfig(draftConfig);
      if (dirtyContext) await ia.saveContext(draftContext);
    } catch (ex) {
      setSaveError(ex instanceof Error ? ex.message : String(ex));
      return;
    } finally {
      setBusy(false);
    }
  }

  // Para que el TestPanel use config + context PERSISTIDOS (no draft),
  // recomendamos guardar primero. Mostramos un hint si dirty.

  return (
    <Dialog
      open
      onClose={() => !busy && closeModal()}
      size="lg"
      bodyFlush
      title="🤖 Configuración IA"
      description="Multi-proveedor con keys per-provider y SOYKORU_CONTEXT editable."
    >
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
        <ProviderSection
          config={draftConfig}
          providersMeta={ia.providersMeta}
          onChangeProvider={changeProvider}
          patch={patchDraft}
          costRate={ia.providersMeta.costRates[draftConfig.model] ?? null}
          disabled={busy}
        />

        <AdvancedSection
          config={draftConfig}
          patch={patchDraft}
          context={draftContext}
          contextDefault={ia.contextDefault}
          contextIsDefault={draftContext === ia.contextDefault}
          onContextChange={setDraftContext}
          onContextReset={() => setDraftContext(ia.contextDefault)}
          disabled={busy}
        />

        <TestPanel
          ready={ia.ready}
          lastTest={ia.lastTest}
          onTest={ia.test}
          disabled={busy}
        />

        {dirty && (
          <p className="text-[11px] text-warning">
            ⚠ Hay cambios sin guardar — el test usa la config persistida.
            Guardá primero para probar la nueva config.
          </p>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3 bg-bg-base/50">
        <div className="text-xs">
          {saveError && <span className="text-danger">⚠ {saveError}</span>}
          {!saveError && dirty && (
            <span className="text-warning">● Cambios sin guardar</span>
          )}
          {!saveError && !dirty && ia.ready && (
            <span className="text-success">✓ IA lista</span>
          )}
          {!saveError && !dirty && !ia.ready && (
            <span className="text-fg-subtle">⚪ IA no habilitada</span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={closeModal} disabled={busy}>
            Cerrar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSave()}
            disabled={busy || !dirty}
          >
            <Save className="h-3.5 w-3.5" />
            Guardar
          </Button>
        </div>
      </footer>
    </Dialog>
  );
}
