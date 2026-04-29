import { useId, useState } from 'react';
import { Bomb, Play, Square, Zap } from 'lucide-react';
import { Button, Dialog, Input, Label, Select } from '@maru/ui';
import type { MinigameId, WordSearchConfig } from '@maru/shared';
import { useAppStore } from '../../../lib/store/index.js';
import { useMinigames } from '../../../lib/use-minigames.js';

/**
 * `MinigamesDialog` (G10) — réplica de `minigames_dialog.py`.
 *
 * 3 minijuegos en secciones colapsables:
 *   1. 🔤 Sopa de Letras (WordSearch)
 *   2. ⚡ Sopa Rápida (WordSearchLite — sin pistas, rondas auto)
 *   3. 💣 Bomba de Palabras (WordBomb)
 *
 * Mejoras vs MARU original:
 *   - Indicador "Activo" + botón Stop visible cuando hay minijuego corriendo.
 *   - State persiste entre aperturas del modal (start/stop desde sidecar).
 *   - Config persistida en `data/minigames.json`.
 *   - El engine real se cablea en G14 cuando TikTokLive esté conectado.
 *     Acá G10 hace `start` que retorna `engineReady=false` si no hay core.
 */
export function MinigamesDialog() {
  const open = useAppStore((s) => s.modalStack.some((f) => f.id === 'minigames'));
  const closeModal = useAppStore((s) => s.closeModal);

  const mg = useMinigames({ autoLoad: open });
  const [busy, setBusy] = useState(false);
  const [opMessage, setOpMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!open) return null;

  const activeId = mg.state.active ? mg.state.id : null;

  function flash(text: string, ok = true) {
    setOpMessage({ ok, text });
    window.setTimeout(() => setOpMessage(null), 4000);
  }

  async function handleStart(id: MinigameId) {
    setBusy(true);
    try {
      const config = id === 'wordBomb' ? mg.config.wordBomb : mg.config[id];
      const res = await mg.start(id, config);
      flash(
        res.engineReady
          ? `✓ ${id} iniciado. ${res.message ?? ''}`
          : `⚠ ${id} marcado como activo, pero el engine real (TikTokLive) se cablea en G14. ${res.message ?? ''}`,
        res.engineReady,
      );
    } catch (ex) {
      flash(ex instanceof Error ? ex.message : String(ex), false);
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    setBusy(true);
    try {
      await mg.stop();
      flash('✓ Minijuego detenido.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={() => !busy && closeModal()}
      size="md"
      bodyFlush
      title="🎲 Minijuegos"
      description="Juegos interactivos para tu stream — los jugadores escriben !game para unirse."
    >
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
        {opMessage && (
          <div
            className={
              'rounded-md px-3 py-2 text-xs ' +
              (opMessage.ok
                ? 'border border-success/40 bg-success/10 text-success'
                : 'border border-warning/40 bg-warning/10 text-warning')
            }
          >
            {opMessage.text}
          </div>
        )}

        {activeId && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2">
            <p className="text-xs">
              ⚡ Minijuego activo: <strong>{activeId}</strong>
            </p>
            <Button
              variant="danger"
              size="sm"
              onClick={() => void handleStop()}
              disabled={busy}
            >
              <Square className="h-3 w-3" />
              Detener
            </Button>
          </div>
        )}

        <WordSearchSection
          variant="wordSearch"
          config={mg.config.wordSearch}
          categories={mg.meta.wordSearchCategories}
          onChange={(c) => mg.patchConfig({ wordSearch: c })}
          onStart={() => void handleStart('wordSearch')}
          busy={busy}
          isActive={activeId === 'wordSearch'}
        />

        <WordSearchSection
          variant="wordSearchLite"
          config={mg.config.wordSearchLite}
          categories={mg.meta.wordSearchCategories}
          onChange={(c) => mg.patchConfig({ wordSearchLite: c })}
          onStart={() => void handleStart('wordSearchLite')}
          busy={busy}
          isActive={activeId === 'wordSearchLite'}
        />

        <WordBombSection
          config={mg.config.wordBomb}
          onChange={(c) => mg.patchConfig({ wordBomb: c })}
          onStart={() => void handleStart('wordBomb')}
          busy={busy}
          isActive={activeId === 'wordBomb'}
        />
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3 bg-bg-base/50">
        <p className="text-[11px] text-fg-subtle">
          💡 Los minijuegos solo consumen recursos mientras están activos.
        </p>
        <Button variant="ghost" size="sm" onClick={closeModal} disabled={busy}>
          Cerrar
        </Button>
      </footer>
    </Dialog>
  );
}

// ── Secciones ────────────────────────────────────────────────────────────

function WordSearchSection({
  variant,
  config,
  categories,
  onChange,
  onStart,
  busy,
  isActive,
}: {
  variant: 'wordSearch' | 'wordSearchLite';
  config: WordSearchConfig;
  categories: { id: string; name: string }[];
  onChange: (c: WordSearchConfig) => void;
  onStart: () => void;
  busy: boolean;
  isActive: boolean;
}) {
  const idPrefix = useId();
  const isLite = variant === 'wordSearchLite';
  const title = isLite ? '⚡ Sopa Rápida' : '🔤 Sopa de Letras';
  const desc = isLite
    ? 'Solo la grilla, sin pistas. Rondas automáticas — ideal para hype.'
    : 'Los jugadores marcan inicio y fin con coordenadas (A1 C3). Gana quien encuentre más palabras.';

  return (
    <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
      <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle flex items-center gap-2">
        {title}
        {isActive && <span className="text-[10px] text-accent normal-case tracking-normal">● activo</span>}
      </legend>
      <p className="text-[11px] text-fg-subtle">{desc}</p>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={`${idPrefix}-cat`}>Categoría</Label>
          <Select
            id={`${idPrefix}-cat`}
            value={config.category}
            onChange={(e) => onChange({ ...config, category: e.target.value })}
            disabled={busy}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-words`}>Palabras (4-12)</Label>
          <Input
            id={`${idPrefix}-words`}
            type="number"
            min={4}
            max={12}
            value={String(config.wordCount)}
            onChange={(e) =>
              onChange({
                ...config,
                wordCount: Math.max(4, Math.min(12, parseInt(e.target.value, 10) || 8)),
              })
            }
            disabled={busy}
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-rows`}>Filas (8-15)</Label>
          <Input
            id={`${idPrefix}-rows`}
            type="number"
            min={8}
            max={15}
            value={String(config.rows)}
            onChange={(e) =>
              onChange({
                ...config,
                rows: Math.max(8, Math.min(15, parseInt(e.target.value, 10) || 10)),
              })
            }
            disabled={busy}
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-cols`}>Columnas (8-15)</Label>
          <Input
            id={`${idPrefix}-cols`}
            type="number"
            min={8}
            max={15}
            value={String(config.cols)}
            onChange={(e) =>
              onChange({
                ...config,
                cols: Math.max(8, Math.min(15, parseInt(e.target.value, 10) || 10)),
              })
            }
            disabled={busy}
          />
        </div>
      </div>

      <Button
        type="button"
        variant="primary"
        size="sm"
        className="w-full"
        onClick={onStart}
        disabled={busy}
      >
        {isLite ? <Zap className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        Iniciar {isLite ? 'Sopa Rápida' : 'Sopa de Letras'}
      </Button>
    </fieldset>
  );
}

function WordBombSection({
  config,
  onChange,
  onStart,
  busy,
  isActive,
}: {
  config: { turnTime: number; lives: number };
  onChange: (c: { turnTime: number; lives: number }) => void;
  onStart: () => void;
  busy: boolean;
  isActive: boolean;
}) {
  const idPrefix = useId();
  return (
    <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
      <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle flex items-center gap-2">
        💣 Bomba de Palabras
        {isActive && <span className="text-[10px] text-accent normal-case tracking-normal">● activo</span>}
      </legend>
      <p className="text-[11px] text-fg-subtle">
        Sílaba aleatoria — el jugador actual debe escribir una palabra que la
        contenga antes de que explote la bomba. Completar A-Z da vida bonus.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={`${idPrefix}-time`}>Tiempo de turno (5-30s)</Label>
          <Input
            id={`${idPrefix}-time`}
            type="number"
            min={5}
            max={30}
            value={String(config.turnTime)}
            onChange={(e) =>
              onChange({
                ...config,
                turnTime: Math.max(5, Math.min(30, parseInt(e.target.value, 10) || 15)),
              })
            }
            disabled={busy}
            suffix="seg"
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-lives`}>Vidas iniciales (1-5)</Label>
          <Input
            id={`${idPrefix}-lives`}
            type="number"
            min={1}
            max={5}
            value={String(config.lives)}
            onChange={(e) =>
              onChange({
                ...config,
                lives: Math.max(1, Math.min(5, parseInt(e.target.value, 10) || 3)),
              })
            }
            disabled={busy}
          />
        </div>
      </div>

      <Button
        type="button"
        variant="danger"
        size="sm"
        className="w-full"
        onClick={onStart}
        disabled={busy}
      >
        <Bomb className="h-3.5 w-3.5" />
        Iniciar Bomba de Palabras
      </Button>
    </fieldset>
  );
}
