import { useEffect, useId, useState } from 'react';
import { Button, Dialog, Input, Label, Select, Switch } from '@maru/ui';
import type { GameId } from '@maru/shared';
import { useGames } from '../../../lib/use-games.js';

/**
 * `NewProfileDialog` — modal mínimo para duplicar/crear perfil de juego.
 *
 * Réplica de `profile_dialog.py:NewProfileDialog`:
 *   - profile_id (normalizado: lower + spaces→_).
 *   - profile_name (vacío → fallback a id.title()).
 *   - base_profile (combo: Vacío + lista de existentes).
 *   - share_sounds, share_voices.
 *
 * Al confirmar llama `games.duplicate` que copia data y crea rules vacías.
 *
 * Mejoras sobre original:
 *   - Validación inline + indicador de id duplicado en vivo.
 *   - Auto-trim del id mientras escribe.
 */
export interface NewProfileDialogProps {
  open: boolean;
  onClose: () => void;
  /** Llamado tras crear OK con el id del nuevo perfil. */
  onCreated?: (newId: GameId) => void;
}

function normalizeId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '');
}

export function NewProfileDialog({
  open,
  onClose,
  onCreated,
}: NewProfileDialogProps) {
  const { games, duplicate } = useGames({ autoLoad: false });

  const [rawId, setRawId] = useState('');
  const [name, setName] = useState('');
  const [base, setBase] = useState<GameId | 'empty'>('empty');
  const [shareSounds, setShareSounds] = useState(true);
  const [shareVoices, setShareVoices] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idPrefix = useId();

  useEffect(() => {
    if (open) {
      setRawId('');
      setName('');
      setBase('empty');
      setShareSounds(true);
      setShareVoices(true);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const normalizedId = normalizeId(rawId);
  const idTooShort = normalizedId.length < 2;
  const idDuplicate = games.some((g) => g.id.toLowerCase() === normalizedId);
  const idInvalid = idTooShort || idDuplicate;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (idInvalid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const finalName = name.trim() || normalizedId.replace(/_/g, ' ');
      const profile = await duplicate(
        base,
        normalizedId,
        finalName,
        shareSounds,
        shareVoices,
      );
      onCreated?.(profile.id);
      onClose();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title="🎮 Crear Nuevo Perfil de Juego"
      description="Duplicá un perfil existente o empezá vacío."
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <Label htmlFor={`${idPrefix}-id`} required>
            ID del perfil
          </Label>
          <Input
            id={`${idPrefix}-id`}
            value={rawId}
            onChange={(e) => setRawId(e.target.value)}
            placeholder="ej: ark, rust, 7days..."
            invalid={idInvalid && rawId.length > 0}
            disabled={busy}
            autoFocus
          />
          {rawId && normalizedId !== rawId.trim() && (
            <p className="mt-1 text-[11px] text-fg-subtle">
              Se guardará como <code>{normalizedId || '—'}</code>
            </p>
          )}
          {idDuplicate && (
            <p className="mt-1 text-[11px] text-danger">
              Ya existe un perfil con ese id.
            </p>
          )}
          {idTooShort && rawId.length > 0 && !idDuplicate && (
            <p className="mt-1 text-[11px] text-warning">
              Mínimo 2 caracteres alfanuméricos.
            </p>
          )}
        </div>

        <div>
          <Label htmlFor={`${idPrefix}-name`}>Nombre visible</Label>
          <Input
            id={`${idPrefix}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={normalizedId ? `Default: ${normalizedId.replace(/_/g, ' ')}` : 'ARK Survival, Rust, 7 Days...'}
            disabled={busy}
          />
        </div>

        <div>
          <Label htmlFor={`${idPrefix}-base`}>Copiar datos de</Label>
          <Select
            id={`${idPrefix}-base`}
            value={base}
            onChange={(e) => setBase(e.target.value as GameId | 'empty')}
            disabled={busy}
          >
            <option value="empty">🆕 Vacío (sin datos)</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.icon} {g.name}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-[11px] text-fg-subtle">
            Copia entidades, items y eventos del perfil base. Las reglas se
            crean vacías siempre.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-bg-elev p-3 space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-fg-subtle">
            Configuración compartida
          </p>
          <Switch
            checked={shareSounds}
            onChange={setShareSounds}
            disabled={busy}
            label="🔔 Usar sonidos globales"
            description="Si lo desactivás, este perfil tendrá su propio set."
          />
          <Switch
            checked={shareVoices}
            onChange={setShareVoices}
            disabled={busy}
            label="🎤 Usar voces globales"
            description="Idem para las voces TTS por usuario."
          />
        </div>

        {error && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={idInvalid || busy}
          >
            ✅ Crear Perfil
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
