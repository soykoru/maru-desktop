import { useEffect, useId, useState } from 'react';
import { Loader2, Play, Trash2 } from 'lucide-react';
import { Button, Input, Label, TextArea } from '@maru/ui';
import type { DataEntry, DataKind, GameId } from '@maru/shared';

/**
 * `EntryEditForm` — form inline para create/edit de un entry.
 *
 * Espejo del panel derecho del `DataDialog`:
 *   - `name` (display).
 *   - `command` — `Input` para items/entities, `TextArea` para events
 *     o juegos RCON (Minecraft / customs RCON), tal cual el original.
 *   - Botón "Probar" llama `onTest` y muestra el resultado inline.
 */
export interface EntryEditFormProps {
  entry: DataEntry | null;
  /** Si true → command como TextArea multilínea (events / RCON). */
  multilineCommand: boolean;
  gameId: GameId;
  kind: DataKind;
  onSubmit: (entry: DataEntry, previousName?: string) => void | Promise<void>;
  onCancel?: () => void;
  onDelete?: (name: string) => void | Promise<void>;
  /** Llama al juego real (spawn/give_item/trigger_event). */
  onTest?: (entry: DataEntry) => Promise<{ ok: boolean; message: string }>;
  busy?: boolean;
}

const EMPTY: DataEntry = { name: '', command: '' };

export function EntryEditForm({
  entry,
  multilineCommand,
  onSubmit,
  onCancel,
  onDelete,
  onTest,
  busy = false,
}: EntryEditFormProps) {
  const isCreate = !entry;
  const initial = entry ?? EMPTY;
  const [draft, setDraft] = useState<DataEntry>(initial);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] =
    useState<{ ok: boolean; message: string } | null>(null);
  const idPrefix = useId();

  useEffect(() => {
    setDraft(initial);
    setTestResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.name]);

  const nameInvalid = !draft.name.trim();
  const commandInvalid = !draft.command.trim();
  const dirty =
    draft.name !== initial.name || draft.command !== initial.command;
  const canSave = !busy && !nameInvalid && !commandInvalid && (isCreate || dirty);

  async function handleTest() {
    if (!onTest) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await onTest({
        ...draft,
        name: draft.name.trim() || draft.command.trim(),
        command: draft.command.trim(),
      });
      setTestResult(res);
    } catch (ex) {
      setTestResult({
        ok: false,
        message: ex instanceof Error ? ex.message : String(ex),
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSave) return;
        const final: DataEntry = {
          ...draft,
          name: draft.name.trim(),
          command: draft.command.trim(),
        };
        void onSubmit(final, isCreate ? undefined : initial.name);
      }}
    >
      <div>
        <Label htmlFor={`${idPrefix}-name`} required>
          Nombre visible
        </Label>
        <Input
          id={`${idPrefix}-name`}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Ej: Troll Furioso"
          invalid={nameInvalid && draft.name.length > 0}
          disabled={busy}
        />
      </div>

      <div>
        <Label htmlFor={`${idPrefix}-cmd`} required>
          {multilineCommand ? 'Comando(s)' : 'Comando / ID del juego'}
        </Label>
        {multilineCommand ? (
          <TextArea
            id={`${idPrefix}-cmd`}
            value={draft.command}
            onChange={(e) => setDraft({ ...draft, command: e.target.value })}
            placeholder={
              'Comando(s) RCON — uno por línea\n\nVariables: {user}, {username}'
            }
            invalid={commandInvalid && draft.command.length > 0}
            disabled={busy}
            className="font-mono text-xs min-h-[90px]"
          />
        ) : (
          <Input
            id={`${idPrefix}-cmd`}
            value={draft.command}
            onChange={(e) => setDraft({ ...draft, command: e.target.value })}
            placeholder="Troll, SwordIron, raid_boss..."
            invalid={commandInvalid && draft.command.length > 0}
            disabled={busy}
            className="font-mono text-xs"
          />
        )}
      </div>

      {testResult && (
        <div
          aria-live="polite"
          className={
            'rounded-md px-3 py-2 text-xs ' +
            (testResult.ok
              ? 'border border-success/40 bg-success/10 text-success'
              : 'border border-danger/40 bg-danger/10 text-danger')
          }
        >
          {testResult.message || (testResult.ok ? 'OK' : 'Fallo')}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex gap-2">
          {!isCreate && onDelete && entry && (
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => void onDelete(entry.name)}
              title="Eliminar entrada"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
          {onTest && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy || testing || commandInvalid}
              onClick={() => void handleTest()}
              title="Disparar acción real contra el juego"
            >
              {testing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              Probar
            </Button>
          )}
        </div>

        <div className="flex gap-2">
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
