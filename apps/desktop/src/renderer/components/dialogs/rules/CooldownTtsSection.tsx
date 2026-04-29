import { useId } from 'react';
import { Input, Label, Select, Switch, TextArea } from '@maru/ui';

/**
 * `CooldownTtsSection` — secciones 8 + 9 + 6 del MARU original.
 *
 * Combina cooldown + TTS + allowed_users en un solo fieldset compacto.
 *
 * Mejora vs MARU original: las 3 sub-secciones (cooldown, TTS, allowed
 * users) están agrupadas en un solo bloque colapsable mental, en vez
 * de 3 GroupBox separados verticalmente.
 */

const DEFAULT_VOICES = [
  { id: 'es_mx_002', name: '⭐ Español México' },
  { id: 'en_us_001', name: '🇺🇸 English US Female' },
  { id: 'en_female_madam_leota', name: '🔮 Madame Leota' },
  { id: 'en_male_narration', name: '🎙️ Narrator' },
  { id: 'es_es_male_male_001', name: '🇪🇸 Español España' },
];

export interface CooldownTtsSectionProps {
  cooldown: number;
  onCooldownChange: (n: number) => void;
  ttsEnabled: boolean;
  onTtsEnabledChange: (v: boolean) => void;
  ttsMessage: string;
  onTtsMessageChange: (s: string) => void;
  ttsVoice: string;
  onTtsVoiceChange: (s: string) => void;
  allowedUsers: string[];
  onAllowedUsersChange: (users: string[]) => void;
  /** Voces disponibles. Default: 5 más comunes. */
  voices?: { id: string; name: string }[];
  disabled?: boolean;
}

export function CooldownTtsSection({
  cooldown,
  onCooldownChange,
  ttsEnabled,
  onTtsEnabledChange,
  ttsMessage,
  onTtsMessageChange,
  ttsVoice,
  onTtsVoiceChange,
  allowedUsers,
  onAllowedUsersChange,
  voices = DEFAULT_VOICES,
  disabled = false,
}: CooldownTtsSectionProps) {
  const idPrefix = useId();
  const usersText = allowedUsers.join(', ');

  function parseUsers(raw: string): string[] {
    return raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }

  return (
    <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-3">
      <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
        ⏱️ Cooldown · 🔊 TTS · 👤 Usuarios
      </legend>

      {/* Cooldown */}
      <div className="grid grid-cols-[1fr_120px] gap-3 items-end">
        <div>
          <Label htmlFor={`${idPrefix}-cd`}>Cooldown entre activaciones</Label>
          <p className="text-[11px] text-fg-subtle">
            Tiempo mínimo (en segundos) entre dos disparos consecutivos. 0 = sin cooldown.
          </p>
        </div>
        <Input
          id={`${idPrefix}-cd`}
          type="number"
          min={0}
          max={3600}
          value={String(cooldown)}
          onChange={(e) =>
            onCooldownChange(
              Math.max(0, Math.min(3600, parseInt(e.target.value, 10) || 0)),
            )
          }
          disabled={disabled}
          suffix="seg"
        />
      </div>

      {/* TTS */}
      <div className="rounded-lg border border-border bg-bg-elev p-3 space-y-2">
        <Switch
          checked={ttsEnabled}
          onChange={onTtsEnabledChange}
          disabled={disabled}
          label="🔊 Activar TTS para esta regla"
          description="Lee un mensaje cuando la regla se dispara."
        />

        {ttsEnabled && (
          <div className="space-y-2 pt-1">
            <div>
              <Label htmlFor={`${idPrefix}-tts-msg`}>Mensaje (variables)</Label>
              <Input
                id={`${idPrefix}-tts-msg`}
                value={ttsMessage}
                onChange={(e) => onTtsMessageChange(e.target.value)}
                placeholder="{user} envió {gift}"
                disabled={disabled}
                className="font-mono text-xs"
              />
              <p className="mt-1 text-[11px] text-fg-subtle">
                Variables: {'{user}'}, {'{username}'}, {'{gift}'}, {'{amount}'}.
              </p>
            </div>
            <div>
              <Label htmlFor={`${idPrefix}-tts-voice`}>Voz</Label>
              <Select
                id={`${idPrefix}-tts-voice`}
                value={ttsVoice}
                onChange={(e) => onTtsVoiceChange(e.target.value)}
                disabled={disabled}
              >
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
                {/* fallback si la voz actual no está en la lista */}
                {!voices.some((v) => v.id === ttsVoice) && ttsVoice && (
                  <option value={ttsVoice}>{ttsVoice}</option>
                )}
              </Select>
            </div>
          </div>
        )}
      </div>

      {/* Allowed users */}
      <div className="rounded-lg border border-border bg-bg-elev p-3 space-y-2">
        <Switch
          checked={allowedUsers.length > 0}
          onChange={(v) =>
            onAllowedUsersChange(
              v ? (allowedUsers.length > 0 ? allowedUsers : ['']) : [],
            )
          }
          disabled={disabled}
          label="👤 Solo permitir usuarios específicos"
          description="Si está activo, la regla solo dispara para los usernames listados."
        />

        {allowedUsers.length > 0 && (
          <div>
            <Label htmlFor={`${idPrefix}-users`}>Usernames (separados por coma)</Label>
            <TextArea
              id={`${idPrefix}-users`}
              value={usersText}
              onChange={(e) =>
                onAllowedUsersChange(parseUsers(e.target.value))
              }
              placeholder="usuario1, usuario2, usuario3..."
              disabled={disabled}
              className="text-xs min-h-[50px]"
            />
            <p className="mt-1 text-[11px] text-fg-subtle">
              Se normalizan a lowercase. Vacío = todos permitidos.
            </p>
          </div>
        )}
      </div>
    </fieldset>
  );
}
