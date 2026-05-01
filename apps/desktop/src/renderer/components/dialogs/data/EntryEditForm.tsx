import { useEffect, useId, useState } from 'react';
import { ImageIcon, Loader2, Play, Trash2, Upload } from 'lucide-react';
import { Button, Input, Label, MaruImage, TextArea } from '@maru/ui';
import type { DataEntry, DataKind, GameId } from '@maru/shared';
import { rpcCall } from '../../../lib/rpc.js';

// Mapa de DataKind ('entities'/'items'/'events'/'valuables') →
// carpeta donde se guarda la imagen en el bundle. Sigue la convención
// de game_images/<gid>/<categoryFolder>/<command>.png.
const KIND_TO_FOLDER: Record<string, string> = {
  entities: 'entities',
  items: 'items',
  events: 'events',
  valuables: 'valuables',
};

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
  gameId,
  kind,
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
  const [imageBust, setImageBust] = useState(0);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageFlash, setImageFlash] = useState<string | null>(null);
  const idPrefix = useId();
  const folder = KIND_TO_FOLDER[String(kind)] ?? String(kind);

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

  async function handleUploadImage() {
    if (!draft.command.trim() || !gameId || !folder) {
      setImageFlash('Definí primero el Comando para guardar la imagen');
      window.setTimeout(() => setImageFlash(null), 3000);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const path = window.maruApi.getPathForFile(file);
      if (!path) {
        setImageFlash('No pude obtener el path absoluto del archivo');
        window.setTimeout(() => setImageFlash(null), 3000);
        return;
      }
      setImageBusy(true);
      try {
        const r = await rpcCall('images.set-entry-image', {
          gameId,
          category: folder,
          command: draft.command.trim(),
          sourcePath: path,
        });
        if (r.ok) {
          setImageBust(Date.now());
          setImageFlash('✓ Imagen actualizada');
        } else {
          setImageFlash(`✗ ${r.message ?? 'no se pudo guardar'}`);
        }
      } catch (ex) {
        setImageFlash(ex instanceof Error ? ex.message : String(ex));
      } finally {
        setImageBusy(false);
        window.setTimeout(() => setImageFlash(null), 3000);
      }
    };
    input.click();
  }

  async function handleDeleteImage() {
    if (!draft.command.trim() || !gameId || !folder) return;
    if (!confirm('¿Quitar la imagen custom y volver a la del bundle/default?')) return;
    setImageBusy(true);
    try {
      const r = await rpcCall('images.delete-entry-image', {
        gameId,
        category: folder,
        command: draft.command.trim(),
      });
      if (r.ok) {
        setImageBust(Date.now());
        setImageFlash(
          r.removed ? '✓ Imagen quitada' : 'No había imagen custom',
        );
      }
    } catch (ex) {
      setImageFlash(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setImageBusy(false);
      window.setTimeout(() => setImageFlash(null), 3000);
    }
  }

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
      {/* Imagen del entry — se guarda en USERDATA_GAME_IMAGES_DIR/<gid>/<cat>/<command>.<ext>
          y aparece en la lista de Datos / acciones de reglas / etc.
          Antes solo se podía cambiar editando archivos del bundle a mano
          (lo que el user pidió como "como el MARU antiguo"). */}
      {gameId && folder && (
        <div className="rounded-lg border border-border bg-bg-elev/30 p-3">
          <div className="flex items-center gap-3">
            <div className="shrink-0 flex h-16 w-16 items-center justify-center rounded-md bg-bg-base/40 overflow-hidden">
              {draft.command.trim() ? (
                <MaruImage
                  scope="game"
                  // Bust el cache cuando subimos una imagen nueva.
                  path={`${gameId}/${folder}/${draft.command.trim()}.png${imageBust ? `?v=${imageBust}` : ''}`}
                  alt={draft.name || draft.command}
                  width={64}
                  height={64}
                  fallback={{
                    scope: 'game',
                    path: `${gameId}/${folder}/_default_${folder}.png`,
                  }}
                  className="object-contain max-w-[64px] max-h-[64px]"
                />
              ) : (
                <ImageIcon className="h-6 w-6 text-fg-subtle" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <Label>Imagen del entry</Label>
              <p className="text-[11px] text-fg-subtle leading-snug">
                {draft.command.trim()
                  ? 'Click "Cambiar" para subir tu propio PNG/JPG. Se sobrepone a la imagen del bundle.'
                  : 'Definí el comando primero — la imagen se guarda como <command>.png.'}
              </p>
              {imageFlash && (
                <p
                  className={
                    'text-[10px] mt-1 ' +
                    (imageFlash.startsWith('✗') ||
                    imageFlash.startsWith('No pude')
                      ? 'text-danger'
                      : 'text-success')
                  }
                >
                  {imageFlash}
                </p>
              )}
            </div>
            <div className="shrink-0 flex flex-col gap-1.5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void handleUploadImage()}
                disabled={busy || imageBusy || !draft.command.trim()}
                title="Subir imagen custom para este entry"
              >
                {imageBusy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Upload className="h-3 w-3" />
                )}
                Cambiar
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleDeleteImage()}
                disabled={busy || imageBusy || !draft.command.trim()}
                title="Quitar imagen custom (vuelve al default)"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      )}

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
