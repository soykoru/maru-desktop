import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Button, Dialog, Input, Label, Select, Switch } from '@maru/ui';
import { rpcCall } from '../../../lib/rpc.js';
import type {
  CreateCustomGameInput,
  GameCategory,
  GameConnectionType,
  GameId,
  GameProfile,
  HttpAuthConfig,
} from '@maru/shared';
import { useGames } from '../../../lib/use-games.js';
import { CategoriesEditor } from './CategoriesEditor.js';
import { CUSTOM_GAME_PRESETS } from './presets.js';

/** v1.0.72: tipos discriminados de auth para el form (más amigable que el
 *  union de HttpAuthConfig que viene de @maru/shared). */
type AuthKind = 'none' | 'basic' | 'bearer' | 'apiKey';

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

  // v1.0.72: auth/headers HTTP opcional. Solo aplica a connectionType=http.
  // Defaults: 'none' + array vacío de headers → comportamiento idéntico a
  // versiones anteriores (zero impact en juegos sin auth).
  const [authKind, setAuthKind] = useState<AuthKind>('none');
  const [authBasicUser, setAuthBasicUser] = useState('');
  const [authBasicPass, setAuthBasicPass] = useState('');
  const [authBearerToken, setAuthBearerToken] = useState('');
  const [authApiKeyName, setAuthApiKeyName] = useState('');
  const [authApiKeyValue, setAuthApiKeyValue] = useState('');
  const [customHeaders, setCustomHeaders] = useState<{ key: string; value: string }[]>([]);

  // v1.0.74: portada custom. `coverImage` es el filename (ej "valheim.jpg")
  // que se guarda en GameProfile.coverImage. `coverBust` cambia al subir
  // una nueva para forzar re-render del <img> (vencer caché del browser).
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [coverBust, setCoverBust] = useState(0);
  const [coverBusy, setCoverBusy] = useState(false);

  const idPrefix = useId();

  // Snapshot del estado inicial — capturado UNA SOLA VEZ cuando el
  // dialog abre, para detectar cambios sin guardar. Antes esto era un
  // useMemo dependiente de `editing` (referencia del store): si en
  // background el store hacía re-fetch (refresh games) y `byId`
  // momentáneamente devolvía `null` o un objeto distinto, el useMemo
  // recalculaba el snapshot con valores actuales del store y dirty
  // se igualaba a `false` aunque el state local SÍ tenía cambios →
  // botón Save se "apagaba" después de cambiar de categoría o por
  // cualquier otro re-render del store. Ahora es un useRef que se
  // setea solo en el effect de "abrir el dialog" y queda inmutable
  // hasta cerrar/reabrir.
  const initialSnapshotRef = useRef<string>('');

  // useLayoutEffect (no useEffect) para que el snapshot + state local
  // estén listos ANTES del primer paint visible. Sin esto, el primer
  // render del dialog tenía dirty=false (snapshot vacío) y el botón
  // Save quedaba disabled hasta el siguiente render — si el user
  // editaba muy rápido o el effect se demoraba, parecía que "no
  // funcionaba" y los cambios no se podían guardar.
  useLayoutEffect(() => {
    if (!open) return;
    let next: {
      id: string;
      name: string;
      icon: string;
      host: string;
      port: number;
      password: string;
      connectionType: GameConnectionType;
      categories: GameCategory[];
      shareSounds: boolean;
      shareVoices: boolean;
      tabEntities: string;
      tabItems: string;
      tabEvents: string;
      authKind: AuthKind;
      authBasicUser: string;
      authBasicPass: string;
      authBearerToken: string;
      authApiKeyName: string;
      authApiKeyValue: string;
      customHeaders: { key: string; value: string }[];
    };
    setCoverImage(editing?.coverImage ?? null);
    setCoverBust(0);

    if (editing) {
      const auth = editing.connection.httpAuth;
      const headersObj = editing.connection.httpHeaders ?? {};
      next = {
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
        authKind: (auth?.type ?? 'none') as AuthKind,
        authBasicUser: auth?.type === 'basic' ? auth.user : '',
        authBasicPass: auth?.type === 'basic' ? auth.password : '',
        authBearerToken: auth?.type === 'bearer' ? auth.token : '',
        authApiKeyName: auth?.type === 'apiKey' ? auth.headerName : '',
        authApiKeyValue: auth?.type === 'apiKey' ? auth.headerValue : '',
        customHeaders: Object.entries(headersObj).map(([key, value]) => ({
          key,
          value: String(value),
        })),
      };
    } else {
      next = {
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
        authKind: 'none',
        authBasicUser: '',
        authBasicPass: '',
        authBearerToken: '',
        authApiKeyName: '',
        authApiKeyValue: '',
        customHeaders: [],
      };
    }
    setId(next.id);
    setName(next.name);
    setIcon(next.icon);
    setHost(next.host);
    setPort(next.port);
    setPassword(next.password);
    setConnectionType(next.connectionType);
    setCategories(next.categories);
    setShareSounds(next.shareSounds);
    setShareVoices(next.shareVoices);
    setTabEntities(next.tabEntities);
    setTabItems(next.tabItems);
    setTabEvents(next.tabEvents);
    setAuthKind(next.authKind);
    setAuthBasicUser(next.authBasicUser);
    setAuthBasicPass(next.authBasicPass);
    setAuthBearerToken(next.authBearerToken);
    setAuthApiKeyName(next.authApiKeyName);
    setAuthApiKeyValue(next.authApiKeyValue);
    setCustomHeaders(next.customHeaders);
    initialSnapshotRef.current = JSON.stringify(next);
    setError(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  if (!open) return null;

  const idDuplicate =
    !isEdit && games.some((g) => g.id.toLowerCase() === id.toLowerCase());
  // En EDIT mode el id es READ-ONLY (input disabled) → no validar
  // contra ID_RE. Si el id existente NO matchea el regex (caso real:
  // "7_days" empieza con número, no con letra), bloquear el save sería
  // injustificado: el user no puede cambiar el id, está editando otra
  // cosa (categorías/conexión/nombre). Solo validar id en CREATE.
  const idValid = isEdit ? true : (ID_RE.test(id) && !idDuplicate);
  const nameValid = name.trim().length > 0;
  const portValid = port >= 1 && port <= 65535;
  const canSave = idValid && nameValid && portValid && !busy;

  // Dirty check: comparamos snapshot inicial (capturado al abrir,
  // inmutable) vs estado actual. El initialSnapshotRef se setea solo
  // en el effect de "abrir el dialog" → ningún re-render del store
  // puede invalidarlo a mitad de edición.
  const dirty = useMemo(() => {
    if (!initialSnapshotRef.current) return false;
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
      authKind,
      authBasicUser,
      authBasicPass,
      authBearerToken,
      authApiKeyName,
      authApiKeyValue,
      customHeaders,
    });
    return current !== initialSnapshotRef.current;
  }, [
    id, name, icon, host, port, password, connectionType, categories,
    shareSounds, shareVoices, tabEntities, tabItems, tabEvents,
    authKind, authBasicUser, authBasicPass, authBearerToken,
    authApiKeyName, authApiKeyValue, customHeaders,
  ]);

  /** Construye el objeto httpAuth a enviar al backend según el tipo seleccionado.
   *  Para 'none' devuelve undefined → no se persiste el campo (defensivo). */
  function buildHttpAuth(): HttpAuthConfig | undefined {
    switch (authKind) {
      case 'basic':
        return { type: 'basic', user: authBasicUser, password: authBasicPass };
      case 'bearer':
        return { type: 'bearer', token: authBearerToken.trim() };
      case 'apiKey':
        return {
          type: 'apiKey',
          headerName: authApiKeyName.trim(),
          headerValue: authApiKeyValue,
        };
      case 'none':
      default:
        return { type: 'none' };
    }
  }

  /** Convierte la lista de pares key/value a Record<string, string>, dropea
   *  filas vacías (key trim vacío). */
  function buildCustomHeaders(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const { key, value } of customHeaders) {
      const k = key.trim();
      if (!k) continue;
      out[k] = value;
    }
    return out;
  }

  /** v1.0.74: abre file picker, sube la imagen al backend y actualiza el
   *  state local. La persistencia al GameProfile se hace en handleSubmit
   *  (junto con el resto del form). */
  async function handleChangeCover() {
    if (!id || coverBusy) return;
    setCoverBusy(true);
    try {
      const picked = await window.maruApi.dialog.openFile({
        title: `Cambiar portada de ${name || id}`,
        filters: [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
      });
      if (!picked.ok || !picked.path) return;
      const res = (await rpcCall('images.set-game-cover', {
        gameId: id,
        sourcePath: picked.path,
      })) as { ok: boolean; filename?: string; message?: string };
      if (!res.ok || !res.filename) {
        setError(res.message || 'No se pudo subir la portada');
        return;
      }
      setCoverImage(res.filename);
      setCoverBust((b) => b + 1);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setCoverBusy(false);
    }
  }

  async function handleRemoveCover() {
    if (!id || coverBusy) return;
    setCoverBusy(true);
    try {
      await rpcCall('images.delete-game-cover', { gameId: id });
      setCoverImage(null);
      setCoverBust((b) => b + 1);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setCoverBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Si hay errores de validación, MOSTRARLOS — antes el handler salía
    // silencioso (`if (!canSave) return;`), el user clickeaba Guardar,
    // no pasaba nada, cerraba el dialog y los cambios se perdían sin
    // ningún feedback. Ahora se muestra el primer error encontrado.
    if (!canSave) {
      // En EDIT no chequeamos id (es read-only). En CREATE sí.
      const firstError = !isEdit && !idValid
        ? (idDuplicate
            ? `Ya existe un juego con id "${id}". Elegí otro.`
            : 'El Game ID es inválido. Debe empezar con letra/_, 2-32 caracteres alfanuméricos.')
        : !nameValid
          ? 'El nombre no puede estar vacío.'
          : !portValid
            ? `El puerto debe estar entre 1 y 65535 (actual: ${port}).`
            : 'Hay errores de validación.';
      setError(firstError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // v1.0.72: incluir auth/headers en connection. Solo aplican a HTTP
      // pero los persistimos siempre por consistencia (si el user
      // cambia entre HTTP/RCON, no pierde su config de auth).
      const httpAuth = buildHttpAuth();
      const httpHeaders = buildCustomHeaders();
      const conn = {
        host,
        port,
        password,
        httpAuth,
        httpHeaders,
      };
      if (isEdit) {
        if (isStandard) {
          // Standard: solo conexión + tab_names + coverImage.
          const tabNames = {
            entities: tabEntities || undefined,
            items: tabItems || undefined,
            events: tabEvents || undefined,
          };
          const profile = await updateGame(editing!.id, {
            connection: conn,
            tabNames,
            coverImage,
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
            coverImage,
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
          coverImage,
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

            {/* v1.0.74: portada del juego (galería visual). */}
            <div className="flex items-center gap-3 pt-1">
              {/* Preview de la portada actual (60x90 ratio Steam) */}
              <div className="h-[90px] w-[60px] flex-none overflow-hidden rounded-md border border-border/60 bg-bg-elev">
                {coverImage ? (
                  <img
                    src={`maru://images/game_covers/${coverImage}?v=${coverBust}`}
                    alt="Portada"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-bg-elev to-bg-base">
                    <span className="font-emoji text-2xl opacity-50">{icon}</span>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                <Label>Portada del juego</Label>
                <p className="text-[11px] text-fg-subtle leading-tight">
                  {coverImage
                    ? 'Imagen actual visible en la galería y el selector lateral.'
                    : 'Sin portada — la galería usará un gradient con el emoji.'}
                </p>
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleChangeCover()}
                    disabled={busy || coverBusy || !id}
                    title="Subir imagen desde tu PC (jpg/png/webp)"
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    {coverBusy ? 'Subiendo…' : coverImage ? 'Cambiar portada' : 'Subir portada'}
                  </Button>
                  {coverImage && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleRemoveCover()}
                      disabled={busy || coverBusy}
                      title="Quitar la portada custom"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Quitar
                    </Button>
                  )}
                </div>
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

          {/* v1.0.72: 🔐 Autenticación HTTP + Headers personalizados.
              Solo se muestra para connectionType=http (auth no aplica a RCON). */}
          {!isStandard && connectionType === 'http' && (
            <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-3">
              <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                🔐 Autenticación HTTP (opcional)
              </legend>

              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-authkind`}>Tipo de autenticación</Label>
                <Select
                  id={`${idPrefix}-authkind`}
                  value={authKind}
                  onChange={(e) => setAuthKind(e.target.value as AuthKind)}
                  disabled={busy}
                >
                  <option value="none">Sin autenticación</option>
                  <option value="basic">Basic Auth (user / password)</option>
                  <option value="bearer">Bearer Token</option>
                  <option value="apiKey">API Key (header personalizado)</option>
                </Select>
              </div>

              {authKind === 'basic' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor={`${idPrefix}-basic-user`} required>
                      Usuario
                    </Label>
                    <Input
                      id={`${idPrefix}-basic-user`}
                      value={authBasicUser}
                      onChange={(e) => setAuthBasicUser(e.target.value)}
                      placeholder="admin"
                      disabled={busy}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`${idPrefix}-basic-pass`} required>
                      Contraseña
                    </Label>
                    <Input
                      id={`${idPrefix}-basic-pass`}
                      type="password"
                      value={authBasicPass}
                      onChange={(e) => setAuthBasicPass(e.target.value)}
                      placeholder="••••••••"
                      disabled={busy}
                    />
                  </div>
                </div>
              )}

              {authKind === 'bearer' && (
                <div>
                  <Label htmlFor={`${idPrefix}-bearer`} required>
                    Token Bearer
                  </Label>
                  <Input
                    id={`${idPrefix}-bearer`}
                    type="password"
                    value={authBearerToken}
                    onChange={(e) => setAuthBearerToken(e.target.value)}
                    placeholder="eyJhbGciOiJ..."
                    disabled={busy}
                    className="font-mono text-xs"
                  />
                  <p className="mt-1 text-[11px] text-fg-subtle">
                    Se enviará como <code>Authorization: Bearer &lt;token&gt;</code>
                  </p>
                </div>
              )}

              {authKind === 'apiKey' && (
                <div className="grid grid-cols-[1fr_2fr] gap-2">
                  <div>
                    <Label htmlFor={`${idPrefix}-apikey-name`} required>
                      Nombre del Header
                    </Label>
                    <Input
                      id={`${idPrefix}-apikey-name`}
                      value={authApiKeyName}
                      onChange={(e) => setAuthApiKeyName(e.target.value)}
                      placeholder="X-API-Key"
                      disabled={busy}
                      className="font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`${idPrefix}-apikey-value`} required>
                      Valor
                    </Label>
                    <Input
                      id={`${idPrefix}-apikey-value`}
                      type="password"
                      value={authApiKeyValue}
                      onChange={(e) => setAuthApiKeyValue(e.target.value)}
                      placeholder="••••••••"
                      disabled={busy}
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
              )}

              {/* Headers personalizados — siempre visibles, complementan
                  la auth (ej: agregar X-Forwarded-For además de Bearer). */}
              <div className="space-y-2 pt-2 border-t border-border/50">
                <div className="flex items-center justify-between">
                  <Label>📋 Headers personalizados</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setCustomHeaders((prev) => [...prev, { key: '', value: '' }])
                    }
                    disabled={busy}
                  >
                    <Plus className="h-3 w-3" />
                    Agregar
                  </Button>
                </div>
                {customHeaders.length === 0 ? (
                  <p className="text-[11px] text-fg-subtle italic">
                    Sin headers personalizados. Útil para X-Custom-*, X-Forwarded-*, etc.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {customHeaders.map((h, idx) => (
                      <div key={idx} className="grid grid-cols-[1fr_2fr_auto] gap-1.5">
                        <Input
                          value={h.key}
                          onChange={(e) =>
                            setCustomHeaders((prev) =>
                              prev.map((x, i) =>
                                i === idx ? { ...x, key: e.target.value } : x,
                              ),
                            )
                          }
                          placeholder="X-Custom-Header"
                          disabled={busy}
                          className="font-mono text-xs"
                        />
                        <Input
                          value={h.value}
                          onChange={(e) =>
                            setCustomHeaders((prev) =>
                              prev.map((x, i) =>
                                i === idx ? { ...x, value: e.target.value } : x,
                              ),
                            )
                          }
                          placeholder="valor"
                          disabled={busy}
                          className="font-mono text-xs"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setCustomHeaders((prev) => prev.filter((_, i) => i !== idx))
                          }
                          disabled={busy}
                          title="Eliminar header"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </fieldset>
          )}

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
                gameId={id}
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
          <div className="text-xs flex-1 truncate">
            {error ? (
              <span className="text-danger" title={error}>
                ⚠ {error}
              </span>
            ) : dirty ? (
              <span className="text-warning">● Cambios sin guardar</span>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant={dirty ? 'primary' : 'secondary'}
              size="sm"
              disabled={busy || !dirty}
              className={
                dirty
                  ? canSave
                    ? '!bg-warning hover:!bg-warning/90 !text-bg'
                    : '!bg-danger hover:!bg-danger/90 !text-fg'
                  : ''
              }
              title={
                !dirty
                  ? 'No hay cambios para guardar'
                  : !canSave
                    ? 'Hay errores de validación — click para ver el detalle'
                    : 'Click para guardar (cambios pendientes)'
              }
            >
              {isEdit ? 'Guardar cambios' : '✅ Crear juego'}
            </Button>
          </div>
        </footer>
      </form>
    </Dialog>
  );
}
