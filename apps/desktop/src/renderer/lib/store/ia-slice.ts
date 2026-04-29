import type { StateCreator } from 'zustand';
import type {
  IaConfig,
  IaProvidersMeta,
  IaTestResult,
} from '@maru/shared';

/**
 * Slice de IA (G8) — global (single IAEngine).
 *
 * Caché: config + providersMeta + context + último test.
 */

const DEFAULT_CONFIG: IaConfig = {
  enabled: false,
  provider: 'claude',
  api_key: '',
  api_keys: {},
  model: '',
  max_response_length: 400,
  cooldown_seconds: 10,
  system_prompt: '',
};

const EMPTY_META: IaProvidersMeta = {
  providers: {} as IaProvidersMeta['providers'],
  models: {} as IaProvidersMeta['models'],
  costRates: {},
};

export interface IaSlice {
  iaConfig: IaConfig;
  iaReady: boolean;
  iaContext: string;
  iaContextIsDefault: boolean;
  iaContextDefault: string;
  iaProvidersMeta: IaProvidersMeta;
  iaProvidersStatus: 'idle' | 'loading' | 'ready' | 'error';
  iaLastTest: IaTestResult | null;

  setIaConfig: (cfg: IaConfig, ready: boolean) => void;
  patchIaConfig: (patch: Partial<IaConfig>) => void;
  setIaContext: (ctx: string, isDefault: boolean, def: string) => void;
  setIaProvidersMeta: (meta: IaProvidersMeta) => void;
  setIaProvidersStatus: (s: IaSlice['iaProvidersStatus']) => void;
  setIaLastTest: (t: IaTestResult | null) => void;
}

export const createIaSlice: StateCreator<IaSlice, [], [], IaSlice> = (set) => ({
  iaConfig: DEFAULT_CONFIG,
  iaReady: false,
  iaContext: '',
  iaContextIsDefault: true,
  iaContextDefault: '',
  iaProvidersMeta: EMPTY_META,
  iaProvidersStatus: 'idle',
  iaLastTest: null,

  setIaConfig: (iaConfig, iaReady) => set({ iaConfig, iaReady }),
  patchIaConfig: (patch) =>
    set((s) => ({ iaConfig: { ...s.iaConfig, ...patch } })),
  setIaContext: (iaContext, iaContextIsDefault, iaContextDefault) =>
    set({ iaContext, iaContextIsDefault, iaContextDefault }),
  setIaProvidersMeta: (iaProvidersMeta) =>
    set({ iaProvidersMeta, iaProvidersStatus: 'ready' }),
  setIaProvidersStatus: (iaProvidersStatus) => set({ iaProvidersStatus }),
  setIaLastTest: (iaLastTest) => set({ iaLastTest }),
});
