import type { StateCreator } from 'zustand';
import type {
  TtsConfig,
  TtsQueueSizes,
  TtsUserVoice,
  TtsVoice,
} from '@maru/shared';

/**
 * Slice de TTS (G9) — global single (un solo TTSEngine).
 *
 * Caché: voices catalog + userVoices + config + queueSizes (poll).
 */

const DEFAULT_CONFIG: TtsConfig = {
  enabled: true,
  enabled_chat: true,
  enabled_social: true,
  enabled_fortune: true,
  default_voice: 'es_mx_002',
  voice_mode: 'global',
  volume_chat: 80,
  volume_social: 85,
  volume_fortune: 85,
};

const EMPTY_QUEUE: TtsQueueSizes = { chat: 0, social: 0, fortune: 0 };

export interface TtsSlice {
  ttsVoices: TtsVoice[];
  ttsFamilies: Record<string, string>;
  ttsVoicesStatus: 'idle' | 'loading' | 'ready' | 'error';
  ttsConfig: TtsConfig;
  ttsUserVoices: TtsUserVoice[];
  ttsQueueSizes: TtsQueueSizes;

  setTtsVoices: (voices: TtsVoice[], families: Record<string, string>) => void;
  setTtsVoicesStatus: (s: TtsSlice['ttsVoicesStatus']) => void;
  setTtsConfig: (cfg: TtsConfig) => void;
  patchTtsConfig: (patch: Partial<TtsConfig>) => void;
  setTtsUserVoices: (list: TtsUserVoice[]) => void;
  upsertTtsUserVoiceLocal: (entry: TtsUserVoice) => void;
  removeTtsUserVoiceLocal: (username: string) => void;
  setTtsQueueSizes: (q: TtsQueueSizes) => void;
}

export const createTtsSlice: StateCreator<TtsSlice, [], [], TtsSlice> = (
  set,
) => ({
  ttsVoices: [],
  ttsFamilies: {},
  ttsVoicesStatus: 'idle',
  ttsConfig: DEFAULT_CONFIG,
  ttsUserVoices: [],
  ttsQueueSizes: EMPTY_QUEUE,

  setTtsVoices: (ttsVoices, ttsFamilies) =>
    set({ ttsVoices, ttsFamilies, ttsVoicesStatus: 'ready' }),
  setTtsVoicesStatus: (ttsVoicesStatus) => set({ ttsVoicesStatus }),
  setTtsConfig: (ttsConfig) => set({ ttsConfig }),
  patchTtsConfig: (patch) =>
    set((s) => ({ ttsConfig: { ...s.ttsConfig, ...patch } })),
  setTtsUserVoices: (ttsUserVoices) => set({ ttsUserVoices }),
  upsertTtsUserVoiceLocal: (entry) =>
    set((s) => {
      const idx = s.ttsUserVoices.findIndex(
        (u) => u.username === entry.username,
      );
      const next =
        idx === -1
          ? [...s.ttsUserVoices, entry]
          : s.ttsUserVoices.map((u, i) => (i === idx ? entry : u));
      return { ttsUserVoices: next };
    }),
  removeTtsUserVoiceLocal: (username) =>
    set((s) => ({
      ttsUserVoices: s.ttsUserVoices.filter((u) => u.username !== username),
    })),
  setTtsQueueSizes: (ttsQueueSizes) => set({ ttsQueueSizes }),
});
