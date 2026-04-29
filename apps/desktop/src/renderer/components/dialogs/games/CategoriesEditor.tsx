import { useEffect, useId, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Input, Label, Select, TextArea } from '@maru/ui';
import type { GameCategory } from '@maru/shared';

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
}

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
}: CategoriesEditorProps) {
  const [selectedIdx, setSelectedIdx] = useState<number>(
    categories.length > 0 ? 0 : -1,
  );
  const idPrefix = useId();

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
              <div>
                <Label htmlFor={`${idPrefix}-cat-rc`}>Comando RCON</Label>
                <Input
                  id={`${idPrefix}-cat-rc`}
                  value={selected.rconCmd}
                  onChange={(e) => updateSelected({ rconCmd: e.target.value })}
                  placeholder="summon {entity}"
                  disabled={disabled}
                  className="font-mono text-xs"
                />
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
          </>
        )}
      </div>
    </div>
  );
}
