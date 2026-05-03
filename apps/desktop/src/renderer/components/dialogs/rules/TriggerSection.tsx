import { useEffect, useId, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { Button, Input, Label, MaruImage, Select } from '@maru/ui';
import type { RuleTriggerType } from '@maru/shared';
import { TRIGGER_KEYS, triggerMeta } from './trigger-meta.js';
import { rpcCall } from '../../../lib/rpc.js';
import { useAppStore } from '../../../lib/store/index.js';

/**
 * `TriggerSection` — selector de trigger + paneles condicionales.
 *
 * Réplica de la sección "📋 Información" + las 4 sub-secciones que
 * MARU original muestra/oculta según `event.currentData()`.
 */
export interface TriggerSectionProps {
  name: string;
  onNameChange: (v: string) => void;
  triggerType: RuleTriggerType;
  onTriggerTypeChange: (v: RuleTriggerType) => void;
  triggerValue: string;
  onTriggerValueChange: (v: string) => void;
  /** Llamado cuando el usuario clickea "Galería visual" en gift. */
  onOpenGiftGallery?: () => void;
  disabled?: boolean;
}

export function TriggerSection({
  name,
  onNameChange,
  triggerType,
  onTriggerTypeChange,
  triggerValue,
  onTriggerValueChange,
  onOpenGiftGallery,
  disabled = false,
}: TriggerSectionProps) {
  const idPrefix = useId();
  const meta = triggerMeta(triggerType);

  return (
    <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-3">
      <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
        📋 Información
      </legend>

      <div>
        <Label htmlFor={`${idPrefix}-name`} required>
          Nombre de la regla
        </Label>
        <Input
          id={`${idPrefix}-name`}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Ej: Rosa = 5 Trolls"
          disabled={disabled}
          invalid={!name.trim() && name.length > 0}
        />
      </div>

      <div>
        <Label htmlFor={`${idPrefix}-trigger`} required>
          Trigger (evento que dispara la regla)
        </Label>
        <Select
          id={`${idPrefix}-trigger`}
          value={triggerType}
          onChange={(e) => {
            onTriggerTypeChange(e.target.value as RuleTriggerType);
            onTriggerValueChange('');
          }}
          disabled={disabled}
        >
          {TRIGGER_KEYS.map((t) => {
            const m = triggerMeta(t);
            return (
              <option key={t} value={t}>
                {m.emoji} {m.label}
              </option>
            );
          })}
        </Select>
        <p className="mt-1 text-[11px] text-fg-subtle">{meta.hint}</p>
      </div>

      {/* Panel condicional: gift */}
      {triggerType === 'gift' && (
        <div className="rounded-lg border border-border bg-bg-elev p-3 space-y-2">
          <Label htmlFor={`${idPrefix}-gift`} required>
            🎁 ID del regalo TikTok
          </Label>
          <div className="flex gap-2">
            <Input
              id={`${idPrefix}-gift`}
              value={triggerValue}
              onChange={(e) => onTriggerValueChange(e.target.value)}
              placeholder="Rose, Heart Me, Galaxy..."
              disabled={disabled}
              className="font-mono text-xs"
            />
            {onOpenGiftGallery && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onOpenGiftGallery}
                disabled={disabled}
                title="Abrir galería visual de regalos"
              >
                <ImageIcon className="h-3.5 w-3.5" />
                Galería
              </Button>
            )}
          </div>
          <p className="text-[11px] text-fg-subtle">
            Escribí el id exacto del gift (case-sensitive) o usá la galería.
          </p>
        </div>
      )}

      {/* Panel condicional: like */}
      {triggerType === 'like' && (
        <div className="rounded-lg border border-border bg-bg-elev p-3 space-y-2">
          <Label htmlFor={`${idPrefix}-like`} required>
            ❤️ Activar cada N likes
          </Label>
          <Input
            id={`${idPrefix}-like`}
            type="number"
            min={1}
            max={10000}
            value={triggerValue || '10'}
            onChange={(e) => onTriggerValueChange(e.target.value)}
            disabled={disabled}
          />
          <p className="text-[11px] text-fg-subtle">
            La regla se activará cada vez que se acumulen X likes.
          </p>
        </div>
      )}

      {/* Panel condicional: like_milestone */}
      {triggerType === 'like_milestone' && (
        <div className="rounded-lg border border-border bg-bg-elev p-3 space-y-2">
          <Label htmlFor={`${idPrefix}-milestone`} required>
            🎯 Meta de likes total
          </Label>
          <Input
            id={`${idPrefix}-milestone`}
            type="number"
            min={100}
            max={1_000_000}
            step={100}
            value={triggerValue || '1000'}
            onChange={(e) => onTriggerValueChange(e.target.value)}
            disabled={disabled}
          />
          <p className="text-[11px] text-fg-subtle">
            Se activará UNA VEZ cuando el stream alcance esta meta.
          </p>
        </div>
      )}

      {/* Panel condicional: command */}
      {triggerType === 'command' && (
        <div className="rounded-lg border border-border bg-bg-elev p-3 space-y-2">
          <Label htmlFor={`${idPrefix}-cmd`} required>
            💬 Texto del comando
          </Label>
          <Input
            id={`${idPrefix}-cmd`}
            value={triggerValue}
            onChange={(e) => onTriggerValueChange(e.target.value)}
            placeholder="!spawn, !zombie, !help..."
            disabled={disabled}
            className="font-mono text-xs"
          />
        </div>
      )}

      {/* Panel condicional: emote — selector visual de emotes del streamer */}
      {triggerType === 'emote' && (
        <EmoteTriggerPanel
          value={triggerValue}
          onChange={onTriggerValueChange}
          disabled={disabled}
          idPrefix={idPrefix}
        />
      )}

      {/* Panel condicional: join — input opcional de username */}
      {triggerType === 'join' && (
        <div className="rounded-lg border border-border bg-bg-elev p-3 space-y-2">
          <Label htmlFor={`${idPrefix}-join`}>
            👋 Username del viewer (opcional)
          </Label>
          <Input
            id={`${idPrefix}-join`}
            value={triggerValue}
            onChange={(e) => onTriggerValueChange(e.target.value)}
            placeholder="Vacío = cualquier viewer · @username = solo ese"
            disabled={disabled}
            className="font-mono text-xs"
          />
          <p className="text-[11px] text-fg-subtle">
            Si lo dejás vacío, la regla dispara cada vez que CUALQUIER viewer
            entre. Si ponés un username (con o sin <code>@</code>), solo dispara
            cuando ese user específico entre.
          </p>
        </div>
      )}
    </fieldset>
  );
}

// ────────────────────────────────────────────────────────────────────
// Selector de emote del streamer (panel del trigger emote)
// ────────────────────────────────────────────────────────────────────

interface EmoteItem {
  /** ID canónico que viaja en el evento `emote` (= emoteId del manifest). */
  id: string;
  /** Path relativo al APPDATA donde está la PNG cacheada. */
  path: string;
  /** Display name opcional para tooltip. */
  name?: string;
}

interface EmoteTriggerPanelProps {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  idPrefix: string;
}

function EmoteTriggerPanel({
  value,
  onChange,
  disabled = false,
  idPrefix,
}: EmoteTriggerPanelProps) {
  const tiktokUsername = useAppStore((s) => s.tiktokUsername);
  const [emotes, setEmotes] = useState<EmoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // El RPC `emotes.list` requiere `streamer` (username TikTok activo).
    // Si todavía no hay username conectado, mostramos hint en vez de error.
    const streamer = (tiktokUsername || '').trim();
    if (!streamer) {
      setLoading(false);
      setEmotes([]);
      return;
    }
    void rpcCall('emotes.list', { streamer })
      .then((r) => {
        if (cancelled) return;
        const raw = (r as { emotes?: unknown }).emotes;
        const items: EmoteItem[] = Array.isArray(raw)
          ? (raw as Array<Record<string, unknown>>).map((it) => ({
              id: String(it.emoteId ?? ''),
              path: String(it.path ?? ''),
              name:
                typeof it.name === 'string' && it.name
                  ? (it.name as string)
                  : undefined,
            }))
          : [];
        setEmotes(items.filter((it) => it.id));
      })
      .catch((ex: unknown) => {
        if (!cancelled) {
          setError(ex instanceof Error ? ex.message : String(ex));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tiktokUsername]);

  const q = filter.trim().toLowerCase();
  const visible = q
    ? emotes.filter(
        (e) =>
          e.id.toLowerCase().includes(q) ||
          (e.name ?? '').toLowerCase().includes(q),
      )
    : emotes;

  return (
    <div className="rounded-lg border border-border bg-bg-elev p-3 space-y-2">
      <Label htmlFor={`${idPrefix}-emote`} required>
        🎨 Emote del streamer
      </Label>

      <Input
        id={`${idPrefix}-emote-search`}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Buscar por id o nombre..."
        disabled={disabled || loading}
        className="text-xs"
      />

      <Input
        id={`${idPrefix}-emote`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="ID del emote (lo llena la galería al click)"
        disabled={disabled}
        className="font-mono text-xs"
      />

      {loading && (
        <p className="text-[11px] text-fg-subtle">Cargando emotes…</p>
      )}
      {error && (
        <p className="text-[11px] text-danger">⚠ {error}</p>
      )}
      {!loading && !error && emotes.length === 0 && (
        <p className="text-[11px] text-fg-subtle">
          {tiktokUsername
            ? 'Aún no se cachearon emotes de @' +
              tiktokUsername +
              '. Conectá el live y esperá a que envíen stickers — aparecerán acá.'
            : 'Conectate al live primero para ver los emotes del streamer.'}
        </p>
      )}
      {!loading && visible.length > 0 && (
        <div
          className="grid gap-1.5 max-h-[200px] overflow-y-auto rounded border border-border-subtle bg-bg-base/40 p-1.5"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))' }}
        >
          {visible.map((e) => {
            const selected = value === e.id;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => onChange(e.id)}
                disabled={disabled}
                title={e.name ?? e.id}
                className={[
                  'relative flex aspect-square items-center justify-center rounded-md border transition-all',
                  selected
                    ? 'border-accent bg-accent/15 ring-2 ring-accent/40'
                    : 'border-border bg-bg-elev hover:border-fg-muted',
                ].join(' ')}
              >
                {e.path ? (
                  <MaruImage
                    src={e.path}
                    alt={e.name ?? e.id}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-[10px] text-fg-subtle font-mono truncate px-1">
                    {e.id.slice(0, 6)}
                  </span>
                )}
                {selected && (
                  <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-accent text-[8px] font-bold text-white grid place-items-center">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-fg-subtle">
        Click en cualquier emote para usarlo como trigger. La regla dispara
        cuando un viewer envíe ese emote exacto del streamer.
      </p>
    </div>
  );
}
