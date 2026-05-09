import { useEffect, useId, useRef, useState } from 'react';
import {
  Edit3,
  Keyboard,
  Loader2,
  Plus,
  Settings as SettingsIcon,
  X,
} from 'lucide-react';
import { Button, Input, Label, Select } from '@maru/ui';
import { rpcCall } from '../../../lib/rpc.js';

/**
 * `KeyboardActionEditor` — editor para acciones de teclado en RuleDialog.
 *
 * Schema generado en `RuleAction`:
 *   action_type      = "keyboard"
 *   action_type_name = "⌨️ Tecla del teclado"
 *   action_value     = spec, ej "Ctrl+Alt+W" / "Space" / "F4"
 *   amount           = repeat (1..50)
 *   commands         = config opcional, ej "hold:500" / "window:Minecraft" /
 *                      "hold:300;window:Valheim"
 *
 * El parser real vive en `apps/sidecar/.../keyboard.py:parse_key_spec`.
 * Acá replicamos solo la captura de pulsaciones (key recorder) — la
 * validación dura corre en backend cuando ejecutás "Probar" o cuando
 * dispara un trigger en vivo.
 */
export interface KeyboardActionDraft {
  keys: string;
  mode: 'tap' | 'hold';
  holdMs: number;
  repeat: number;
  windowFilter: string;
}

export interface KeyboardActionEditorProps {
  draft: KeyboardActionDraft;
  onChange: (next: KeyboardActionDraft) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  editingIdx: number | null;
  disabled?: boolean;
  /** Si el toggle global está OFF, mostramos warning con CTA. */
  globallyEnabled: boolean;
  onRequestEnable: () => void;
}

const MODIFIER_KEYS = new Set([
  'Control',
  'Alt',
  'AltGraph',
  'Shift',
  'Meta',
  'OS',
]);

/** Tipo común que cubre `KeyboardEvent` nativo (document listener)
 * y `React.KeyboardEvent` (handler React). Las APIs que uso son
 * idénticas en ambos. */
type AnyKeyEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>;

/** Mapea `KeyboardEvent.key` al label que el user verá Y que el parser
 * Python (`keyboard.py:parse_key_spec`) entiende.
 *
 * Devuelve el label "humano" capitalizado (`"W"`, `"Space"`, `"F4"`,
 * `"ArrowUp"`). El parser Python es case-insensitive y normaliza, así
 * que `"Space"` o `"space"` o `"SPACE"` funcionan igual.
 *
 * IMPORTANTE: si `e.key` es un modifier solo (Control/Alt/Shift/Meta)
 * devuelve null — eso lo manejamos aparte (pueden ser tecla principal
 * o sólo accesorio según contexto).
 */
function nonModifierKeyLabel(e: AnyKeyEvent): string | null {
  const k = e.key;
  if (MODIFIER_KEYS.has(k)) return null;
  // Letra única — siempre capital.
  if (k.length === 1) {
    if (/[a-zA-Z]/.test(k)) return k.toUpperCase();
    return k; // símbolos: '1', '/', '?', '+', 'ñ', acentos, etc.
  }
  // Special keys — nombres "humanos" que entiende el parser Python.
  const labelMap: Record<string, string> = {
    ' ': 'Space',
    Spacebar: 'Space',
    Enter: 'Enter',
    Escape: 'Esc',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'ArrowUp',
    ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',
    CapsLock: 'CapsLock',
    NumLock: 'NumLock',
    ScrollLock: 'ScrollLock',
    Pause: 'Pause',
    PrintScreen: 'PrintScreen',
    ContextMenu: 'Menu',
  };
  if (labelMap[k]) return labelMap[k];
  if (/^F\d{1,2}$/.test(k)) return k; // F1..F24 ya capital.
  // Fallback: capitalizar primera letra.
  if (k.length <= 12) {
    return k.charAt(0).toUpperCase() + k.slice(1).toLowerCase();
  }
  return null;
}

/** Construye spec desde un keydown. Acepta:
 * - Tecla principal con/sin modifiers: "W", "Ctrl+W", "Alt+F4", "Ctrl+Shift+F"
 * - Solo modifiers: "Ctrl", "Shift", "Ctrl+Shift" — útiles para juegos
 *   que detectan modifier solo (crouch en shooters, etc).
 *
 * Acepta tanto `KeyboardEvent` nativo (document listener) como
 * `React.KeyboardEvent` — las APIs que usa son idénticas.
 *
 * Devuelve `null` SOLO si no hay nada que capturar (caso imposible salvo
 * eventos sintéticos sin key). */
function buildSpecFromEventNative(e: AnyKeyEvent): string | null {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Win');

  const mainLabel = nonModifierKeyLabel(e);
  if (mainLabel) {
    parts.push(mainLabel);
  } else {
    // El key fue un modifier solo. Si NO hay modifier presente todavía
    // (caso raro: keydown de Control sin que ctrlKey esté true por
    // race del navegador), agregamos el modifier según e.key.
    // Caso normal: presiona Ctrl → e.key='Control', e.ctrlKey=true
    // → ya cubierto arriba con parts=['Ctrl']. No agregamos nada más.
    if (parts.length === 0) {
      // Edge case: e.key dice Control pero ctrlKey no se actualizó.
      // Mapeamos directo.
      const modMap: Record<string, string> = {
        Control: 'Ctrl',
        Alt: 'Alt',
        AltGraph: 'Alt',
        Shift: 'Shift',
        Meta: 'Win',
        OS: 'Win',
      };
      const m = modMap[e.key];
      if (m) parts.push(m);
    }
  }

  if (parts.length === 0) return null;
  return parts.join('+');
}

/** Serializa el draft al schema (action_value + commands) que persiste el backend. */
export function serializeKeyboardDraft(draft: KeyboardActionDraft): {
  action_value: string;
  commands: string;
  amount: number;
} {
  const cfgParts: string[] = [];
  if (draft.mode === 'hold' && draft.holdMs > 0) {
    cfgParts.push(`hold:${Math.max(1, Math.min(10_000, Math.floor(draft.holdMs)))}`);
  }
  if (draft.windowFilter.trim()) {
    cfgParts.push(`window:${draft.windowFilter.trim()}`);
  }
  return {
    action_value: draft.keys.trim(),
    commands: cfgParts.join(';'),
    amount: Math.max(1, Math.min(50, Math.floor(draft.repeat) || 1)),
  };
}

export function parseKeyboardCommands(commands: string): {
  mode: 'tap' | 'hold';
  holdMs: number;
  windowFilter: string;
} {
  const cfg: Record<string, string> = {};
  if (commands) {
    for (const chunk of commands.split(';')) {
      const trimmed = chunk.trim();
      if (!trimmed || !trimmed.includes(':')) continue;
      const [k, ...rest] = trimmed.split(':');
      const v = rest.join(':').trim();
      if (k && v) cfg[k.trim().toLowerCase()] = v;
    }
  }
  const holdRaw = parseInt(cfg.hold ?? '', 10);
  const holdMs = Number.isFinite(holdRaw) && holdRaw > 0 ? holdRaw : 0;
  return {
    mode: holdMs > 0 ? 'hold' : 'tap',
    holdMs: holdMs > 0 ? holdMs : 500,
    windowFilter: cfg.window ?? '',
  };
}

export function emptyKeyboardDraft(): KeyboardActionDraft {
  return {
    keys: '',
    mode: 'tap',
    holdMs: 500,
    repeat: 1,
    windowFilter: '',
  };
}

export function KeyboardActionEditor({
  draft,
  onChange,
  onSubmit,
  onCancel,
  editingIdx,
  disabled = false,
  globallyEnabled,
  onRequestEnable,
}: KeyboardActionEditorProps) {
  const idPrefix = useId();
  const [recording, setRecording] = useState(false);
  const [advanced, setAdvanced] = useState(
    Boolean(draft.windowFilter) || draft.mode === 'hold',
  );
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const recorderRef = useRef<HTMLInputElement | null>(null);
  // Debounce para auto-confirmar después de N ms sin nuevo keydown.
  // Con esto el user puede presionar Ctrl, después W (mientras Ctrl
  // sigue presionado): cada keydown actualiza la combinación visible
  // ("Ctrl" → "Ctrl+W"). Después de 600ms sin nuevo evento, se fija.
  const autoConfirmTimerRef = useRef<number | null>(null);
  // Track de la última spec capturada (para mostrar en vivo durante
  // recording incluso antes del confirm).
  const [livePreview, setLivePreview] = useState<string>('');
  // Refs para acceso SÍNCRONO desde el listener global del document.
  // Sin esto, el handler vive con un closure stale del primer render.
  const livePreviewRef = useRef(livePreview);
  const draftRef = useRef(draft);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    livePreviewRef.current = livePreview;
  }, [livePreview]);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Si el draft viene con windowFilter o hold, mantener avanzado abierto.
  useEffect(() => {
    if (draft.windowFilter || draft.mode === 'hold') setAdvanced(true);
  }, [draft.windowFilter, draft.mode]);

  // Cleanup del timer al desmontar / al cambiar de modo.
  useEffect(() => {
    return () => {
      if (autoConfirmTimerRef.current !== null) {
        window.clearTimeout(autoConfirmTimerRef.current);
      }
    };
  }, []);

  // Auto-focus al input cuando arranca recording. Usa useEffect (no
  // setTimeout en el handler) para evitar race con el render de React
  // que podía hacer que el focus llegue antes del re-render.
  useEffect(() => {
    if (recording) {
      recorderRef.current?.focus();
      setLivePreview('');
    }
  }, [recording]);

  // ── Captura global durante grabación ──────────────────────────────────
  //
  // PROBLEMA con onKeyDown del input: ciertas teclas tienen comportamiento
  // del browser/Electron que ocurre ANTES de que React procese el handler:
  //   - `Tab` mueve el focus al siguiente elemento focusable
  //   - `Alt` activa el menú de la ventana en Windows/Electron
  //   - `F10` también activa menú
  //   - `F12` puede abrir DevTools en builds de dev
  //
  // SOLUCIÓN: agregar listener al `document` con `capture: true` mientras
  // recording=true. La fase de captura corre ANTES de que el evento llegue
  // al elemento target → preventDefault() bloquea el comportamiento default
  // de Tab/Alt/F-keys ANTES de que el browser actúe sobre ellas.
  //
  // Nos desuscribimos cuando recording vuelve a false.
  useEffect(() => {
    if (!recording) return;

    const handler = (e: KeyboardEvent) => {
      // Bloquear TODAS las acciones default del browser para esta tecla:
      // Tab no mueve focus, Alt no abre menú, F-keys no abren DevTools,
      // letras/números no se tipean en el input.
      e.preventDefault();
      e.stopPropagation();

      // Esc cancela la grabación sin guardar.
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        finalizeRecording('');
        return;
      }

      const spec = buildSpecFromEventNative(e);
      if (!spec) return;

      // Actualizar preview en vivo + draft (vía refs para usar valores actuales).
      setLivePreview(spec);
      onChangeRef.current({ ...draftRef.current, keys: spec });

      // Reset debounce de auto-confirm.
      if (autoConfirmTimerRef.current !== null) {
        window.clearTimeout(autoConfirmTimerRef.current);
      }
      autoConfirmTimerRef.current = window.setTimeout(() => {
        finalizeRecording(spec);
      }, 600);
    };

    const upHandler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const released = e.key;
      if (MODIFIER_KEYS.has(released)) return;
      // Confirmar instantáneo al soltar tecla principal.
      if (livePreviewRef.current) {
        finalizeRecording(livePreviewRef.current);
      }
    };

    // `capture: true` hace que el handler corra en la FASE DE CAPTURA del
    // DOM event, antes de que el evento llegue al input. Esto permite
    // bloquear Tab/Alt/F-keys antes que el browser actúe.
    document.addEventListener('keydown', handler, { capture: true });
    document.addEventListener('keyup', upHandler, { capture: true });

    return () => {
      document.removeEventListener('keydown', handler, { capture: true });
      document.removeEventListener('keyup', upHandler, { capture: true });
    };
    // Intencionalmente solo [recording]: el listener accede a draft,
    // onChange y livePreview vía refs para evitar re-crearse en cada
    // tipeo o cambio de draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  function finalizeRecording(spec: string) {
    if (autoConfirmTimerRef.current !== null) {
      window.clearTimeout(autoConfirmTimerRef.current);
      autoConfirmTimerRef.current = null;
    }
    if (spec) onChange({ ...draft, keys: spec });
    setRecording(false);
    setLivePreview('');
    recorderRef.current?.blur();
  }

  function startRecording() {
    setLivePreview('');
    setRecording(true);
  }

  function clearKeys() {
    if (autoConfirmTimerRef.current !== null) {
      window.clearTimeout(autoConfirmTimerRef.current);
      autoConfirmTimerRef.current = null;
    }
    onChange({ ...draft, keys: '' });
    setLivePreview('');
    setRecording(false);
  }

  async function runTest() {
    if (!draft.keys.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const ser = serializeKeyboardDraft(draft);
      const res = await rpcCall('keyboard.test', {
        keys: ser.action_value,
        amount: ser.amount,
        commands: ser.commands,
      });
      setTestResult({ ok: res.ok, message: res.message });
    } catch (ex) {
      setTestResult({
        ok: false,
        message: ex instanceof Error ? ex.message : String(ex),
      });
    } finally {
      setTesting(false);
    }
  }

  const canSubmit = !disabled && draft.keys.trim().length > 0;

  return (
    <div className="space-y-3">
      {!globallyEnabled && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning flex items-center gap-2">
          <span className="text-base">🔒</span>
          <span className="flex-1">
            Las acciones de teclado están <strong>desactivadas globalmente</strong>.
            Las reglas que las usen no harán nada hasta activarlas.
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onRequestEnable}
          >
            Activar
          </Button>
        </div>
      )}

      <div className="grid grid-cols-[2fr_80px] gap-2">
        <div>
          <Label htmlFor={`${idPrefix}-keys`} required>
            Combinación
          </Label>
          <div className="flex gap-1">
            <Input
              ref={recorderRef}
              id={`${idPrefix}-keys`}
              // Durante recording mostramos el livePreview (lo último
              // que capturamos) — refleja el combo CURRENT antes de
              // confirmar. Fuera de recording, mostramos el spec final
              // o un placeholder de ayuda si está vacío.
              value={
                recording
                  ? livePreview || 'Esperando teclas…'
                  : draft.keys
              }
              // SIEMPRE readOnly. Para configurar el spec hay que ir
              // por el botón "Grabar" o clickear el input — esto evita
              // que el user piense que tiene que tipear el nombre de
              // la tecla a mano (caso confuso reportado).
              onChange={() => undefined}
              onClick={() => {
                if (!disabled && !recording) startRecording();
              }}
              placeholder="Click acá o en «Grabar» para capturar la combinación"
              disabled={disabled}
              readOnly
              title={
                recording
                  ? 'Presioná tu combinación de teclas'
                  : 'Click para empezar a grabar'
              }
              className={
                recording
                  ? 'ring-2 ring-accent border-accent font-mono bg-accent/5 cursor-default'
                  : 'font-mono cursor-pointer hover:border-accent/60'
              }
            />
            <Button
              type="button"
              variant={recording ? 'primary' : 'secondary'}
              size="sm"
              onClick={recording ? () => finalizeRecording(livePreview) : startRecording}
              disabled={disabled}
              title={
                recording
                  ? 'Confirmar combinación capturada'
                  : 'Capturar combinación presionando teclas'
              }
            >
              <Keyboard className="h-3.5 w-3.5" />
              {recording ? 'Listo' : 'Grabar'}
            </Button>
            {!recording && draft.keys && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearKeys}
                disabled={disabled}
                title="Limpiar"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          {recording ? (
            <p className="mt-1 text-[11px] text-accent">
              🎤 Presioná tu combinación (1, 2 o más teclas). Esc cancela.
              Auto-confirma cuando soltás.
            </p>
          ) : (
            <p className="mt-1 text-[10px] text-fg-subtle">
              Captura cualquier tecla del teclado: letras, números,
              <code> F1-F12</code>, <code>Tab</code>, <code>Alt</code>,
              <code> Space</code>, flechas, modifiers solos (<code>Ctrl</code>,
              <code> Shift</code>) o combos.
            </p>
          )}
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-rep`}>Repetir</Label>
          <Input
            id={`${idPrefix}-rep`}
            type="number"
            min={1}
            max={50}
            value={String(draft.repeat)}
            onChange={(e) =>
              onChange({
                ...draft,
                repeat: Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1)),
              })
            }
            disabled={disabled}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-fg-base">Modo:</span>
        <Select
          value={draft.mode}
          onChange={(e) =>
            onChange({ ...draft, mode: e.target.value as 'tap' | 'hold' })
          }
          disabled={disabled}
          className="!w-auto"
        >
          <option value="tap">⚡ Tap (presionar y soltar)</option>
          <option value="hold">⏱️ Mantener presionado</option>
        </Select>
        {draft.mode === 'hold' && (
          <>
            <span className="text-xs font-medium text-fg-base">Duración:</span>
            <Input
              type="number"
              min={50}
              max={10_000}
              step={50}
              value={String(draft.holdMs)}
              onChange={(e) =>
                onChange({
                  ...draft,
                  holdMs: Math.max(
                    50,
                    Math.min(10_000, parseInt(e.target.value, 10) || 500),
                  ),
                })
              }
              disabled={disabled}
              className="!w-24"
            />
            <span className="text-xs text-fg-muted">ms</span>
          </>
        )}
        <button
          type="button"
          className="ml-auto text-[11px] text-fg-subtle hover:text-fg-base inline-flex items-center gap-1"
          onClick={() => setAdvanced((v) => !v)}
        >
          <SettingsIcon className="h-3 w-3" />
          {advanced ? 'Ocultar avanzado' : 'Avanzado'}
        </button>
      </div>

      {advanced && (
        <div className="rounded-md border border-border bg-bg-base/40 p-2 space-y-1">
          <Label htmlFor={`${idPrefix}-win`}>
            Solo si esta ventana está enfocada (opcional)
          </Label>
          <Input
            id={`${idPrefix}-win`}
            value={draft.windowFilter}
            onChange={(e) =>
              onChange({ ...draft, windowFilter: e.target.value })
            }
            placeholder="ej. Minecraft, Valheim, Chrome"
            disabled={disabled}
          />
          <p className="text-[10px] text-fg-subtle">
            Filtra por título parcial (case-insensitive). Si no coincide, la
            acción se salta silenciosamente — útil para no enviar teclas a MARU
            mismo si está enfocado.
          </p>
        </div>
      )}

      {testResult && (
        <div
          aria-live="polite"
          className={
            'rounded-md px-3 py-1.5 text-xs ' +
            (testResult.ok
              ? 'border border-success/40 bg-success/10 text-success'
              : 'border border-danger/40 bg-danger/10 text-danger')
          }
        >
          {testResult.message}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void runTest()}
          disabled={disabled || testing || !draft.keys.trim()}
          title="Probar la combinación de teclas ahora"
        >
          {testing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Keyboard className="h-3 w-3" />
          )}
          Probar
        </Button>
        <div className="flex gap-2">
          {editingIdx !== null && onCancel && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={disabled}
            >
              Cancelar
            </Button>
          )}
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onSubmit}
            disabled={!canSubmit}
          >
            {editingIdx !== null ? (
              <>
                <Edit3 className="h-3 w-3" /> Guardar
              </>
            ) : (
              <>
                <Plus className="h-3 w-3" /> Añadir
              </>
            )}
          </Button>
        </div>
      </div>

    </div>
  );
}
