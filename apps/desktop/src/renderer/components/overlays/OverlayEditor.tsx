import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button, Input, MaruImage } from '@maru/ui';
import {
  Check,
  ChevronDown,
  Copy,
  LayoutGrid,
  Minus,
  Palette,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Settings as SettingsIcon,
  Sparkles,
  Target,
  Trash2,
  Type,
} from 'lucide-react';
import type { OverlayInfo } from '@maru/shared';
import { rpcCall } from '../../lib/rpc.js';
import {
  EntitySelectorDialog,
  type MultiSelection,
} from '../dialogs/data/index.js';
import { GiftSelectorDialog } from '../dialogs/gifts/GiftSelectorDialog.js';
import type { DonationGift } from '@maru/shared';

const DEBOUNCE_MS = 180;

export interface OverlayEditorProps {
  overlay: OverlayInfo;
  onCopyUrl(): void;
  onCopiedFlash: boolean;
}

export function OverlayEditor({
  overlay,
  onCopyUrl,
  onCopiedFlash,
}: OverlayEditorProps): ReactNode {
  const [config, setConfig] = useState<Record<string, unknown>>(
    () => ({ ...overlay.default }),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void rpcCall('overlays.get-config', { overlayId: overlay.id })
      .then((r) => {
        if (cancelled) return;
        setConfig({ ...overlay.default, ...r.config });
      })
      .catch(() => {
        if (cancelled) return;
        setConfig({ ...overlay.default });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [overlay.id, overlay.default]);

  const persist = useCallback(
    (next: Record<string, unknown>) => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(() => {
        setSaving(true);
        void rpcCall('overlays.set-config', {
          overlayId: overlay.id,
          patch: next,
        })
          .catch(() => undefined)
          .finally(() => setSaving(false));
      }, DEBOUNCE_MS);
    },
    [overlay.id],
  );

  const updateField = useCallback(
    (key: string, value: unknown) => {
      setConfig((prev) => {
        const next = { ...prev, [key]: value };
        persist({ [key]: value });
        return next;
      });
    },
    [persist],
  );

  const updateMany = useCallback(
    (patch: Record<string, unknown>) => {
      setConfig((prev) => {
        const next = { ...prev, ...patch };
        persist(patch);
        return next;
      });
    },
    [persist],
  );

  const sendTest = useCallback(() => {
    void rpcCall('overlays.test-event', { overlayId: overlay.id }).catch(
      () => undefined,
    );
  }, [overlay.id]);

  const forceReload = useCallback(() => {
    void rpcCall('overlays.reload', { overlayId: overlay.id }).catch(
      () => undefined,
    );
  }, [overlay.id]);

  const resetCounter = useCallback(() => {
    void rpcCall('overlays.test-event', {
      overlayId: overlay.id,
      eventType: 'reset',
      data: {},
    }).catch(() => undefined);
  }, [overlay.id]);

  const restoreDefaults = useCallback(() => {
    if (!confirm('¿Restaurar valores por defecto de este overlay?')) return;
    setConfig({ ...overlay.default });
    void rpcCall('overlays.set-config', {
      overlayId: overlay.id,
      patch: { ...overlay.default },
    }).catch(() => undefined);
  }, [overlay.id, overlay.default]);

  return (
    <div className="flex h-full flex-col">
      {/* URL */}
      <section className="shrink-0 border-b border-border bg-bg-elev/30 p-3">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          URL para TikTok Live Studio
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded bg-bg-base/80 px-2 py-1.5 text-[11px] text-fg">
            {overlay.url}
          </code>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onCopyUrl}
            title="Copiar URL"
            className="shrink-0"
          >
            {onCopiedFlash ? (
              <>
                <Check className="h-3.5 w-3.5" /> Copiado
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" /> Copiar
              </>
            )}
          </Button>
        </div>
      </section>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold">Configuración</h4>
          <span
            className={[
              'text-[10px] uppercase tracking-wider transition-opacity',
              saving ? 'text-accent opacity-100' : 'opacity-0',
            ].join(' ')}
          >
            Guardando…
          </span>
        </div>

        {loading ? (
          <p className="text-xs italic text-fg-subtle">Cargando…</p>
        ) : (
          <FieldsByOverlay
            overlayId={overlay.id}
            config={config}
            onChange={updateField}
            onChangeMany={updateMany}
          />
        )}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border bg-bg-elev/30 px-3 py-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={sendTest}
          title="Disparar evento de prueba (suma 5 likes a la barra)"
        >
          <Send className="h-3.5 w-3.5" />
          Probar
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={resetCounter}
          title="Reiniciar el contador a 0"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Resetear
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={forceReload}
          title="Forzar recarga del overlay"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Recargar
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={restoreDefaults}
          title="Restaurar valores por defecto"
          className="ml-auto !text-fg-subtle hover:!text-danger"
        >
          Defaults
        </Button>
      </footer>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Fields por overlay
   ────────────────────────────────────────────────────────────────────── */

function FieldsByOverlay({
  overlayId,
  config,
  onChange,
  onChangeMany,
}: {
  overlayId: string;
  config: Record<string, unknown>;
  onChange(key: string, value: unknown): void;
  onChangeMany(patch: Record<string, unknown>): void;
}): ReactNode {
  if (overlayId === 'taps') {
    return <TapsFields config={config} onChange={onChange} onChangeMany={onChangeMany} />;
  }
  if (overlayId === 'streak') {
    return <StreakFields config={config} onChange={onChange} />;
  }
  if (overlayId === 'extensible') {
    return <ExtensibleFields config={config} onChange={onChange} />;
  }
  if (overlayId === 'music') {
    return <MusicFields config={config} onChange={onChange} />;
  }
  if (overlayId === 'likes') {
    return <LikesFields config={config} onChange={onChange} />;
  }
  if (overlayId === 'toplikes') {
    return <TopLikesFields config={config} onChange={onChange} />;
  }
  return (
    <p className="text-xs italic text-fg-subtle">
      Este overlay no tiene parámetros editables.
    </p>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Taps — secciones colapsables
   ══════════════════════════════════════════════════════════════════════ */

interface PresetSpec {
  id: string;
  name: string;
  patch: Record<string, unknown>;
}

const TAPS_PRESETS: PresetSpec[] = [
  {
    id: 'tikfinity',
    name: 'Tikfinity',
    patch: {
      variant: 'default',
      layout: 'standard',
      shape: 'rounded',
      title_position: 'below',
      title_align: 'center',
      color_primary: '#d42c65',
      color_track: '#2cb2d4',
      color_bg: 'rgba(30, 123, 146, 0.92)',
      color_text: '#ffffff',
      color_percent: '#ffffff',
      skew: -15,
      bar_height: 38,
      width: 880,
      font_title: 18,
      font_counter: 22,
      font_percent: 22,
      shadow_strength: 1,
    },
  },
  {
    id: 'neon',
    name: 'Neón',
    patch: {
      variant: 'neon',
      layout: 'standard',
      shape: 'rounded',
      title_position: 'above',
      title_align: 'center',
      color_primary: '#1DB954',
      color_track: '#0a0a10',
      color_bg: 'rgba(10, 14, 22, 0.85)',
      color_text: '#ffffff',
      color_percent: '#1DB954',
      skew: -10,
      bar_height: 60,
      shadow_strength: 1.2,
    },
  },
  {
    id: 'minimal',
    name: 'Minimal',
    patch: {
      variant: 'minimal',
      layout: 'standard',
      shape: 'pill',
      title_position: 'below',
      title_align: 'left',
      color_primary: '#1DB954',
      color_track: '#1f2937',
      color_bg: 'rgba(10, 14, 22, 0.78)',
      color_text: '#ffffff',
      color_percent: '#ffffff',
      skew: 0,
      bar_height: 52,
      width: 680,
      shadow_strength: 0.6,
    },
  },
  {
    id: 'pure',
    name: 'Plano',
    patch: {
      variant: 'pure',
      layout: 'simple',
      shape: 'square',
      title_position: 'above',
      title_align: 'center',
      color_primary: '#3b82f6',
      color_track: '#1f2937',
      color_bg: 'rgba(0, 0, 0, 0.72)',
      color_text: '#ffffff',
      color_percent: '#ffffff',
      skew: 0,
      bar_height: 50,
      shadow_strength: 0.3,
    },
  },
];

function TapsFields({
  config,
  onChange,
  onChangeMany,
}: {
  config: Record<string, unknown>;
  onChange(key: string, value: unknown): void;
  onChangeMany(patch: Record<string, unknown>): void;
}): ReactNode {
  const get = <T,>(k: string, fallback: T): T =>
    (config[k] as T) ?? fallback;

  const goal = Number(get('goal', 1000));

  return (
    <div className="space-y-2">
      {/* ── Sección 1: META Y TÍTULO (abierta por default) ───────── */}
      <Section title="Meta y título" icon={<SettingsIcon className="h-3.5 w-3.5" />} defaultOpen>
        <div className="space-y-2">
          <FieldRow label="Meta de likes">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onChange('goal', Math.max(50, goal - 50))}
                className="grid h-9 w-9 place-items-center rounded-md border border-border bg-bg-elev/40 text-fg-muted hover:border-accent hover:text-accent"
                title="−50"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <NumberInput
                value={goal}
                min={1}
                step={1}
                onChange={(n) => onChange('goal', n)}
                className="!h-9 flex-1 !text-center !text-base !font-bold"
              />
              <button
                type="button"
                onClick={() => onChange('goal', goal + 50)}
                className="grid h-9 w-9 place-items-center rounded-md border border-border bg-bg-elev/40 text-fg-muted hover:border-accent hover:text-accent"
                title="+50"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {[100, 500, 1000, 5000, 10000].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onChange('goal', v)}
                  className={[
                    'rounded-md border px-2 py-0.5 text-[10px] font-semibold transition-colors',
                    goal === v
                      ? 'border-accent bg-accent/15 text-accent'
                      : 'border-border bg-bg-base/40 text-fg-muted hover:border-fg-muted',
                  ].join(' ')}
                >
                  {v.toLocaleString()}
                </button>
              ))}
            </div>
          </FieldRow>

          <FieldRow label="Texto del título">
            <Input
              value={String(get('label', 'Meta de likes'))}
              onChange={(e) => onChange('label', e.target.value)}
              placeholder="JEFE"
            />
          </FieldRow>

          <FieldRow label="Mensaje al cumplir la meta">
            <Input
              value={String(get('message', '¡Lo logramos!'))}
              onChange={(e) => onChange('message', e.target.value)}
            />
          </FieldRow>

          <ChoiceRow
            label="Posición del título"
            value={String(get('title_position', 'below'))}
            options={[
              { v: 'above', l: 'Arriba' },
              { v: 'below', l: 'Abajo' },
              { v: 'left', l: 'Izq.' },
              { v: 'right', l: 'Der.' },
            ]}
            onChange={(v) => onChange('title_position', v)}
          />

          {(get('title_position', 'below') === 'above' ||
            get('title_position', 'below') === 'below') && (
            <ChoiceRow
              label="Alineación del título"
              value={String(get('title_align', 'center'))}
              options={[
                { v: 'left', l: 'Izquierda' },
                { v: 'center', l: 'Centro' },
                { v: 'right', l: 'Derecha' },
              ]}
              onChange={(v) => onChange('title_align', v)}
            />
          )}
        </div>
      </Section>

      {/* ── Sección 2: ESTILO Y PRESETS ──────────────────────────── */}
      <Section title="Estilo (presets)" icon={<Sparkles className="h-3.5 w-3.5" />}>
        <div className="grid grid-cols-2 gap-1.5">
          {TAPS_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onChangeMany(p.patch)}
              className="rounded-lg border border-border bg-bg-base/50 px-2 py-2.5 text-xs font-semibold text-fg-muted transition-colors hover:border-accent hover:text-fg"
            >
              {p.name}
            </button>
          ))}
        </div>
      </Section>

      {/* ── Sección 3: COLORES ───────────────────────────────────── */}
      <Section title="Colores" icon={<Palette className="h-3.5 w-3.5" />}>
        <ColorField
          label="Color principal"
          value={String(get('color_primary', '#d42c65'))}
          onChange={(v) => onChange('color_primary', v)}
        />
        <ColorField
          label="Color del fondo"
          value={String(get('color_track', '#2cb2d4'))}
          onChange={(v) => onChange('color_track', v)}
        />
        <ColorField
          label="Color del texto"
          value={String(get('color_text', '#ffffff'))}
          onChange={(v) => onChange('color_text', v)}
        />
        <ColorField
          label="Color del %"
          value={String(get('color_percent', '#ffffff'))}
          onChange={(v) => onChange('color_percent', v)}
        />
      </Section>

      {/* ── Sección 4: LAYOUT Y POSICIÓN ─────────────────────────── */}
      <Section title="Layout y posición" icon={<LayoutGrid className="h-3.5 w-3.5" />}>
        <ChoiceRow
          label="Layout"
          value={String(get('layout', 'standard'))}
          options={[
            { v: 'standard', l: 'Estándar' },
            { v: 'simple', l: 'Simple' },
            { v: 'condensed', l: 'Compacto' },
          ]}
          onChange={(v) => onChange('layout', v)}
        />
        <ChoiceRow
          label="Forma"
          value={String(get('shape', 'rounded'))}
          options={[
            { v: 'square', l: 'Cuadrada' },
            { v: 'rounded', l: 'Redondeada' },
            { v: 'pill', l: 'Píldora' },
          ]}
          onChange={(v) => onChange('shape', v)}
        />
        <ChoiceRow
          label="Skew (parallelogram)"
          value={String(get('skew', -15))}
          options={[
            { v: '0', l: 'Recto' },
            { v: '-10', l: '−10°' },
            { v: '-15', l: '−15°' },
            { v: '-20', l: '−20°' },
          ]}
          onChange={(v) => onChange('skew', Number(v))}
        />
        <FieldRow label="Posición en pantalla">
          <PositionGrid
            alignH={String(get('align_h', 'center'))}
            alignV={String(get('align_v', 'bottom'))}
            onChange={(h, v) => onChangeMany({ align_h: h, align_v: v })}
          />
        </FieldRow>
        <SliderField
          label="Margen horizontal"
          value={Number(get('margin_x', 32))}
          min={0}
          max={200}
          format={(v) => `${v}px`}
          onChange={(v) => onChange('margin_x', v)}
        />
        <SliderField
          label="Margen vertical"
          value={Number(get('margin_y', 36))}
          min={0}
          max={200}
          format={(v) => `${v}px`}
          onChange={(v) => onChange('margin_y', v)}
        />
      </Section>

      {/* ── Sección 5: TAMAÑO Y TIPOGRAFÍA ───────────────────────── */}
      <Section title="Tamaño y tipografía" icon={<Type className="h-3.5 w-3.5" />}>
        <SliderField
          label="Ancho del widget"
          value={Number(get('width', 880))}
          min={400}
          max={1600}
          step={20}
          format={(v) => `${v}px`}
          onChange={(v) => onChange('width', v)}
        />
        <SliderField
          label="Alto de la barra"
          value={Number(get('bar_height', 38))}
          min={24}
          max={120}
          format={(v) => `${v}px`}
          onChange={(v) => onChange('bar_height', v)}
        />
        <SliderField
          label="Tamaño del título"
          value={Number(get('font_title', 18))}
          min={10}
          max={64}
          format={(v) => `${v}px`}
          onChange={(v) => onChange('font_title', v)}
        />
        <SliderField
          label="Tamaño del contador (meta)"
          value={Number(get('font_counter', 22))}
          min={12}
          max={80}
          format={(v) => `${v}px`}
          onChange={(v) => onChange('font_counter', v)}
        />
        <SliderField
          label="Tamaño del porcentaje"
          value={Number(get('font_percent', 22))}
          min={12}
          max={80}
          format={(v) => `${v}px`}
          onChange={(v) => onChange('font_percent', v)}
        />
        <SliderField
          label="Sombra"
          value={Number(get('shadow_strength', 1))}
          min={0}
          max={2}
          step={0.1}
          format={(v) => `${(v * 100).toFixed(0)}%`}
          onChange={(v) => onChange('shadow_strength', v)}
        />
      </Section>

      {/* ── Modo al cumplir meta ────────────────────────────────── */}
      <Section title="Modo al cumplir la meta" icon={<Target className="h-3.5 w-3.5" />}>
        <ChoiceRow
          label="¿Qué pasa cuando se cumple?"
          value={String(get('goal_mode', 'reset'))}
          options={[
            { v: 'reset', l: 'Reset a 0' },
            { v: 'double', l: 'Duplicar' },
            { v: 'increase', l: 'Sumar X' },
          ]}
          onChange={(v) => onChange('goal_mode', v)}
        />
        {get('goal_mode', 'reset') === 'increase' && (
          <NumberFieldSimple
            label="Sumar X likes a la meta cada vez"
            value={Number(get('goal_increase_amount', 10000))}
            onChange={(v) => onChange('goal_increase_amount', v)}
          />
        )}
        {get('goal_mode', 'reset') === 'double' && (
          <p className="text-[10px] text-fg-subtle">
            Cada vez que se cumple la meta, se duplica. Ej: 1.000 → 2.000 → 4.000 → 8.000…
          </p>
        )}
      </Section>

      {/* ── Sección Acciones al cumplir la meta ──────────────────── */}
      <Section title="Acciones al cumplir la meta" icon={<Target className="h-3.5 w-3.5" />}>
        <GoalActionsEditor
          actions={(() => {
            const raw = get('goal_actions', []);
            return Array.isArray(raw) ? (raw as Action[]) : [];
          })()}
          onChange={(next) => onChange('goal_actions', next)}
        />
      </Section>

      {/* ── Sección 6: COMPORTAMIENTO Y ANIMACIÓN ────────────────── */}
      <Section title="Comportamiento y animación" icon={<SettingsIcon className="h-3.5 w-3.5" />}>
        <div className="grid grid-cols-2 gap-1.5">
          <Toggle
            label="Mostrar %"
            checked={Boolean(get('show_percent', true))}
            onChange={(v) => onChange('show_percent', v)}
          />
          <Toggle
            label="Confeti al cumplir"
            checked={Boolean(get('show_confetti', true))}
            onChange={(v) => onChange('show_confetti', v)}
          />
          <Toggle
            label="Mensaje al cumplir"
            checked={Boolean(get('show_toast', true))}
            onChange={(v) => onChange('show_toast', v)}
          />
          <Toggle
            label="Reset al cumplir"
            checked={Boolean(get('reset_on_goal', true))}
            onChange={(v) => onChange('reset_on_goal', v)}
          />
          <Toggle
            label="Reset al iniciar live"
            checked={Boolean(get('reset_on_live_start', true))}
            onChange={(v) => onChange('reset_on_live_start', v)}
          />
        </div>
        <SliderField
          label="Suavidad de la barra"
          value={Number(get('bar_anim', 0.6))}
          min={0.1}
          max={1.5}
          step={0.05}
          format={(v) => `${v.toFixed(2)}s`}
          onChange={(v) => onChange('bar_anim', v)}
        />
      </Section>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   Streak fields
   ────────────────────────────────────────────────────────────────────── */

function StreakFields({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange(key: string, value: unknown): void;
}): ReactNode {
  const duration = Number(config.duration ?? 6000);
  const label = String(config.label ?? 'DÍAS DE RACHA');
  return (
    <div className="space-y-2">
      <Section title="Comportamiento" icon={<SettingsIcon className="h-3.5 w-3.5" />} defaultOpen>
        <SliderField
          label="Duración en pantalla"
          value={duration}
          min={2000}
          max={15000}
          step={500}
          format={(v) => `${(v / 1000).toFixed(1)}s`}
          onChange={(v) => onChange('duration', v)}
        />
        <FieldRow label="Texto debajo del número">
          <Input value={label} onChange={(e) => onChange('label', e.target.value)} />
        </FieldRow>
      </Section>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Atomos
   ══════════════════════════════════════════════════════════════════════ */

function Section({
  title,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="rounded-lg border border-border bg-bg-base/30"
    >
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">
        {icon}
        <span className="flex-1">{title}</span>
        <ChevronDown
          className={[
            'h-3.5 w-3.5 transition-transform',
            open ? 'rotate-180' : '',
          ].join(' ')}
        />
      </summary>
      <div className="space-y-2.5 px-3 pb-3 pt-1">{children}</div>
    </details>
  );
}

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): ReactNode {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
        {label}
      </span>
      {children}
      {hint && <span className="mt-0.5 block text-[10px] text-fg-subtle/80">{hint}</span>}
    </label>
  );
}

/**
 * Input numérico que permite borrar TODO el contenido temporalmente
 * (mostrando string vacío) sin que React reescriba el value. Solo
 * commitea al `onChange` cuando hay un número válido en el rango.
 */
function NumberInput({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  className,
  title,
}: {
  value: number;
  onChange(v: number): void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  title?: string;
}): ReactNode {
  const [text, setText] = useState<string>(String(value));
  // Sync externa: si el value externo cambia y NO es por nuestro typing,
  // refrescamos el text. Detectamos eso porque text parsed != value.
  useEffect(() => {
    const parsed = parseFloat(text);
    if (Number.isNaN(parsed) || parsed !== value) {
      setText(String(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      type="number"
      value={text}
      min={min}
      max={max}
      step={step}
      title={title}
      className={className}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        if (v === '' || v === '-') return; // estados intermedios válidos
        const n = parseFloat(v);
        if (Number.isNaN(n)) return;
        if (n < min) return;
        if (max !== undefined && n > max) return;
        onChange(n);
      }}
      onBlur={() => {
        // Al salir del input, si quedó vacío → restaurar al valor actual.
        if (text === '' || text === '-') setText(String(value));
      }}
    />
  );
}

function NumberFieldSimple({
  label,
  value,
  min = 1,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  onChange(v: number): void;
}): ReactNode {
  return (
    <FieldRow label={label}>
      <NumberInput value={value} min={min} onChange={onChange} className="!h-9" />
    </FieldRow>
  );
}

/**
 * ColorField — picker visual robusto. Funciona con cualquier formato
 * (hex, rgba, named color). El swatch muestra el color real sobre un
 * checker pattern que revela transparencias. Click en swatch o palette
 * icon abre el picker nativo.
 */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }): ReactNode {
  const isHex = /^#[0-9a-fA-F]{6}$/.test(value);
  const pickerValue = isHex ? value : '#1DB954';
  const isEmpty = !value || value.trim() === '';
  // Checker pattern para revelar transparencia.
  const checkerBg =
    'repeating-conic-gradient(rgba(255,255,255,0.12) 0% 25%, rgba(0,0,0,0.18) 0% 50%) 50% / 10px 10px';
  return (
    <FieldRow label={label}>
      <div className="flex items-stretch gap-1.5">
        <label
          className="group relative flex h-9 min-w-[44px] cursor-pointer items-center justify-center overflow-hidden rounded-md border border-border shadow-inner ring-1 ring-white/5 transition hover:border-accent hover:ring-accent/40"
          title="Click para abrir el selector de color"
        >
          {/* Capa 1: checker (transparencia o vacío) */}
          <span className="absolute inset-0" style={{ background: checkerBg }} aria-hidden />
          {/* Capa 2: color real encima si NO está vacío */}
          {!isEmpty && (
            <span className="absolute inset-0" style={{ backgroundColor: value }} aria-hidden />
          )}
          {/* Capa 3: ícono palette para reforzar affordance */}
          <Palette className={[
            'relative z-10 h-3.5 w-3.5 mix-blend-difference',
            isEmpty ? 'text-white/50' : 'text-white opacity-90',
          ].join(' ')} />
          {/* Input invisible que recibe el click */}
          <input
            type="color"
            value={pickerValue}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="!h-9 min-w-0 flex-1 font-mono text-[11px]"
          placeholder="#1DB954 o rgba(...)"
        />
      </div>
    </FieldRow>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?(v: number): string;
  onChange(v: number): void;
}): ReactNode {
  return (
    <FieldRow label={`${label}: ${format ? format(value) : value}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (!Number.isNaN(n)) onChange(n);
        }}
        className="w-full accent-accent"
      />
    </FieldRow>
  );
}

function ChoiceRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { v: string; l: string }[];
  onChange(v: string): void;
}): ReactNode {
  // Si hay >3 opciones o algún label largo, wrappear; sino grid igual.
  const longText = options.some((o) => o.l.length > 8);
  const useWrap = options.length > 3 || longText;
  return (
    <FieldRow label={label}>
      {useWrap ? (
        <div className="flex flex-wrap gap-1">
          {options.map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange(o.v)}
              className={[
                'flex-1 min-w-[68px] rounded-md border px-2 py-1.5 text-[11px] transition-colors whitespace-nowrap',
                o.v === value
                  ? 'border-accent bg-accent/15 font-bold text-accent'
                  : 'border-border bg-bg-base/40 text-fg-muted hover:border-fg-muted',
              ].join(' ')}
            >
              {o.l}
            </button>
          ))}
        </div>
      ) : (
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
          {options.map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange(o.v)}
              className={[
                'rounded-md border px-2 py-1.5 text-[11px] transition-colors whitespace-nowrap overflow-hidden text-ellipsis',
                o.v === value
                  ? 'border-accent bg-accent/15 font-bold text-accent'
                  : 'border-border bg-bg-base/40 text-fg-muted hover:border-fg-muted',
              ].join(' ')}
            >
              {o.l}
            </button>
          ))}
        </div>
      )}
    </FieldRow>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(v: boolean): void;
}): ReactNode {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-xs select-none rounded-md border border-border bg-bg-base/30 px-2 py-1.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer accent-accent"
      />
      <span className="flex-1 text-fg">{label}</span>
    </label>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   LikesFields — Overlay !likes individual
   ══════════════════════════════════════════════════════════════════════ */
function LikesFields({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange(key: string, value: unknown): void;
}): ReactNode {
  const get = <T,>(k: string, fallback: T): T => (config[k] as T) ?? fallback;
  return (
    <div className="space-y-2">
      <Section title="Estilo visual" icon={<Sparkles className="h-3.5 w-3.5" />} defaultOpen>
        <ChoiceRow
          label="Preset"
          value={String(get('style', 'glass'))}
          options={[
            { v: 'glass', l: 'Glass' },
            { v: 'transparent', l: 'Sin fondo' },
            { v: 'neon', l: 'Neón' },
            { v: 'minimal', l: 'Minimal' },
          ]}
          onChange={(v) => onChange('style', v)}
        />
      </Section>
      <Section title="Comportamiento" icon={<SettingsIcon className="h-3.5 w-3.5" />} defaultOpen>
        <SliderField
          label="Duración en pantalla"
          value={Number(get('duration_ms', 7000))}
          min={2000}
          max={20000}
          step={500}
          format={(v) => `${(v / 1000).toFixed(1)}s`}
          onChange={(v) => onChange('duration_ms', v)}
        />
      </Section>
      <Section title="Estilo" icon={<Palette className="h-3.5 w-3.5" />} defaultOpen>
        <ColorField label="Fondo" value={String(get('color_bg', 'rgba(15, 14, 22, 0.85)'))} onChange={(v) => onChange('color_bg', v)} />
        <ColorField label="Texto" value={String(get('color_text', '#ffffff'))} onChange={(v) => onChange('color_text', v)} />
        <ColorField label="Acento (número)" value={String(get('color_accent', '#ff4d6d'))} onChange={(v) => onChange('color_accent', v)} />
        <SliderField label="Tamaño avatar" value={Number(get('avatar_size', 56))} min={32} max={120} format={(v) => `${v}px`} onChange={(v) => onChange('avatar_size', v)} />
        <SliderField label="Tamaño @user" value={Number(get('font_user', 14))} min={10} max={28} format={(v) => `${v}px`} onChange={(v) => onChange('font_user', v)} />
        <SliderField label="Tamaño número" value={Number(get('font_count', 28))} min={14} max={64} format={(v) => `${v}px`} onChange={(v) => onChange('font_count', v)} />
        <SliderField label="Borde redondeado" value={Number(get('card_radius', 14))} min={0} max={32} format={(v) => `${v}px`} onChange={(v) => onChange('card_radius', v)} />
      </Section>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   TopLikesFields — Overlay top likes ranking
   ══════════════════════════════════════════════════════════════════════ */
function TopLikesFields({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange(key: string, value: unknown): void;
}): ReactNode {
  const get = <T,>(k: string, fallback: T): T => (config[k] as T) ?? fallback;
  return (
    <div className="space-y-2">
      <Section title="Estilo visual" icon={<Sparkles className="h-3.5 w-3.5" />} defaultOpen>
        <ChoiceRow
          label="Preset"
          value={String(get('style', 'glass'))}
          options={[
            { v: 'glass', l: 'Glass' },
            { v: 'transparent', l: 'Sin fondo' },
            { v: 'neon', l: 'Neón' },
            { v: 'cards', l: 'Cards' },
            { v: 'pill', l: 'Píldora' },
          ]}
          onChange={(v) => onChange('style', v)}
        />
      </Section>
      <Section title="Layout" icon={<SettingsIcon className="h-3.5 w-3.5" />} defaultOpen>
        <ChoiceRow
          label="Cuántos mostrar"
          value={String(get('max_items', 3))}
          options={[
            { v: '1', l: 'Solo el #1' },
            { v: '3', l: 'Top 3' },
            { v: '5', l: 'Top 5' },
          ]}
          onChange={(v) => onChange('max_items', Number(v))}
        />
        <ChoiceRow
          label="Orientación"
          value={String(get('vertical', true))}
          options={[
            { v: 'true', l: 'Vertical' },
            { v: 'false', l: 'Horizontal' },
          ]}
          onChange={(v) => onChange('vertical', v === 'true')}
        />
        <Toggle
          label="Mostrar número de likes"
          checked={Boolean(get('show_count', true))}
          onChange={(v) => onChange('show_count', v)}
        />
      </Section>
      <Section title="Estilo" icon={<Palette className="h-3.5 w-3.5" />} defaultOpen>
        <ColorField label="Fondo de cada item" value={String(get('color_bg', 'rgba(15, 14, 22, 0.85)'))} onChange={(v) => onChange('color_bg', v)} />
        <ColorField label="Texto" value={String(get('color_text', '#ffffff'))} onChange={(v) => onChange('color_text', v)} />
        <ColorField label="Acento (número)" value={String(get('color_accent', '#ffd23f'))} onChange={(v) => onChange('color_accent', v)} />
        <SliderField label="Tamaño avatar" value={Number(get('avatar_size', 56))} min={28} max={120} format={(v) => `${v}px`} onChange={(v) => onChange('avatar_size', v)} />
        <SliderField label="Tamaño @user" value={Number(get('font_user', 12))} min={9} max={24} format={(v) => `${v}px`} onChange={(v) => onChange('font_user', v)} />
        <SliderField label="Tamaño número" value={Number(get('font_count', 16))} min={10} max={36} format={(v) => `${v}px`} onChange={(v) => onChange('font_count', v)} />
        <SliderField label="Borde redondeado" value={Number(get('card_radius', 12))} min={0} max={32} format={(v) => `${v}px`} onChange={(v) => onChange('card_radius', v)} />
      </Section>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   MusicFields — Cola de música Spotify
   ══════════════════════════════════════════════════════════════════════ */

function MusicFields({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange(key: string, value: unknown): void;
}): ReactNode {
  const get = <T,>(k: string, fallback: T): T =>
    (config[k] as T) ?? fallback;
  return (
    <div className="space-y-2">
      <Section title="Estilo visual" icon={<Sparkles className="h-3.5 w-3.5" />} defaultOpen>
        <ChoiceRow
          label="Preset"
          value={String(get('style', 'glass'))}
          options={[
            { v: 'glass', l: 'Glass' },
            { v: 'minimal', l: 'Minimal' },
            { v: 'neon', l: 'Neón' },
            { v: 'elegant', l: 'Elegante' },
            { v: 'compact', l: 'Compacto' },
            { v: 'micro', l: 'Micro' },
            { v: 'cinema', l: 'Cinema' },
            { v: 'sticker', l: 'Sticker' },
          ]}
          onChange={(v) => onChange('style', v)}
        />
        <p className="text-[10px] text-fg-subtle leading-relaxed">
          <strong>Glass</strong>: glassmorphism oscuro (default).
          <strong> Minimal</strong>: solo texto sobre transparente, máximo discreto.
          <strong> Neón</strong>: glow brillante color acento.
          <strong> Elegante</strong>: fondo crema, texto oscuro.
          <strong> Compacto</strong>: filas más bajas.
          <strong> Micro</strong>: 1 línea, ultra-compacto, no estorba.
          <strong> Cinema</strong>: banda inferior horizontal.
          <strong> Sticker</strong>: chips redondeados pequeños.
        </p>
      </Section>

      <Section title="Layout" icon={<SettingsIcon className="h-3.5 w-3.5" />} defaultOpen>
        <SliderField
          label="Cantidad de items en la lista (incluye now-playing)"
          value={Number(get('max_items', 5))}
          min={1}
          max={10}
          onChange={(v) => onChange('max_items', v)}
        />
        <SliderField
          label="Tamaño de la portada"
          value={Number(get('cover_size', 56))}
          min={32}
          max={120}
          format={(v) => `${v}px`}
          onChange={(v) => onChange('cover_size', v)}
        />
        <SliderField
          label="Espacio entre items"
          value={Number(get('spacing', 10))}
          min={2}
          max={32}
          format={(v) => `${v}px`}
          onChange={(v) => onChange('spacing', v)}
        />
        <Toggle
          label="Mostrar canción actual con barra de progreso"
          checked={Boolean(get('show_now_playing', true))}
          onChange={(v) => onChange('show_now_playing', v)}
        />
        <Toggle
          label="Mostrar barra de progreso"
          checked={Boolean(get('show_progress', true))}
          onChange={(v) => onChange('show_progress', v)}
        />
        <Toggle
          label='Mostrar "@usuario" que pidió la canción'
          checked={Boolean(get('show_requested_by', true))}
          onChange={(v) => onChange('show_requested_by', v)}
        />
      </Section>

      <Section title="Tipografía" icon={<Type className="h-3.5 w-3.5" />}>
        <SliderField
          label="Tamaño del título"
          value={Number(get('font_title', 16))}
          min={10}
          max={32}
          format={(v) => `${v}px`}
          onChange={(v) => onChange('font_title', v)}
        />
        <SliderField
          label="Tamaño del artista"
          value={Number(get('font_artist', 12))}
          min={8}
          max={24}
          format={(v) => `${v}px`}
          onChange={(v) => onChange('font_artist', v)}
        />
        <SliderField
          label="Tamaño del meta (tiempo / requested by)"
          value={Number(get('font_meta', 11))}
          min={8}
          max={20}
          format={(v) => `${v}px`}
          onChange={(v) => onChange('font_meta', v)}
        />
      </Section>

      <Section title="Colores base" icon={<Palette className="h-3.5 w-3.5" />}>
        <ColorField
          label="Fondo del item"
          value={String(get('color_bg', 'rgba(15, 14, 22, 0.85)'))}
          onChange={(v) => onChange('color_bg', v)}
        />
        <ColorField
          label="Texto base"
          value={String(get('color_text', '#ffffff'))}
          onChange={(v) => onChange('color_text', v)}
        />
        <ColorField
          label="Acento (Spotify green)"
          value={String(get('color_accent', '#1DB954'))}
          onChange={(v) => onChange('color_accent', v)}
        />
        <ColorField
          label="Texto secundario"
          value={String(get('color_subtle', 'rgba(255, 255, 255, 0.55)'))}
          onChange={(v) => onChange('color_subtle', v)}
        />
        <SliderField
          label="Borde redondeado"
          value={Number(get('card_radius', 14))}
          min={0}
          max={32}
          format={(v) => `${v}px`}
          onChange={(v) => onChange('card_radius', v)}
        />
      </Section>

      <Section title="Colores tipografía (override)" icon={<Type className="h-3.5 w-3.5" />}>
        <p className="text-[10px] text-fg-subtle">
          Dejá vacío (en blanco) para usar el color base. Si lo seteás, sobrescribe el color base solo para ese elemento.
        </p>
        <ColorField
          label="Color del título de la canción"
          value={String(get('color_title', ''))}
          onChange={(v) => onChange('color_title', v)}
        />
        <ColorField
          label="Color del artista"
          value={String(get('color_artist', ''))}
          onChange={(v) => onChange('color_artist', v)}
        />
        <ColorField
          label="Color del meta (tiempo / playfan / @user)"
          value={String(get('color_meta', ''))}
          onChange={(v) => onChange('color_meta', v)}
        />
      </Section>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   ExtensibleFields — Subathon Timer (countdown extendible)
   ══════════════════════════════════════════════════════════════════════ */

interface Override {
  giftName: string;
  giftId?: string;
  iconPath?: string;
  coins?: number;
  seconds: number;
}

interface TimerState {
  remaining: number;
  running: boolean;
  initial: number;
  secondsPerCoin: number;
}

function fmtTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

function TimerControlPanel(): ReactNode {
  const [state, setState] = useState<TimerState | null>(null);
  const [tick, setTick] = useState(0);

  // Refresh state desde el sidecar cada 2s.
  useEffect(() => {
    const refresh = () => {
      void rpcCall('overlays.timer-state', {})
        .then((r: any) => setState(r))
        .catch(() => undefined);
    };
    refresh();
    const id = window.setInterval(refresh, 2000);
    return () => window.clearInterval(id);
  }, []);

  // Tick local cada 250ms para que el countdown visualice fluido.
  useEffect(() => {
    if (!state?.running) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 250);
    return () => window.clearInterval(id);
  }, [state?.running]);

  const displayed = useMemo(() => {
    if (!state) return 0;
    return state.remaining;
  }, [state, tick]);

  const call = (action: string, seconds?: number) => {
    void rpcCall('overlays.timer-control', { action, seconds })
      .then((r: any) =>
        setState((prev) => (prev ? { ...prev, remaining: r.remaining, running: r.running } : prev)),
      )
      .catch(() => undefined);
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-bg-base/40 p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            Tiempo restante
          </div>
          <div
            className={[
              'font-mono text-3xl font-black tabular-nums',
              state?.running ? 'text-accent' : 'text-fg-muted',
            ].join(' ')}
          >
            {state ? fmtTime(displayed) : '--:--'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => call(state?.running ? 'pause' : 'play')}
          className={[
            'flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors',
            state?.running
              ? 'bg-warning/20 text-warning hover:bg-warning/30'
              : 'bg-accent/20 text-accent hover:bg-accent/30',
          ].join(' ')}
        >
          {state?.running ? (
            <>
              <Pause className="h-4 w-4" /> Pausar
            </>
          ) : (
            <>
              <Play className="h-4 w-4" /> Play
            </>
          )}
        </button>
      </div>

      <CustomTimeRow
        label="Sumar tiempo (h:m:s)"
        onApply={(secs) => call('add', secs)}
        accent="accent"
      />
      <CustomTimeRow
        label="Restar tiempo (h:m:s)"
        onApply={(secs) => call('subtract', secs)}
        accent="danger"
      />

      <button
        type="button"
        onClick={() => {
          if (confirm('¿Resetear el timer al tiempo inicial?')) call('reset');
        }}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-bg-elev/40 py-2 text-xs font-bold text-fg-muted hover:border-fg-muted hover:text-fg"
      >
        <RotateCcw className="h-3.5 w-3.5" /> Resetear al tiempo inicial
      </button>
    </div>
  );
}

function CustomTimeRow({
  label,
  onApply,
  accent,
}: {
  label: string;
  onApply(secs: number): void;
  accent: 'accent' | 'danger';
}): ReactNode {
  const [h, setH] = useState(0);
  const [m, setM] = useState(1);
  const [s, setS] = useState(0);
  const total = Math.max(0, h) * 3600 + Math.max(0, m) * 60 + Math.max(0, s);
  const colorClass =
    accent === 'accent'
      ? 'bg-accent/20 text-accent hover:bg-accent/30 border-accent/40'
      : 'bg-danger/20 text-danger hover:bg-danger/30 border-danger/40';
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
        {label}
      </div>
      <div className="flex items-center gap-1">
        <NumberInput value={h} min={0} onChange={setH} className="!h-9 w-14 text-center" title="Horas" />
        <span className="text-fg-subtle">:</span>
        <NumberInput value={m} min={0} onChange={setM} className="!h-9 w-14 text-center" title="Minutos" />
        <span className="text-fg-subtle">:</span>
        <NumberInput value={s} min={0} onChange={setS} className="!h-9 w-14 text-center" title="Segundos" />
        <button
          type="button"
          disabled={total <= 0}
          onClick={() => onApply(total)}
          className={[
            'ml-1 flex-1 rounded-md border px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-40',
            colorClass,
          ].join(' ')}
        >
          Aplicar
        </button>
      </div>
    </div>
  );
}

function InitialTimeRow({
  value,
  onChange,
}: {
  value: number;
  onChange(v: number): void;
}): ReactNode {
  // Editable como hh / mm / ss separados.
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  const setHMS = (nh: number, nm: number, ns: number) => {
    const total = Math.max(0, nh) * 3600 + Math.max(0, nm) * 60 + Math.max(0, ns);
    onChange(total);
  };
  return (
    <FieldRow label={`Tiempo inicial: ${fmtTime(value)}`}>
      <div className="flex items-center gap-1.5">
        <NumberInput value={h} min={0} onChange={(n) => setHMS(n, m, s)} className="!h-9 w-16 text-center" />
        <span className="text-fg-subtle">:</span>
        <NumberInput value={m} min={0} max={59} onChange={(n) => setHMS(h, n, s)} className="!h-9 w-16 text-center" />
        <span className="text-fg-subtle">:</span>
        <NumberInput value={s} min={0} max={59} onChange={(n) => setHMS(h, m, n)} className="!h-9 w-16 text-center" />
        <span className="text-[10px] text-fg-subtle ml-1">h:m:s</span>
      </div>
    </FieldRow>
  );
}

function ExtensibleFields({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange(key: string, value: unknown): void;
}): ReactNode {
  const get = <T,>(k: string, fallback: T): T =>
    (config[k] as T) ?? fallback;
  const overrides = (Array.isArray(get('overrides', [])) ? get('overrides', []) : []) as Override[];

  const updateOverrides = (next: Override[]) => onChange('overrides', next);
  const removeOverride = (i: number) => updateOverrides(overrides.filter((_, idx) => idx !== i));
  const updateOverride = (i: number, patch: Partial<Override>) =>
    updateOverrides(overrides.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));

  return (
    <div className="space-y-2">
      <Section title="Control del timer" icon={<Play className="h-3.5 w-3.5" />} defaultOpen>
        <TimerControlPanel />
      </Section>

      <Section title="Cómo suma el tiempo" icon={<SettingsIcon className="h-3.5 w-3.5" />} defaultOpen>
        <InitialTimeRow
          value={Number(get('initial_seconds', 3600))}
          onChange={(v) => onChange('initial_seconds', v)}
        />

        <FieldRow
          label="Segundos por moneda"
          hint="Cada moneda donada suma estos segundos al countdown. Ej: 100 monedas × 3 = +300s."
        >
          <NumberInput
            value={Number(get('seconds_per_coin', 3))}
            min={0}
            onChange={(n) => onChange('seconds_per_coin', n)}
            className="!h-9"
          />
        </FieldRow>

        <ChoiceRow
          label="Formato del display"
          value={String(get('format', 'hms'))}
          options={[
            { v: 'hms', l: 'HH:MM:SS' },
            { v: 'ms', l: 'MM:SS' },
            { v: 's', l: 'Segundos' },
          ]}
          onChange={(v) => onChange('format', v)}
        />
      </Section>

      <Section
        title={`Overrides por gift (${overrides.length})`}
        icon={<Sparkles className="h-3.5 w-3.5" />}
        defaultOpen
      >
        <p className="text-[10px] text-fg-subtle">
          Estos gifts dan un tiempo FIJO en lugar de la fórmula. Ej: <code>Mishka → +500s</code> plano (sin importar cuántas monedas valga).
        </p>
        <OverridesGallery
          overrides={overrides}
          onAdd={(gift, secs) =>
            updateOverrides([
              ...overrides,
              {
                giftName: gift.name,
                giftId: gift.id,
                iconPath: gift.iconPath,
                coins: gift.coins,
                seconds: secs,
              },
            ])
          }
          onRemove={removeOverride}
          onUpdateSeconds={(i, secs) => updateOverride(i, { seconds: secs })}
        />
      </Section>

      <Section title="Tipografía" icon={<Type className="h-3.5 w-3.5" />}>
        <FieldRow label="Fuente">
          <select
            value={String(get('font_family', 'default'))}
            onChange={(e) => onChange('font_family', e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-bg-base px-2 text-xs"
          >
            <option value="default">Segoe UI (default)</option>
            <option value="bebas" style={{ fontFamily: "'Bebas Neue'" }}>Bebas Neue (alta, condensada)</option>
            <option value="oswald" style={{ fontFamily: 'Oswald' }}>Oswald (titular)</option>
            <option value="russo" style={{ fontFamily: "'Russo One'" }}>Russo One (gaming)</option>
            <option value="bungee" style={{ fontFamily: 'Bungee' }}>Bungee (impactante)</option>
            <option value="pixel" style={{ fontFamily: "'Press Start 2P'" }}>Press Start 2P (8-bit)</option>
            <option value="orbitron" style={{ fontFamily: 'Orbitron' }}>Orbitron (sci-fi)</option>
          </select>
        </FieldRow>
        <FieldRow label="Peso">
          <select
            value={String(get('font_weight', 900))}
            onChange={(e) => onChange('font_weight', Number(e.target.value))}
            className="h-9 w-full rounded-md border border-border bg-bg-base px-2 text-xs"
          >
            <option value="400">Regular (400)</option>
            <option value="600">Semi-bold (600)</option>
            <option value="700">Bold (700)</option>
            <option value="800">Extra-bold (800)</option>
            <option value="900">Black (900)</option>
          </select>
        </FieldRow>
        <SliderField
          label="Espaciado entre letras"
          value={Number(get('letter_spacing', -3))}
          min={-10}
          max={20}
          step={0.5}
          format={(v) => `${v}px`}
          onChange={(v) => onChange('letter_spacing', v)}
        />
        <SliderField
          label="Tamaño del número"
          value={Number(get('font_size', 84))}
          min={28}
          max={240}
          format={(v) => `${v}px`}
          onChange={(v) => onChange('font_size', v)}
        />
      </Section>

      <Section title="Estilo del card" icon={<Palette className="h-3.5 w-3.5" />}>
        <ColorField
          label="Color principal (glow / pop)"
          value={String(get('color_primary', '#ffd23f'))}
          onChange={(v) => onChange('color_primary', v)}
        />
        <ColorField
          label="Color del número"
          value={String(get('color_text', '#ffffff'))}
          onChange={(v) => onChange('color_text', v)}
        />
        <Toggle
          label="Mostrar fondo"
          checked={Boolean(get('show_bg', true))}
          onChange={(v) => onChange('show_bg', v)}
        />
        <SliderField
          label="Borde redondeado"
          value={Number(get('radius', 18))}
          min={0}
          max={48}
          format={(v) => `${v}px`}
          onChange={(v) => onChange('radius', v)}
        />
        <SliderField
          label="Padding horizontal"
          value={Number(get('padding_x', 28))}
          min={0}
          max={120}
          format={(v) => `${v}px`}
          onChange={(v) => onChange('padding_x', v)}
        />
        <SliderField
          label="Padding vertical"
          value={Number(get('padding_y', 14))}
          min={0}
          max={80}
          format={(v) => `${v}px`}
          onChange={(v) => onChange('padding_y', v)}
        />
      </Section>

      <Section title="Mensaje al terminar" icon={<Sparkles className="h-3.5 w-3.5" />}>
        <FieldRow label="Emoji al llegar a 0">
          <Input
            value={String(get('end_emoji', '💀'))}
            onChange={(e) => onChange('end_emoji', e.target.value)}
            placeholder="💀"
            className="!h-9 text-center text-xl"
          />
        </FieldRow>
        <FieldRow label="Mensaje (opcional)">
          <Input
            value={String(get('end_message', 'Se acabó'))}
            onChange={(e) => onChange('end_message', e.target.value)}
            placeholder="Se acabó"
          />
        </FieldRow>
      </Section>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   OverridesGallery — picker visual de gifts + segundos custom
   ══════════════════════════════════════════════════════════════════════ */

function OverridesGallery({
  overrides,
  onAdd,
  onRemove,
  onUpdateSeconds,
}: {
  overrides: Override[];
  onAdd(gift: DonationGift, seconds: number): void;
  onRemove(i: number): void;
  onUpdateSeconds(i: number, seconds: number): void;
}): ReactNode {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [secondsForNew, setSecondsForNew] = useState(60);

  return (
    <div className="space-y-2">
      {overrides.length > 0 && (
        <ul className="space-y-1.5">
          {overrides.map((o, i) => (
            <li
              key={`${o.giftId ?? o.giftName}-${i}`}
              className="flex items-center gap-2 rounded-md border border-border bg-bg-base/40 px-2 py-1.5"
            >
              {o.iconPath ? (
                <MaruImage
                  scope="donaciones"
                  path={
                    o.iconPath.startsWith('donaciones/')
                      ? o.iconPath.slice('donaciones/'.length)
                      : o.iconPath
                  }
                  size={36}
                  fallback="🎁"
                  className="shrink-0 rounded object-contain"
                />
              ) : (
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-bg-elev/60 text-base">
                  🎁
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold">{o.giftName}</div>
                {typeof o.coins === 'number' && (
                  <div className="text-[10px] text-fg-subtle">
                    {o.coins} 💎
                  </div>
                )}
              </div>
              <NumberInput
                value={o.seconds}
                min={0}
                onChange={(n) => onUpdateSeconds(i, n)}
                className="!h-9 w-20 text-center font-bold"
                title="Segundos"
              />
              <span className="text-[10px] text-fg-subtle">s</span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="grid h-7 w-7 place-items-center rounded text-fg-subtle hover:bg-danger/10 hover:text-danger"
                title="Eliminar"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Selector de cuántos segundos dará el siguiente override */}
      <div className="flex items-center gap-2 rounded-md border border-border bg-bg-base/30 p-2">
        <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
          Segundos que dará el próximo gift:
        </span>
        <NumberInput
          value={secondsForNew}
          min={0}
          onChange={setSecondsForNew}
          className="!h-8 w-20 text-center font-bold"
        />
        <span className="text-[10px] text-fg-subtle">s</span>
      </div>

      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-border bg-bg-base/20 px-3 py-3 text-xs font-bold text-fg-muted hover:border-accent hover:text-accent"
      >
        <Plus className="h-3.5 w-3.5" />
        Elegir gift desde galería
      </button>

      {pickerOpen && (
        <GiftSelectorDialog
          open
          title="🎁 Elegí el gift override"
          excludeIds={overrides.map((o) => o.giftId ?? '').filter(Boolean)}
          onSelect={(g) => {
            onAdd(g, secondsForNew);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   GoalActionsEditor — lista de acciones al cumplir la meta del taps
   ══════════════════════════════════════════════════════════════════════ */

interface Action {
  kind: 'spawn' | 'item' | 'event';
  gameId: string;
  name: string;
  label: string;
  amount: number;
  imagePath?: string;
  category?: string;
}

interface GameInfo {
  id: string;
  name: string;
}

const CAT_TO_KIND: Record<string, Action['kind']> = {
  entities: 'spawn',
  items: 'item',
  events: 'event',
  // Fallback: cualquier categoría custom se mapea a "event" (trigger).
};

function categoryToKind(cat: string): Action['kind'] {
  const k = CAT_TO_KIND[cat.toLowerCase()];
  return k || 'event';
}

function GoalActionsEditor({
  actions,
  onChange,
}: {
  actions: Action[];
  onChange(next: Action[]): void;
}): ReactNode {
  const [games, setGames] = useState<GameInfo[]>([]);
  const [gameId, setGameId] = useState<string>('');
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    void rpcCall('games.list', {})
      .then((r: any) => {
        const list: GameInfo[] = (r.games || []).map((g: any) => ({
          id: g.id,
          name: g.name || g.id,
        }));
        setGames(list);
        if (list.length && !gameId) setGameId(list[0].id);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeAction = (i: number) => {
    onChange(actions.filter((_, idx) => idx !== i));
  };

  const handleConfirmMulti = (selections: MultiSelection[]) => {
    const next: Action[] = selections.map((s) => ({
      kind: categoryToKind(s.category),
      gameId,
      name: s.command,
      label: s.displayName,
      amount: s.amount > 0 ? s.amount : 1,
      imagePath: s.imagePath,
      category: s.category,
    }));
    onChange([...actions, ...next]);
    setPickerOpen(false);
  };

  return (
    <div className="space-y-2">
      {/* Selector de juego */}
      {games.length === 0 ? (
        <p className="text-[11px] italic text-fg-subtle">
          Sin juegos configurados. Agregá un juego primero.
        </p>
      ) : (
        <FieldRow label="Juego (al que se mandarán las acciones)">
          <select
            value={gameId}
            onChange={(e) => setGameId(e.target.value)}
            className="w-full rounded-md border border-border bg-bg-base px-2 py-1.5 text-xs"
          >
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </FieldRow>
      )}

      {/* Lista de acciones acumuladas con imagen real */}
      {actions.length > 0 && (
        <ul className="space-y-1.5">
          {actions.map((a, i) => (
            <li
              key={`${a.gameId}-${a.kind}-${a.name}-${i}`}
              className="flex items-center gap-2 rounded-md border border-border bg-bg-base/40 px-2 py-1.5"
            >
              {a.imagePath && (
                <MaruImage
                  scope="game"
                  path={
                    a.imagePath.startsWith('game/')
                      ? a.imagePath.slice('game/'.length)
                      : a.imagePath
                  }
                  size={36}
                  fallback="📦"
                  className="shrink-0 rounded object-contain"
                />
              )}
              <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent">
                {a.kind === 'spawn' ? 'Entidad' : a.kind === 'item' ? 'Item' : 'Evento'}
              </span>
              <span className="flex-1 truncate text-xs">
                <strong>{a.label}</strong>
                {a.amount > 1 && <span className="text-fg-subtle"> ×{a.amount}</span>}
                <span className="text-fg-subtle"> — {a.gameId}</span>
              </span>
              <button
                type="button"
                onClick={() => removeAction(i)}
                className="grid h-6 w-6 place-items-center rounded text-fg-subtle hover:bg-danger/10 hover:text-danger"
                title="Eliminar"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        disabled={!gameId}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-border bg-bg-base/20 px-3 py-3 text-xs font-bold text-fg-muted transition-colors hover:border-accent hover:bg-accent/10 hover:text-accent disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />
        Elegir desde galería del juego
      </button>

      {actions.length > 0 && (
        <p className="text-[10px] text-fg-subtle">
          Cuando los likes alcancen la meta, MARU dispara estas {actions.length} acciones al juego y aparecen en el log con tag <code>🎯 Meta de likes</code>.
        </p>
      )}

      {pickerOpen && gameId && (
        <EntitySelectorDialog
          open
          gameId={gameId as any}
          multiSelect
          title="Galería del juego — elegí acciones para la meta"
          onConfirmMulti={handleConfirmMulti}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

function PositionGrid({
  alignH,
  alignV,
  onChange,
}: {
  alignH: string;
  alignV: string;
  onChange(h: string, v: string): void;
}): ReactNode {
  const HS = ['left', 'center', 'right'];
  const VS = ['top', 'center', 'bottom'];
  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-bg-base/40 p-2">
      {VS.map((v) =>
        HS.map((h) => {
          const active = h === alignH && v === alignV;
          return (
            <button
              key={`${v}-${h}`}
              type="button"
              onClick={() => onChange(h, v)}
              className={[
                'aspect-square rounded transition-colors',
                active
                  ? 'bg-accent ring-2 ring-accent/40'
                  : 'bg-bg-elev/40 hover:bg-bg-elev',
              ].join(' ')}
              title={`${h} / ${v}`}
            />
          );
        }),
      )}
    </div>
  );
}
