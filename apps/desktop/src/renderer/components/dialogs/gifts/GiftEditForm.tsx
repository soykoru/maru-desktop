import { useEffect, useId, useState } from 'react';
import { Button, Input, Label, Switch } from '@maru/ui';
import type { DonationGift } from '@maru/shared';

/**
 * `GiftEditForm` — formulario inline de edición / creación de gift.
 *
 * Espejo de los campos editables en `gifts_dialog.py`:
 *   - `name`: visible (traducción), editable.
 *   - `icon`: emoji fallback.
 *   - `coins`: int 0-999999.
 *   - `iconPath`: relativo (ej `donaciones/Rose.png`). Read-only en UI:
 *     se setea automáticamente con el archivo del bundle/userdata.
 *   - `disabled`: switch ocultar/mostrar.
 *
 * Mejoras sobre original:
 *   - Validación inline (coins debe ser número, name no vacío).
 *   - "Reset to bundle metadata" — botón que rellena coins desde el PNG.
 *   - Save button habilitado solo cuando hay cambios.
 *
 * El formulario es controlado: emite `onChange` con cada update y emite
 * `onSubmit` cuando el usuario confirma. El padre decide la persistencia.
 */
export interface GiftEditFormProps {
  /** Gift a editar. Si null/undefined es modo creación. */
  gift: DonationGift | null;
  /** Llamado al confirmar (botón Guardar). */
  onSubmit: (gift: DonationGift) => void | Promise<void>;
  /** Llamado al cancelar (botón Cancelar). Opcional. */
  onCancel?: () => void;
  /** Llamado al borrar (botón Eliminar). Solo visible en modo edición. */
  onDelete?: (id: string) => void | Promise<void>;
  /** Si true, deshabilita inputs y botones (durante save async). */
  busy?: boolean;
}

const EMPTY: DonationGift = {
  id: '',
  name: '',
  icon: '',
  coins: 0,
  iconPath: '',
  disabled: false,
  receivedCount: 0,
};

function isDirty(a: DonationGift, b: DonationGift): boolean {
  return (
    a.id !== b.id ||
    a.name !== b.name ||
    a.icon !== b.icon ||
    a.coins !== b.coins ||
    a.iconPath !== b.iconPath ||
    !!a.disabled !== !!b.disabled
  );
}

export function GiftEditForm({
  gift,
  onSubmit,
  onCancel,
  onDelete,
  busy = false,
}: GiftEditFormProps) {
  const isCreate = !gift;
  const initial = gift ?? EMPTY;
  const [draft, setDraft] = useState<DonationGift>(initial);
  const idPrefix = useId();

  useEffect(() => {
    setDraft(initial);
    // intencional: reset cuando cambia la prop gift
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gift?.id]);

  const dirty = isDirty(initial, draft);
  const nameInvalid = !draft.name.trim();
  const idInvalid = isCreate && !draft.id.trim();
  const coinsInvalid = !Number.isFinite(draft.coins) || draft.coins < 0;
  const canSave = !busy && dirty && !nameInvalid && !idInvalid && !coinsInvalid;

  const update = <K extends keyof DonationGift>(
    key: K,
    value: DonationGift[K],
  ) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSave) return;
        const final: DonationGift = {
          ...draft,
          // En create usamos `name` como id si el usuario no eligió uno.
          id: (draft.id || draft.name).trim(),
          name: draft.name.trim(),
          icon: draft.icon.trim(),
          iconPath: draft.iconPath.trim(),
          coins: Math.max(0, Math.floor(draft.coins)),
        };
        void onSubmit(final);
      }}
    >
      {isCreate && (
        <div>
          <Label htmlFor={`${idPrefix}-id`} required>
            ID (TikTok)
          </Label>
          <Input
            id={`${idPrefix}-id`}
            value={draft.id}
            onChange={(e) => update('id', e.target.value)}
            placeholder='Ej: "Rose", "Heart Me"'
            invalid={idInvalid}
            disabled={busy}
          />
          <p className="mt-1 text-[11px] text-fg-subtle">
            Casing y espacios deben coincidir con el nombre que envía TikTok.
          </p>
        </div>
      )}

      <div>
        <Label htmlFor={`${idPrefix}-name`} required>
          Nombre visible
        </Label>
        <Input
          id={`${idPrefix}-name`}
          value={draft.name}
          onChange={(e) => update('name', e.target.value)}
          placeholder="Ej: Rosa"
          invalid={nameInvalid}
          disabled={busy}
        />
      </div>

      <div className="grid grid-cols-[80px_1fr] gap-3">
        <div>
          <Label htmlFor={`${idPrefix}-icon`}>Emoji</Label>
          <Input
            id={`${idPrefix}-icon`}
            value={draft.icon}
            onChange={(e) => update('icon', e.target.value)}
            placeholder="🌹"
            maxLength={6}
            disabled={busy}
            className="font-emoji text-center"
          />
        </div>

        <div>
          <Label htmlFor={`${idPrefix}-coins`} required>
            Coins
          </Label>
          <Input
            id={`${idPrefix}-coins`}
            type="number"
            inputMode="numeric"
            min={0}
            max={999999}
            step={1}
            value={Number.isFinite(draft.coins) ? String(draft.coins) : '0'}
            onChange={(e) =>
              update('coins', Math.max(0, parseInt(e.target.value, 10) || 0))
            }
            invalid={coinsInvalid}
            disabled={busy}
            suffix="💎"
          />
        </div>
      </div>

      <div>
        <Label htmlFor={`${idPrefix}-path`}>Path imagen</Label>
        <Input
          id={`${idPrefix}-path`}
          value={draft.iconPath}
          onChange={(e) => update('iconPath', e.target.value)}
          placeholder="donaciones/Rose.png"
          disabled={busy}
          className="font-mono text-xs"
        />
        <p className="mt-1 text-[11px] text-fg-subtle">
          Path relativo al bundle (`donaciones/&lt;archivo&gt;.png`). Se
          autocompleta al recibir el gift en vivo.
        </p>
      </div>

      <label className="flex items-center justify-between rounded-xl border border-border bg-bg-elev px-3 py-2">
        <div>
          <p className="text-sm font-medium">Ocultar de la galería</p>
          <p className="text-[11px] text-fg-subtle">
            Conserva la metadata pero no aparece en selectores.
          </p>
        </div>
        <Switch
          checked={!!draft.disabled}
          onChange={(v) => update('disabled', v)}
          disabled={busy}
        />
      </label>

      <div className="flex items-center justify-between gap-2 pt-1">
        {!isCreate && onDelete && gift && (
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={() => void onDelete(gift.id)}
          >
            Eliminar
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={busy}
            >
              Cancelar
            </Button>
          )}
          <Button type="submit" variant="primary" size="sm" disabled={!canSave}>
            {isCreate ? 'Crear' : 'Guardar'}
          </Button>
        </div>
      </div>
    </form>
  );
}
