import { useId } from 'react';
import { Trash2, Volume2 } from 'lucide-react';
import { Button, Label, Switch } from '@maru/ui';
import type { TtsConfig, TtsVoice, TtsVoiceMode } from '@maru/shared';
import { VoiceSelector } from './VoiceSelector.js';

/**
 * `TtsConfigPanel` — sección de configuración global del TTS.
 *
 * Cubre:
 *   - Master enabled + 3 toggles de canal (chat / social / fortune).
 *   - Volúmenes por canal con slider 0-100.
 *   - Default voice (combo con search).
 *   - Voice mode: global vs perfil (radio).
 *   - Botón clear cache.
 */
export interface TtsConfigPanelProps {
  config: TtsConfig;
  voices: TtsVoice[];
  families: Record<string, string>;
  patch: (p: Partial<TtsConfig>) => void;
  onClearCache: () => Promise<unknown>;
  disabled?: boolean;
}

export function TtsConfigPanel({
  config,
  voices,
  families,
  patch,
  onClearCache,
  disabled = false,
}: TtsConfigPanelProps) {
  const idPrefix = useId();

  return (
    <div className="space-y-3">
      <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
        <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
          Activación
        </legend>
        <Switch
          checked={config.enabled}
          onChange={(v) => patch({ enabled: v })}
          disabled={disabled}
          label="🔊 TTS habilitado"
          description="Master switch — apaga los 3 canales si está off."
        />
        <div className="grid grid-cols-3 gap-2 pt-1">
          {(
            [
              { key: 'enabled_chat', label: '💬 Chat' },
              { key: 'enabled_social', label: '🎭 Social' },
              { key: 'enabled_fortune', label: '🔮 Fortuna' },
            ] as const
          ).map((c) => (
            <label
              key={c.key}
              className="flex items-center gap-2 rounded-md border border-border bg-bg-elev px-2 py-1.5 text-xs cursor-pointer"
            >
              <input
                type="checkbox"
                checked={config[c.key]}
                onChange={(e) => patch({ [c.key]: e.target.checked } as Partial<TtsConfig>)}
                disabled={disabled || !config.enabled}
                className="h-3 w-3 accent-accent"
              />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
        <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
          Volúmenes por canal
        </legend>
        {(
          [
            { key: 'volume_chat', label: 'Chat', enabledKey: 'enabled_chat' },
            { key: 'volume_social', label: 'Social', enabledKey: 'enabled_social' },
            { key: 'volume_fortune', label: 'Fortuna', enabledKey: 'enabled_fortune' },
          ] as const
        ).map((c) => {
          const enabled = config[c.enabledKey] && config.enabled;
          return (
            <div key={c.key} className="flex items-center gap-2">
              <Volume2 className="h-3.5 w-3.5 text-fg-muted shrink-0" />
              <span className="text-xs text-fg-muted shrink-0 w-14">{c.label}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={config[c.key]}
                onChange={(e) =>
                  patch({ [c.key]: parseInt(e.target.value, 10) || 0 } as Partial<TtsConfig>)
                }
                disabled={disabled || !enabled}
                className="flex-1 accent-accent"
              />
              <span className="w-12 text-right text-[11px] font-mono text-fg-subtle">
                {config[c.key]}%
              </span>
            </div>
          );
        })}
      </fieldset>

      <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-3">
        <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
          Voz por defecto + niveles
        </legend>

        <VoiceSelector
          voices={voices}
          families={families}
          value={config.default_voice}
          onChange={(v) => patch({ default_voice: v })}
          label="Voz default (nivel 1 — fallback)"
          disabled={disabled}
        />

        <div>
          <Label htmlFor={`${idPrefix}-vmode`}>
            Modo de voces (nivel 2)
          </Label>
          <div className="flex items-center gap-3 text-xs">
            {(
              [
                { v: 'global', label: '🌐 Globales (un set para todos los juegos)' },
                { v: 'profile', label: '📁 Por perfil (cada juego su set)' },
              ] as const
            ).map((opt) => (
              <label
                key={opt.v}
                className="flex items-center gap-1.5 cursor-pointer"
              >
                <input
                  type="radio"
                  name={`${idPrefix}-vmode`}
                  value={opt.v}
                  checked={config.voice_mode === opt.v}
                  onChange={() => patch({ voice_mode: opt.v as TtsVoiceMode })}
                  disabled={disabled}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-fg-subtle">
            Resolución 3 niveles: per-user (override) → globales/perfil →
            default. Si nada matcha, usa la default.
          </p>
        </div>
      </fieldset>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void onClearCache()}
          disabled={disabled}
          title="Limpiar cache MD5 de audio MP3 (libera espacio en disco)"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Limpiar cache TTS
        </Button>
      </div>
    </div>
  );
}
