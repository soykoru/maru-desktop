import { useId, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { Button, Input, Label, Switch, VolumeSlider } from '@maru/ui';
import type { SocialConfig } from '@maru/shared';
import { rpcCall } from '../../../lib/rpc.js';
import { useTts } from '../../../lib/use-tts.js';
import { VoiceSelector } from '../tts/VoiceSelector.js';

/**
 * `GeneralTab` — TAB 1 del SocialConfigDialog (paridad MARU).
 *
 * Activación + tiempos + audio (volumen + voz + botón probar).
 * El botón probar usa `tts.speak` con channel 'social'.
 *
 * G9: usa el catálogo real de 74 voces (del TtsService) en vez de
 * los 5 hardcoded del placeholder G7.
 */
export interface GeneralTabProps {
  config: SocialConfig;
  patch: (p: Partial<SocialConfig>) => void;
  disabled?: boolean;
}

export function GeneralTab({
  config,
  patch,
  disabled = false,
}: GeneralTabProps) {
  const idPrefix = useId();
  const [testing, setTesting] = useState(false);
  const { voices, families } = useTts({ autoLoad: true });

  async function handleTestVoice() {
    setTesting(true);
    try {
      await rpcCall('tts.speak', {
        text: '¡Esta es una prueba del sistema social!',
        channel: 'social',
        voice: config.voice || undefined,
      });
    } catch {
      /* swallow */
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-4">
      <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
        <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
          Activación
        </legend>
        <Switch
          checked={config.enabled}
          onChange={(v) => patch({ enabled: v })}
          disabled={disabled}
          label="Sistema Social ACTIVO"
          description="Habilita o deshabilita el procesamiento de comandos sociales del chat."
        />
        <Switch
          checked={config.require_register}
          onChange={(v) => patch({ require_register: v })}
          disabled={disabled}
          label="📝 Requerir !register antes de usar comandos"
          description="Los usuarios no registrados ven sus mensajes ignorados (sin TTS)."
        />
      </fieldset>

      <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
        <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
          Tiempos
        </legend>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor={`${idPrefix}-cd`}>Cooldown entre comandos</Label>
            <Input
              id={`${idPrefix}-cd`}
              type="number"
              min={1}
              max={300}
              value={String(config.cooldown_seconds)}
              onChange={(e) =>
                patch({
                  cooldown_seconds: Math.max(
                    1,
                    Math.min(300, parseInt(e.target.value, 10) || 1),
                  ),
                })
              }
              disabled={disabled}
              suffix="seg"
            />
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-to`}>Timeout de respuesta</Label>
            <Input
              id={`${idPrefix}-to`}
              type="number"
              min={10}
              max={600}
              value={String(config.timeout_seconds)}
              onChange={(e) =>
                patch({
                  timeout_seconds: Math.max(
                    10,
                    Math.min(600, parseInt(e.target.value, 10) || 10),
                  ),
                })
              }
              disabled={disabled}
              suffix="seg"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-3">
        <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
          Audio (canal social)
        </legend>

        <VolumeSlider
          icon={<Volume2 className="h-4 w-4" />}
          value={config.volume}
          onChange={(v) => patch({ volume: v })}
          disabled={disabled}
          aria-label="Volumen canal social"
        />

        <div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <VoiceSelector
                voices={voices}
                families={families}
                value={config.voice}
                onChange={(v) => patch({ voice: v })}
                label="Voz (canal social)"
                disabled={disabled}
                allowEmpty
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void handleTestVoice()}
              disabled={disabled || testing}
              title="Reproducir audio de prueba en canal social"
            >
              🔈 Probar
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-fg-subtle">
            Canal independiente del chat — útil para que duelos y comandos
            sociales no se mezclen con la voz de lectura general.
            Catálogo de {voices.length} voces.
          </p>
        </div>
      </fieldset>
    </div>
  );
}
