import { useEffect, useId, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button, Dialog, Input, Label, Select, Switch } from '@maru/ui';
import type {
  CreateCustomGameInput,
  GameCategory,
  GameConnectionType,
  GameId,
  GameProfile,
} from '@maru/shared';
import { useGames } from '../../../lib/use-games.js';
import { CategoriesEditor } from './CategoriesEditor.js';
import { CUSTOM_GAME_PRESETS } from './presets.js';

/**
 * `CustomGameDialog` — crear / editar perfil de juego custom.
 *
 * Réplica de `custom_game_dialog.py:CustomGameDialog` (837 líneas):
 *   - 📋 Información Básica (id, name, icon).
 *   - 🔌 Tipo de Conexión (HTTP / RCON).
 *   - 🔗 Conexión (host, port, password).
 *   - 🎯 Presets (Valheim/Terraria/7Days/Rust).
 *   - 📁 Categorías + ⚙️ Configuración (CategoriesEditor).
 *   - Toggles de share_sounds / share_voices.
 *
 * Para juegos STANDARD (valheim/terraria/minecraft):
 *   - id deshabilitado.
 *   - NO se permite cambiar connectionType ni categorías.
 *   - Mostrar solo conexión + tab_names + (Minecraft) password.
 *
 * Validación:
 *   - id: regex `[a-zA-Z_][a-zA-Z0-9_]{1,31}`.
 *   - id no estándar y no duplicado en create.
 *   - name no vacío al guardar.
 */
export interface CustomGameDialogProps {
  open: boolean;
  onClose: () => void;
  /** Si presente, modo EDIT del perfil con ese id. Si null/undefined → create. */
  editingId?: GameId | null;
  /** Llamado cuando se crea/edita OK. */
  onSaved?: (profile: GameProfile) => void;
}

const ID_RE = /^[a-zA-Z_][a-zA-Z0-9_]{1,31}$/;

export function CustomGameDialog({
  open,
  onClose,
  editingId = null,
  onSaved,
}: CustomGameDialogProps) {
  const { games, byId, createCustom, updateGame } = useGames({
    autoLoad: false,
  });
  const editing = editingId ? byId(editingId) : null;
  const isEdit = !!editing;
  const isStandard = editing?.isStandard ?? false;

  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🎮');
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState(5000);
  const [password, setPassword] = useState('');
  const [connectionType, setConnectionType] =
    useState<GameConnectionType>('http');
  const [categories, setCategories] = useState<GameCategory[]>([]);
  const [shareSounds, setShareSounds] = useState(true);
  const [shareVoices, setShareVoices] = useState(true);
  const [tabEntities, setTabEntities] = useState('');
  const [tabItems, setTabItems] = useState('');
  const [tabEvents, setTabEvents] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idPrefix = useId();

  // Snapshot del estado inicial para detectar cambios sin guardar.
  // Se reinicia cada vez que el dialog abre (cambia `open` o `editing`).
  const initialSnapshot = useMemo(() => {
    if (!open) return '';
    if (editing) {
      return JSON.stringify({
        id: editing.id,
        name: editing.name,
        icon: editing.icon,
        host: editing.connection.host,
        port: editing.connection.port,
        password: editing.connection.password ?? '',
        connectionType: editing.connectionType,
        categories: editing.categories,
        shareSounds: editing.shareSounds,
        shareVoices: editing.shareVoices,
        tabEntities: editing.tabNames?.entities ?? '',
        tabItems: editing.tabNames?.items ?? '',
        tabEvents: editing.tabNames?.events ?? '',
      });
    }
    return JSON.stringify({
      id: '',
      name: '',
      icon: '🎮',
      host: '127.0.0.1',
      port: 5000,
      password: '',
      connectionType: 'http',
      categories: [],
      shareSounds: true,
      shareVoices: true,
      tabEntities: '',
      tabItems: '',
      tabEvents: '',
    });
  }, [open, editing]);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setId(editing.id);
      setName(editing.name);
      setIcon(editing.icon);
      setHost(editing.connection.host);
      setPort(editing.connection.port);
      setPassword(editing.connection.password ?? '');
      setConnectionType(editing.connectionType);
      setCategories(editing.categories);
      setShareSounds(editing.shareSounds);
      setShareVoices(editing.shareVoices);
      setTabEntities(editing.tabNames?.entities ?? '');
      setTabItems(editing.tabNames?.items ?? '');
      setTabEvents(editing.tabNames?.events ?? '');
    } else {
      setId('');
      setName('');
      setIcon('🎮');
      setHost('127.0.0.1');
      setPort(5000);
      setPassword('');
      setConnectionType('http');
      setCategories([]);
      setShareSounds(true);
      setShareVoices(true);
      setTabEntities('');
      setTabItems('');
      setTabEvents('');
    }
    setError(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  if (!open) return null;

  const idDuplicate =
    !isEdit && games.some((g) => g.id.toLowerCase() === id.toLowerCase());
  const idValid = ID_RE.test(id) && !idDuplicate;
  const nameValid = name.trim().length > 0;
  const portValid = port >= 1 && port <= 65535;
  const canSave = idValid && nameValid && portValid && !busy;

  // Dirty check: comparamos snapshot inicial vs estado actual.
  // Sin esto, click-fuera del dialog cerraba sin warning y el user
  // perdía las ediciones (caso reportado: editar nombres de
  // categorías custom y "se revertía").
  const dirty = useMemo(() => {
    const current = JSON.stringify({
      id,
      name,
      icon,
      host,
      port,
      password,
      connectionType,
      categories,
      shareSounds,
      shareVoices,
      tabEntities,
      tabItems,
      tabEvents,
    });
    return current !== initialSnapshot;
  }, [
    id, name, icon, host, port, password, connectionType, categories,
    shareSounds, shareVoices, tabEntities, tabItems, tabEvents,
    initialSnapshot,
  ]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const conn = { host, port, password };
      if (isEdit) {
        if (isStandard) {
          // Standard: solo conexión + tab_names.
          const tabNames = {
            entities: tabEntities || undefined,
            items: tabItems || undefined,
            events: tabEvents || undefined,
          };
          const profile = await updateGame(editing!.id, {
            connection: conn,
            tabNames,
          });
          onSaved?.(profile);
        } else {
          const profile = await updateGame(editing!.id, {
            name,
            icon,
            connection: conn,
            connectionType,
            categories,
            shareSounds,
            shareVoices,
          });
          onSaved?.(profile);
        }
      } else {
        const input: CreateCustomGameInput = {
          id,
          name,
          icon,
          connection: conn,
          connectionType,
          categories,
          shareSounds,
          shareVoices,
        };
        const profile = await createCustom(input);
        onSaved?.(profile);
      }
      onClose();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  }

  function applyPreset(presetIdx: number) {
    const p = CUSTOM_GAME_PRESETS[presetIdx];
    if (!p) return;
    setConnectionType(p.connectionType);
    setPort(p.port);
    setCategories(p.categories.map((c) => ({ ...c })));
  }

  const title = isEdit
    ? isStandard
      ? `⚙️ Configurar ${editing!.name}`
      : `✏️ Editar ${editing!.name}`
    : '➕ Añadir Juego Personalizado';

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      bodyFlush
      unsavedChanges={dirty && !busy}
      title={title}
      description={
        isStandard
          ? 'Los juegos predefinidos solo permiten editar conexión y nombres de pestañas.'
          : 'Definí endpoints o RCON commands para conectar tu juego.'
      }
    >
      <form
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col min-h-0 overflow-hidden"
      >
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          {/* 📋 Información Básica */}
          <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
              📋 Información Básica
            </legend>
            <div className="grid grid-cols-[1fr_2fr_80px] gap-2">
              <div>
                <Label htmlFor={`${idPrefix}-id`} required>
                  Game ID
                </Label>
                <Input
                  id={`${idPrefix}-id`}
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  placeholder="ark, 7daystodie, rust..."
                  disabled={isEdit || busy}
                  invalid={!!id && !idValid}
                  className="font-mono text-xs"
                />
                {idDuplicate && (
                  <p className="mt-1 text-[11px] text-danger">
                    Ya existe.
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor={`${idPrefix}-name`} required>
                  Nombre
                </Label>
                <Input
                  id={`${idPrefix}-name`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ARK: Survival, 7 Days to Die..."
                  invalid={!nameValid && name.length > 0}
                  disabled={busy}
                />
              </div>
              <div>
                <Label htmlFor={`${idPrefix}-icon`}>Icono</Label>
                <Input
                  id={`${idPrefix}-icon`}
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  maxLength={4}
                  disabled={busy || isStandard}
                  className="font-emoji text-center"
                />
              </div>
            </div>
          </fieldset>

          {/* 🔌 Tipo de Conexión + 🔗 Conexión */}
          <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
              🔌 Conexión
            </legend>

            {!isStandard && (
              <div className="flex items-center gap-3">
                <span className="text-xs text-fg-muted">Tipo:</span>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name={`${idPrefix}-conntype`}
                    value="http"
                    checked={connectionType === 'http'}
                    onChange={() => setConnectionType('http')}
                    disabled={busy}
                  />
                  <span>🌐 HTTP</span>
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name={`${idPrefix}-conntype`}
                    value="rcon"
                    checked={connectionType === 'rcon'}
                    onChange={() => setConnectionType('rcon')}
                    disabled={busy}
                  />
                  <span>🎮 RCON</span>
                </label>
              </div>
            )}

            <div className="grid grid-cols-[2fr_1fr_2fr] gap-2">
              <div>
                <Label htmlFor={`${idPrefix}-host`} required>
                  Host
                </Label>
                <Input
                  id={`${idPrefix}-host`}
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div>
                <Label htmlFor={`${idPrefix}-port`} required>
                  Puerto
                </Label>
                <Input
                  id={`${idPrefix}-port`}
                  type="number"
                  min={1}
                  max={65535}
                  value={String(port || '')}
                  onChange={(e) =>
                    setPort(Math.max(0, Math.min(65535, parseInt(e.target.value, 10) || 0)))
                  }
                  invalid={!portValid}
                  disabled={busy}
                />
              </div>
              <div>
                <Label htmlFor={`${idPrefix}-pass`}>
                  {connectionType === 'rcon' ? 'Password RCON' : 'Password (opt.)'}
                </Label>
                <Input
                  id={`${idPrefix}-pass`}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                />
              </div>
            </div>
          </fieldset>

          {/* 🎯 Presets — solo CUSTOM */}
          {!isStandard && (
            <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
              <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                🎯 Presets
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {CUSTOM_GAME_PRESETS.map((p, i) => (
                  <Button
                    key={p.label}
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => applyPreset(i)}
                    disabled={busy}
                    title={p.description}
                  >
                    <Sparkles className="h-3 w-3" />
                    {p.label}
                  </Button>
                ))}
              </div>
              <p className="text-[11px] text-fg-subtle">
                Reemplaza tipo de conexión, puerto y categorías.
              </p>
            </fieldset>
          )}

          {/* 📁 Categorías o Tab Names */}
          {!isStandard ? (
            <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
              <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                📁 Categorías de Datos
              </legend>
              <CategoriesEditor
                categories={categories}
                onChange={setCategories}
                connectionType={connectionType}
                disabled={busy}
              />
            </fieldset>
          ) : (
            <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
              <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                📁 Nombres de Pestañas
              </legend>
              <p className="text-[11px] text-fg-subtle">
                Sólo se cambia el texto visible. Categorías y endpoints son fijos.
              </p>
              <div className="grid grid-cols-3 gap-2">
                {editing?.hasEntities && (
                  <div>
                    <Label htmlFor={`${idPrefix}-tab-e`}>Entidades</Label>
                    <Input
                      id={`${idPrefix}-tab-e`}
                      value={tabEntities}
                      onChange={(e) => setTabEntities(e.target.value)}
                      placeholder="🐉 Entidades"
                      disabled={busy}
                    />
                  </div>
                )}
                {editing?.hasItems && (
                  <div>
                    <Label htmlFor={`${idPrefix}-tab-i`}>Items</Label>
                    <Input
                      id={`${idPrefix}-tab-i`}
                      value={tabItems}
                      onChange={(e) => setTabItems(e.target.value)}
                      placeholder="📦 Items"
                      disabled={busy}
                    />
                  </div>
                )}
                {editing?.hasEvents && (
                  <div>
                    <Label htmlFor={`${idPrefix}-tab-v`}>Eventos</Label>
                    <Input
                      id={`${idPrefix}-tab-v`}
                      value={tabEvents}
                      onChange={(e) => setTabEvents(e.target.value)}
                      placeholder="⚡ Eventos"
                      disabled={busy}
                    />
                  </div>
                )}
              </div>
            </fieldset>
          )}

          {/* 🔗 Compartir globales — solo CUSTOM */}
          {!isStandard && (
            <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
              <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                🔗 Compartir Configuración Global
              </legend>
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
                description="Voces TTS por usuario compartidas vs propias."
              />
            </fieldset>
          )}

          {error && (
            <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3 bg-bg-base/50">
          <div className="text-xs text-fg-subtle">
            {dirty && !error && (
              <span className="text-warning">● Cambios sin guardar</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant={dirty ? 'primary' : 'secondary'}
              size="sm"
              disabled={!canSave || !dirty}
              className={dirty ? '!bg-warning hover:!bg-warning/90 !text-bg' : ''}
            >
              {isEdit ? 'Guardar cambios' : '✅ Crear juego'}
            </Button>
          </div>
        </footer>
      </form>
    </Dialog>
  );
}
