import { useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input, Label } from '@maru/ui';
import type { TtsVoice } from '@maru/shared';

/**
 * `VoiceSelector` — combo de voces con búsqueda + group por familia.
 *
 * Reusable: VoicesDialog, SocialConfigDialog, RuleDialog (TTS section
 * G6), Sidebar TTS GroupBox.
 *
 * Mejoras vs MARU original (que usaba `QComboBox` plano con 74 items):
 *   - Search inline filtra por id, name y familia.
 *   - Optgroup nativo del `<select>` para agrupar visualmente.
 *   - Voz actual visible como label arriba del select.
 */
export interface VoiceSelectorProps {
  voices: TtsVoice[];
  families: Record<string, string>;
  value: string;
  onChange: (voiceId: string) => void;
  /** Texto del label superior. Si null, no se muestra. */
  label?: string | null;
  /** Placeholder cuando no hay voz seleccionada. */
  placeholder?: string;
  disabled?: boolean;
  /** Si true, muestra search box arriba del select. Default true. */
  searchable?: boolean;
  /** Inserta opción "(default del sistema)" con value vacío. */
  allowEmpty?: boolean;
  emptyLabel?: string;
}

export function VoiceSelector({
  voices,
  families,
  value,
  onChange,
  label = 'Voz',
  placeholder = '-- elegir voz --',
  disabled = false,
  searchable = true,
  allowEmpty = false,
  emptyLabel = '🎙️ Voz por defecto del sistema',
}: VoiceSelectorProps) {
  const idPrefix = useId();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return voices;
    return voices.filter(
      (v) =>
        v.id.toLowerCase().includes(q) ||
        v.name.toLowerCase().includes(q) ||
        (families[v.family] ?? v.family).toLowerCase().includes(q),
    );
  }, [voices, search, families]);

  const grouped = useMemo(() => {
    const out: Record<string, TtsVoice[]> = {};
    for (const v of filtered) {
      (out[v.family] ??= []).push(v);
    }
    return out;
  }, [filtered]);

  const familyOrder = useMemo(() => {
    // Mantener un orden estable: popular primero, luego alfabético.
    const keys = Object.keys(grouped);
    keys.sort((a, b) => {
      if (a === 'popular') return -1;
      if (b === 'popular') return 1;
      const la = families[a] ?? a;
      const lb = families[b] ?? b;
      return la.localeCompare(lb);
    });
    return keys;
  }, [grouped, families]);

  return (
    <div className="space-y-1.5">
      {label && (
        <Label htmlFor={`${idPrefix}-sel`}>
          {label}
          {value && (
            <span className="ml-2 text-[11px] text-fg-subtle font-mono">
              {value}
            </span>
          )}
        </Label>
      )}

      {searchable && (
        <Input
          prefix={<Search className="h-3 w-3" />}
          placeholder={`Buscar entre ${voices.length} voces...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={disabled}
          className="h-8 text-xs"
        />
      )}

      <select
        id={`${idPrefix}-sel`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="maru-input w-full text-sm"
      >
        {!value && <option value="">{placeholder}</option>}
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {familyOrder.map((fid) => (
          <optgroup key={fid} label={families[fid] ?? fid.toUpperCase()}>
            {grouped[fid]?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </optgroup>
        ))}
        {/* Si el value actual no está en la lista filtrada/catálogo, anclar al final. */}
        {value && !voices.some((v) => v.id === value) && (
          <option value={value}>{value}</option>
        )}
      </select>

      {filtered.length === 0 && search && (
        <p className="text-[11px] text-fg-subtle italic">
          Sin coincidencias para "{search}".
        </p>
      )}
    </div>
  );
}
