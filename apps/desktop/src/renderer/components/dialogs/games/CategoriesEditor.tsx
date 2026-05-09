import { useEffect, useId, useState } from 'react';
import { Plus, Trash2, Upload, Trash } from 'lucide-react';
import { Button, Input, Label, MaruImage, Select, TextArea } from '@maru/ui';
import type { GameCategory } from '@maru/shared';
import { rpcCall } from '../../../lib/rpc.js';

/**
 * Editor de categorías custom — list + form en vivo (live-update).
 *
 * Espejo de la sección "📁 Categorías de Datos" + "⚙️ Configuración de
 * Categoría Seleccionada" del MARU original.
 *
 * Cambios en cualquier input emiten `onChange(nextArray)` inmediato
 * (live-update — paridad MARU).
 */
export interface CategoriesEditorProps {
  categories: GameCategory[];
  onChange: (next: GameCategory[]) => void;
  /** Tipo conexión actual — afecta qué inputs se muestran. */
  connectionType: 'http' | 'rcon';
  disabled?: boolean;
  /** v1.0.82: gameId del juego en edición — necesario para escribir la
   * imagen default por categoría al filesystem. Si no se pasa, el
   * selector de imagen se oculta (modo "creación nueva sin id aún"). */
  gameId?: string;
}

/** v1.0.82: templates predefinidos por tipo de categoría.
 * Cada tipo sugiere un template "natural" pero el user puede elegir
 * cualquiera de los 4 + custom upload.
 */
const CATEGORY_TEMPLATES: Array<{ id: string; emoji: string; label: string; type: GameCategory['type'] }> = [
  { id: 'zombie', emoji: '🧟', label: 'Zombie/Mob', type: 'entity' },
  { id: 'sword', emoji: '⚔️', label: 'Arma/Item', type: 'item' },
  { id: 'lightning', emoji: '⚡', label: 'Evento', type: 'event' },
  { id: 'gem', emoji: '💎', label: 'Valuable', type: 'valuable' },
];

const CAT_TYPES: GameCategory['type'][] = [
  'entity',
  'item',
  'event',
  'valuable',
];
const TYPE_ICON: Record<GameCategory['type'], string> = {
  entity: '🐉',
  item: '📦',
  event: '⚡',
  valuable: '💎',
};

function makeNewCategory(existing: GameCategory[]): GameCategory {
  let n = existing.length + 1;
  let id = `category_${n}`;
  while (existing.some((c) => c.id === id)) {
    n += 1;
    id = `category_${n}`;
  }
  return {
    id,
    name: `Categoría ${n}`,
    type: 'entity',
    icon: '📦',
    dataKey: id,
    endpoint: '/spawn',
    payload: '{"name": "{entity}", "amount": {amount}}',
    rconCmd: '',
    tutorial: '',
  };
}

export function CategoriesEditor({
  categories,
  onChange,
  connectionType,
  disabled = false,
  gameId,
}: CategoriesEditorProps) {
  const [selectedIdx, setSelectedIdx] = useState<number>(
    categories.length > 0 ? 0 : -1,
  );
  const idPrefix = useId();
  // v1.0.82: cache-bust para forzar re-fetch de la imagen default tras cambio.
  const [imageBust, setImageBust] = useState(0);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  // Si la lista cambia y el selected queda fuera de rango, ajustar.
  useEffect(() => {
    if (categories.length === 0) {
      setSelectedIdx(-1);
    } else if (selectedIdx >= categories.length) {
      setSelectedIdx(categories.length - 1);
    } else if (selectedIdx === -1) {
      setSelectedIdx(0);
    }
  }, [categories.length, selectedIdx]);

  const selected = selectedIdx >= 0 ? categories[selectedIdx] : null;

  const updateSelected = (patch: Partial<GameCategory>) => {
    if (selectedIdx < 0) return;
    const current = categories[selectedIdx];
    if (!current) return;
    const next = categories.slice();
    next[selectedIdx] = { ...current, ...patch };
    onChange(next);
  };

  const addCategory = () => {
    const next = [...categories, makeNewCategory(categories)];
    onChange(next);
    setSelectedIdx(next.length - 1);
  };

  const deleteCategory = () => {
    if (selectedIdx < 0) return;
    const next = categories.filter((_, i) => i !== selectedIdx);
    onChange(next);
    setSelectedIdx(Math.max(0, selectedIdx - 1));
  };

  /** v1.0.82: setea uno de los templates predefinidos como _default_<cat>.png. */
  async function applyTemplate(templateName: string) {
    if (!gameId || !selected || imageBusy) return;
    setImageBusy(true);
    setImageError(null);
    try {
      const res = (await rpcCall('images.set-category-default', {
        gameId,
        category: selected.id,
        templateName,
      })) as { ok: boolean; message?: string };
      if (!res.ok) {
        setImageError(res.message || 'No se pudo aplicar el template');
        return;
      }
      setImageBust((b) => b + 1);
    } catch (ex) {
      setImageError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setImageBusy(false);
    }
  }

  /** v1.0.82: file picker → upload a _default_<cat>.png. */
  async function uploadCustom() {
    if (!gameId || !selected || imageBusy) return;
    setImageBusy(true);
    setImageError(null);
    try {
      const picked = await window.maruApi.dialog.openFile({
        title: `Imagen default para "${selected.name}"`,
        filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      });
      if (!picked.ok || !picked.path) return;
      const res = (await rpcCall('images.set-category-default', {
        gameId,
        category: selected.id,
        sourcePath: picked.path,
      })) as { ok: boolean; message?: string };
      if (!res.ok) {
        setImageError(res.message || 'No se pudo subir la imagen');
        return;
      }
      setImageBust((b) => b + 1);
    } catch (ex) {
      setImageError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setImageBusy(false);
    }
  }

  /** v1.0.82: borra el _default_<cat>.png custom (vuelve al del bundle). */
  async function removeDefault() {
    if (!gameId || !selected || imageBusy) return;
    setImageBusy(true);
    setImageError(null);
    try {
      await rpcCall('images.delete-category-default', {
        gameId,
        category: selected.id,
      });
      setImageBust((b) => b + 1);
    } catch (ex) {
      setImageError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setImageBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-[180px_1fr] gap-3">
      {/* List */}
      <div className="flex flex-col gap-1.5">
        <div
          className="flex flex-col gap-1 rounded-lg border border-border bg-bg-elev p-1.5 max-h-[240px] overflow-y-auto"
          role="listbox"
          aria-label="Categorías"
        >
          {categories.length === 0 && (
            <p className="text-[11px] text-fg-subtle italic px-2 py-3 text-center">
              Sin categorías. Pulsá <strong>+</strong> para crear una.
            </p>
          )}
          {categories.map((c, i) => (
            <button
              key={c.id + i}
              type="button"
              role="option"
              aria-selected={i === selectedIdx}
              disabled={disabled}
              onClick={() => setSelectedIdx(i)}
              className={[
                'flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md text-left',
                'transition-colors',
                i === selectedIdx
                  ? 'bg-accent/20 text-fg ring-1 ring-accent/40'
                  : 'text-fg-muted hover:bg-fg/5',
              ].join(' ')}
            >
              <span className="font-emoji">{c.icon}</span>
              <span className="flex-1 truncate">{c.name}</span>
              <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
                {c.type}
              </span>
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={addCategory}
            disabled={disabled}
            className="flex-1"
          >
            <Plus className="h-3 w-3" />
            Añadir
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={deleteCategory}
            disabled={disabled || selectedIdx < 0}
            title="Eliminar categoría seleccionada"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Form */}
      <div className="rounded-lg border border-border bg-bg-elev p-3 space-y-2">
        {!selected ? (
          <p className="text-xs text-fg-subtle italic">
            Seleccioná una categoría para editar sus campos.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor={`${idPrefix}-cat-name`}>Nombre</Label>
                <Input
                  id={`${idPrefix}-cat-name`}
                  value={selected.name}
                  onChange={(e) => updateSelected({ name: e.target.value })}
                  disabled={disabled}
                />
              </div>
              <div>
                <Label htmlFor={`${idPrefix}-cat-icon`}>Emoji</Label>
                <Input
                  id={`${idPrefix}-cat-icon`}
                  value={selected.icon}
                  onChange={(e) => updateSelected({ icon: e.target.value })}
                  maxLength={4}
                  disabled={disabled}
                  className="font-emoji text-center"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor={`${idPrefix}-cat-type`}>Tipo</Label>
                <Select
                  id={`${idPrefix}-cat-type`}
                  value={selected.type}
                  onChange={(e) =>
                    updateSelected({
                      type: e.target.value as GameCategory['type'],
                      icon:
                        selected.icon ||
                        TYPE_ICON[e.target.value as GameCategory['type']],
                    })
                  }
                  disabled={disabled}
                >
                  {CAT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_ICON[t]} {t}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor={`${idPrefix}-cat-dk`}>Data key</Label>
                <Input
                  id={`${idPrefix}-cat-dk`}
                  value={selected.dataKey}
                  onChange={(e) => updateSelected({ dataKey: e.target.value })}
                  disabled={disabled}
                  className="font-mono text-xs"
                />
              </div>
            </div>

            {connectionType === 'http' ? (
              <>
                <div>
                  <Label htmlFor={`${idPrefix}-cat-ep`}>
                    Endpoint HTTP
                  </Label>
                  <Input
                    id={`${idPrefix}-cat-ep`}
                    value={selected.endpoint}
                    onChange={(e) =>
                      updateSelected({ endpoint: e.target.value })
                    }
                    placeholder="/spawn, /item, /event..."
                    disabled={disabled}
                    className="font-mono text-xs"
                  />
                </div>
                <div>
                  <Label htmlFor={`${idPrefix}-cat-pl`}>
                    Body template (JSON)
                  </Label>
                  <TextArea
                    id={`${idPrefix}-cat-pl`}
                    value={selected.payload}
                    onChange={(e) => updateSelected({ payload: e.target.value })}
                    placeholder='{"entity_name": "{entity}", "amount": {amount}}'
                    disabled={disabled}
                    className="font-mono text-xs min-h-[60px]"
                  />
                </div>
              </>
            ) : (
              // v1.0.77: para juegos RCON, NO se muestra template ni
              // endpoint/payload — cada entry de la categoría es un
              // comando RCON completo (mismo paradigma que Minecraft).
              // El user agrega/edita los comandos directamente en el
              // dialog de Datos.
              <div className="rounded-lg border border-success/30 bg-success/5 p-2.5 text-[11px] text-fg-muted leading-relaxed">
                <p className="font-semibold text-success mb-1">
                  🎮 RCON · cada acción es un comando crudo
                </p>
                <p>
                  Las entradas que agregás en <strong>Datos</strong> de esta categoría
                  son <strong>comandos RCON completos</strong>. Variables permitidas:{' '}
                  <code className="font-mono text-fg">{'{user}'}</code>,{' '}
                  <code className="font-mono text-fg">{'{amount}'}</code>.
                </p>
                <p className="mt-1">
                  Ejemplo: <code className="font-mono text-fg">{'createhorde 10 "{user}"'}</code>{' '}
                  o <code className="font-mono text-fg">summon Rex_Character_BP_C</code>.
                </p>
              </div>
            )}

            <div>
              <Label
                htmlFor={`${idPrefix}-cat-tut`}
                hint="Variables: {entity} {amount} {user} {command} {value}"
              >
                Tutorial
              </Label>
              <TextArea
                id={`${idPrefix}-cat-tut`}
                value={selected.tutorial}
                onChange={(e) => updateSelected({ tutorial: e.target.value })}
                placeholder="Texto de ayuda mostrado al usuario..."
                disabled={disabled}
                className="text-xs min-h-[50px]"
              />
            </div>

            {/* v1.0.82: imagen default de la categoría — se muestra cuando
                un item de la categoría no tiene PNG propio. 4 templates
                predefinidos + upload custom. Solo si gameId existe. */}
            {gameId && (
              <div className="rounded-lg border border-border bg-bg-elev/40 p-2.5">
                <div className="flex items-start gap-2.5">
                  {/* Preview imagen actual (con cache-bust) */}
                  <div className="flex-shrink-0">
                    <Label>Imagen default</Label>
                    <div className="mt-1 h-14 w-14 rounded-md border border-border bg-bg overflow-hidden flex items-center justify-center">
                      <MaruImage
                        key={`${gameId}-${selected.id}-${imageBust}`}
                        scope="game"
                        path={`${gameId}/${selected.id}/_default_${selected.id}.png`}
                        alt="default"
                        className="h-full w-full object-contain"
                        fallback={<span className="text-xl font-emoji">{selected.icon}</span>}
                      />
                    </div>
                  </div>

                  {/* Botones de templates + upload */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-fg-subtle leading-tight mb-1.5">
                      Se muestra cuando un item no tiene PNG propio.
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {CATEGORY_TEMPLATES.map((tpl) => (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => applyTemplate(tpl.id)}
                          disabled={disabled || imageBusy}
                          title={tpl.label}
                          className={[
                            'flex items-center gap-1 px-2 py-1 text-[11px] rounded-md',
                            'border border-border bg-bg-elev hover:bg-fg/5 hover:border-accent/50',
                            'transition-colors disabled:opacity-50',
                          ].join(' ')}
                        >
                          <span className="font-emoji text-sm">{tpl.emoji}</span>
                          <span>{tpl.id}</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={uploadCustom}
                        disabled={disabled || imageBusy}
                        title="Subir imagen propia"
                        className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border border-border bg-bg-elev hover:bg-fg/5 hover:border-accent/50 transition-colors disabled:opacity-50"
                      >
                        <Upload className="h-3 w-3" />
                        Subir
                      </button>
                      <button
                        type="button"
                        onClick={removeDefault}
                        disabled={disabled || imageBusy}
                        title="Borrar imagen custom (vuelve al default del bundle)"
                        className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border border-border bg-bg-elev hover:bg-danger/10 hover:border-danger/50 hover:text-danger transition-colors disabled:opacity-50"
                      >
                        <Trash className="h-3 w-3" />
                      </button>
                    </div>
                    {imageError && (
                      <p className="mt-1 text-[10px] text-danger">{imageError}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
