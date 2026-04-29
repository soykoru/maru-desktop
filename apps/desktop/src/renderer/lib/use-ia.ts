/**
 * `useIa` — hook que cablea el slice IA con el sidecar.
 *
 * Provee load parallel + saveConfig + saveContext + test (con timing).
 */

import { useCallback, useEffect, useMemo } from 'react';
import type { IaConfig, IaProviderId } from '@maru/shared';
import { rpcCall } from './rpc.js';
import { useAppStore } from './store/index.js';

export function useIa(options?: { autoLoad?: boolean }) {
  const autoLoad = options?.autoLoad ?? true;

  const config = useAppStore((s) => s.iaConfig);
  const ready = useAppStore((s) => s.iaReady);
  const context = useAppStore((s) => s.iaContext);
  const contextIsDefault = useAppStore((s) => s.iaContextIsDefault);
  const contextDefault = useAppStore((s) => s.iaContextDefault);
  const providersMeta = useAppStore((s) => s.iaProvidersMeta);
  const providersStatus = useAppStore((s) => s.iaProvidersStatus);
  const lastTest = useAppStore((s) => s.iaLastTest);

  const setConfig = useAppStore((s) => s.setIaConfig);
  const patchConfig = useAppStore((s) => s.patchIaConfig);
  const setContext = useAppStore((s) => s.setIaContext);
  const setProvidersMeta = useAppStore((s) => s.setIaProvidersMeta);
  const setProvidersStatus = useAppStore((s) => s.setIaProvidersStatus);
  const setLastTest = useAppStore((s) => s.setIaLastTest);

  const loadConfig = useCallback(async () => {
    const res = await rpcCall('ia.config.get', {});
    setConfig(res.config, res.ready);
  }, [setConfig]);

  const loadContext = useCallback(async () => {
    const res = await rpcCall('ia.context.get', {});
    setContext(res.context, res.isDefault, res.default);
  }, [setContext]);

  const loadProvidersMeta = useCallback(async () => {
    setProvidersStatus('loading');
    try {
      const res = await rpcCall('ia.providers-meta', {});
      setProvidersMeta(res);
    } catch {
      setProvidersStatus('error');
    }
  }, [setProvidersMeta, setProvidersStatus]);

  const loadAll = useCallback(async () => {
    await Promise.all([
      loadConfig().catch(() => undefined),
      loadContext().catch(() => undefined),
      loadProvidersMeta().catch(() => undefined),
    ]);
  }, [loadConfig, loadContext, loadProvidersMeta]);

  useEffect(() => {
    if (!autoLoad) return;
    if (providersStatus === 'idle') void loadAll();
  }, [autoLoad, providersStatus, loadAll]);

  const saveConfig = useCallback(
    async (patch: Partial<IaConfig>) => {
      const res = await rpcCall('ia.config.set', { patch });
      if (!res.ok) throw new Error('config_set falló');
      // Refrescar para obtener los compat fields aplicados.
      await loadConfig();
      return res.config;
    },
    [loadConfig],
  );

  const saveContext = useCallback(
    async (text: string) => {
      const res = await rpcCall('ia.context.set', { context: text });
      if (!res.ok) throw new Error('context_set falló');
      await loadContext();
    },
    [loadContext],
  );

  const test = useCallback(
    async (question?: string) => {
      const res = await rpcCall('ia.test', { question });
      setLastTest(res);
      return res;
    },
    [setLastTest],
  );

  const ask = useCallback(async (user: string, question: string) => {
    return rpcCall('ia.ask', { user, question });
  }, []);

  // Helpers derivados.
  const modelsForCurrent = useMemo(
    () => providersMeta.models[config.provider] ?? [],
    [providersMeta.models, config.provider],
  );

  const currentProviderMeta = useMemo(
    () => providersMeta.providers[config.provider] ?? null,
    [providersMeta.providers, config.provider],
  );

  const currentCostRate = useMemo(
    () => providersMeta.costRates[config.model] ?? null,
    [providersMeta.costRates, config.model],
  );

  function patchLocalProvider(provider: IaProviderId) {
    // Cambiar provider localmente: rescatar la key guardada y resetear modelo.
    const storedKey = config.api_keys[provider] ?? '';
    const defaultModel =
      providersMeta.providers[provider]?.default_model ?? '';
    patchConfig({ provider, api_key: storedKey, model: defaultModel });
  }

  return {
    // state
    config,
    ready,
    context,
    contextIsDefault,
    contextDefault,
    providersMeta,
    providersStatus,
    lastTest,
    // derived
    modelsForCurrent,
    currentProviderMeta,
    currentCostRate,
    // local mutations (para form drafts)
    patchConfig,
    patchLocalProvider,
    // sidecar mutations
    loadAll,
    loadConfig,
    loadContext,
    loadProvidersMeta,
    saveConfig,
    saveContext,
    test,
    ask,
  };
}
