import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Music,
  Pause,
  Play,
  Plug,
  Plus,
  RefreshCw,
  SkipForward,
  Trash2,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  Empty,
  Input,
  Label,
  Select,
  Spinner,
  Switch,
} from '@maru/ui';
import type { SpotifyCommandId, SpotifyConfig } from '@maru/shared';
import { useAppStore } from '../../../lib/store/index.js';
import { useSpotify } from '../../../lib/use-spotify.js';

/**
 * `SpotifyConfigDialog` (G14) — réplica del tab Spotify de
 * `social_config.py` + ampliación.
 *
 * Secciones:
 *   1. Conexión + cuentas guardadas + credenciales OAuth.
 *   2. Dispositivo de reproducción + cola.
 *   3. Now playing banner.
 *   4. Configuración (max queue + tts + 5 comandos enabled).
 *   5. Priority users (table + add).
 *   6. Guía colapsable de pasos para configurar Spotify Dashboard.
 */
const REDIRECT_URI = 'http://127.0.0.1:8888/callback';

const COMMANDS_META: { id: SpotifyCommandId; label: string; emoji: string }[] = [
  { id: 'play', label: 'play', emoji: '▶️' },
  { id: 'skip', label: 'skip', emoji: '⏭️' },
  { id: 'cola', label: 'cola', emoji: '📋' },
  { id: 'pause', label: 'pause', emoji: '⏸️' },
  { id: 'playfan', label: 'playfan', emoji: '⭐' },
];

export function SpotifyConfigDialog() {
  const open = useAppStore((s) => s.modalStack.some((f) => f.id === 'spotify-config'));
  const closeModal = useAppStore((s) => s.closeModal);

  const sp = useSpotify({ autoLoad: open, pollNowPlayingMs: open ? 45_000 : 0 });

  const [busy, setBusy] = useState(false);
  const [opMessage, setOpMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [accountName, setAccountName] = useState('');
  const [selectedAccount, setSelectedAccount] = useState('');
  const [newPriorityUser, setNewPriorityUser] = useState('');
  const [newPriorityUses, setNewPriorityUses] = useState(2);
  const [showGuide, setShowGuide] = useState(false);

  if (!open) return null;

  function flash(text: string, ok = true) {
    setOpMessage({ ok, text });
    window.setTimeout(() => setOpMessage(null), 4000);
  }

  function patchConfigLocal(p: Partial<SpotifyConfig>) {
    void sp.saveConfig(p).catch((ex) =>
      flash(ex instanceof Error ? ex.message : String(ex), false),
    );
  }

  async function handleConnect() {
    setBusy(true);
    try {
      const r = await sp.connect(clientId || undefined, clientSecret || undefined);
      flash(r.ok ? '✓ Conectado a Spotify.' : `✗ ${r.message ?? 'falló'}`, r.ok);
    } catch (ex) {
      flash(ex instanceof Error ? ex.message : String(ex), false);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await sp.disconnect();
      flash('Spotify desconectado.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveAccount() {
    if (!accountName.trim()) return;
    try {
      await sp.accountSave(accountName.trim());
      setAccountName('');
      flash('✓ Cuenta guardada.');
    } catch (ex) {
      flash(ex instanceof Error ? ex.message : String(ex), false);
    }
  }

  async function handleAddPriorityUser() {
    if (!newPriorityUser.trim()) return;
    try {
      await sp.priorityUserSet(newPriorityUser.trim(), newPriorityUses);
      setNewPriorityUser('');
      setNewPriorityUses(2);
    } catch (ex) {
      flash(ex instanceof Error ? ex.message : String(ex), false);
    }
  }

  function toggleCommand(cmd: SpotifyCommandId) {
    const next = new Set(sp.config.enabled_commands);
    if (next.has(cmd)) next.delete(cmd);
    else next.add(cmd);
    patchConfigLocal({ enabled_commands: Array.from(next) });
  }

  function copyRedirect() {
    void navigator.clipboard.writeText(REDIRECT_URI).then(() =>
      flash('✓ URI copiada al portapapeles.'),
    );
  }

  return (
    <Dialog
      open
      onClose={() => !busy && closeModal()}
      size="xl"
      bodyFlush
      title="🎵 Spotify"
      description={
        sp.status.connected
          ? `🟢 Conectado${sp.status.account ? ` como ${(sp.status.account as { name?: string }).name ?? '?'}` : ''}`
          : sp.status.rateLimited
            ? '⏳ Rate limit — esperando…'
            : '⚪ No conectado'
      }
    >
      {opMessage && (
        <div
          className={
            'px-5 py-2 text-xs border-b border-border ' +
            (opMessage.ok
              ? 'bg-success/10 text-success'
              : 'bg-danger/10 text-danger')
          }
        >
          {opMessage.text}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
        <Switch
          checked={sp.config.enabled}
          onChange={(v) => patchConfigLocal({ enabled: v })}
          disabled={busy}
          label="🎵 Integración Spotify activa"
          description="Si está apagado, los comandos de música se ignoran."
        />

        {/* Conexión */}
        <fieldset className="rounded-xl border border-success/40 bg-success/5 p-3 space-y-2">
          <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-success">
            🔌 Credenciales OAuth
          </legend>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="sp-cid">Client ID</Label>
              <Input
                id="sp-cid"
                type="password"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="abc123def456..."
                disabled={busy}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label htmlFor="sp-csec">Client Secret</Label>
              <Input
                id="sp-csec"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="xyz789..."
                disabled={busy}
                className="font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => void handleConnect()}
              disabled={busy || sp.status.connected}
            >
              <Plug className="h-3.5 w-3.5" />
              Conectar Spotify
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleDisconnect()}
              disabled={busy || !sp.status.connected}
            >
              Desconectar
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void sp.refreshStatus()}
              disabled={busy}
              title="Refrescar estado"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-[11px]">
            <div className="flex items-center gap-2">
              <span className="text-fg-subtle">Redirect URI:</span>
              <code className="font-mono text-info flex-1 truncate select-all">
                {REDIRECT_URI}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={copyRedirect}
                className="!h-6 !px-2"
                title="Copiar al portapapeles"
              >
                <Copy className="h-3 w-3" />
                Copiar
              </Button>
            </div>
            <p className="mt-1.5 text-[10px] text-warning/80 leading-snug">
              ⚠️ <strong>NO abras esta URL en el navegador</strong> — no
              llevarás a ningún lado y dará "no se puede acceder". Es una
              dirección INTERNA que solo se usa cuando MARU está esperando
              el callback de OAuth. Tu único trabajo: <strong>copiar este
              texto exacto y pegarlo en la config de tu app en Spotify
              Developer</strong> (campo "Redirect URI" → Add).
            </p>
            <button
              type="button"
              onClick={() => setShowGuide((v) => !v)}
              className="mt-2 flex items-center gap-1 text-info hover:underline"
            >
              {showGuide ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              {showGuide ? 'Ocultar' : 'Ver'} pasos para configurar una nueva cuenta
            </button>
            {showGuide && (
              <>
                {/* Botón GRANDE y obvio para abrir el dashboard */}
                <button
                  type="button"
                  onClick={() =>
                    void window.maruApi.shell.openExternal(
                      'https://developer.spotify.com/dashboard',
                    )
                  }
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-[#1DB954] hover:bg-[#1ed760] active:scale-[0.98] px-3 py-2 text-sm font-bold text-white shadow-md transition-all cursor-pointer"
                >
                  🟢 Abrir Spotify Developer Dashboard
                </button>
                <ol className="mt-3 list-decimal pl-5 space-y-0.5 text-fg-muted leading-snug">
                <li>
                  Click en el botón verde de arriba para abrir{' '}
                  <strong className="text-success">developer.spotify.com/dashboard</strong>{' '}
                  en tu navegador y logueate con tu cuenta de Spotify.
                </li>
                <li>
                  Click en <strong>Create App</strong>. Nombre y descripción
                  libres (ej: "MiBot").
                </li>
                <li>
                  En <strong>Redirect URI</strong> pegá EXACTAMENTE:{' '}
                  <code className="text-success">
                    http://127.0.0.1:8888/callback
                  </code>
                </li>
                <li>
                  Marcá el checkbox <strong>Web API</strong>, aceptá términos
                  y crea la app.
                </li>
                <li>
                  Entrá a <strong>Settings</strong> de tu app → copiá el{' '}
                  <strong>Client ID</strong> y click "View client secret"
                  para copiar el <strong>Client Secret</strong>.
                </li>
                <li>Pegá las credenciales en los campos de arriba y guardá.</li>
                <li>
                  ⚠️ Modo Desarrollo: Spotify limita a 25 usuarios. Andá a{' '}
                  <strong>Settings → User Management → Add User</strong> y
                  agregá los emails de las cuentas que la usen.
                </li>
                <li>
                  Si te da error <code>INVALID_CLIENT</code>: verificá que la
                  Redirect URI sea exacta (sin espacio al final).
                </li>
                <li>
                  💡 Para múltiples cuentas: guardá la actual con
                  "💾 Guardar", luego creá otra app con otra cuenta de
                  Spotify y pegá las nuevas credenciales.
                </li>
              </ol>
              </>
            )}
          </div>
        </fieldset>

        {/* Cuentas guardadas — lista visible con cargar/borrar por item */}
        <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
          <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            📂 Cuentas guardadas ({sp.accounts.length})
          </legend>

          {sp.accounts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-bg-base/30 px-3 py-4 text-center">
              <p className="text-xs text-fg-subtle">
                No hay cuentas guardadas todavía.
                <br />
                Conectate con tus credenciales arriba y guardalas con un nombre
                para cambiar rápido entre cuentas.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-bg-base/30 overflow-hidden">
              {sp.accounts.map((a) => {
                const isCurrent = a.isCurrent;
                return (
                  <li
                    key={a.name}
                    className={
                      'flex items-center justify-between gap-2 px-3 py-2 ' +
                      (isCurrent ? 'bg-success/[0.06]' : 'hover:bg-fg/5')
                    }
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="shrink-0 text-sm">
                        {isCurrent ? '🟢' : '⚪'}
                      </span>
                      <span
                        className="truncate text-sm font-medium"
                        title={a.displayName}
                      >
                        {a.displayName}
                      </span>
                      {isCurrent && (
                        <Badge variant="success">activa</Badge>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedAccount(a.name);
                          void (async () => {
                            try {
                              await sp.accountLoad(a.name);
                              flash(`✓ Cargada cuenta "${a.name}".`);
                            } catch (ex) {
                              flash(
                                ex instanceof Error
                                  ? ex.message
                                  : String(ex),
                                false,
                              );
                            }
                          })();
                        }}
                        disabled={busy || isCurrent}
                        title={isCurrent ? 'Ya está activa' : 'Cargar esta cuenta'}
                      >
                        Cargar
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (!confirm(`¿Eliminar la cuenta "${a.name}"?`))
                            return;
                          void (async () => {
                            try {
                              await sp.accountDelete(a.name);
                              flash(`Cuenta "${a.name}" eliminada.`);
                            } catch (ex) {
                              flash(
                                ex instanceof Error
                                  ? ex.message
                                  : String(ex),
                                false,
                              );
                            }
                          })();
                        }}
                        disabled={busy}
                        title="Eliminar cuenta"
                        className="!text-danger hover:!bg-danger/10"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Guardar la cuenta conectada */}
          <div className="flex gap-2 pt-1">
            <Input
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder={
                sp.status.connected
                  ? 'Nombre para guardar la cuenta actual...'
                  : 'Conectate primero arriba para poder guardar'
              }
              disabled={busy || !sp.status.connected}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void handleSaveAccount()}
              disabled={busy || !accountName.trim() || !sp.status.connected}
            >
              <Plus className="h-3 w-3" />
              Guardar
            </Button>
          </div>

          {/* Refresh button — útil después de añadir desde otro lado */}
          <div className="flex items-center justify-between text-[11px] text-fg-subtle">
            <span>
              Para añadir otra cuenta: poné nuevas credenciales arriba,
              conectá, luego guardá con un nombre distinto.
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void sp.refreshAccounts()}
              disabled={busy}
              title="Refrescar lista"
              className="!h-6 !px-2"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        </fieldset>

        {/* Devices */}
        <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
          <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            🔊 Dispositivo de reproducción
          </legend>
          <div className="flex gap-2">
            <Select
              value={sp.config.device_id}
              onChange={(e) => patchConfigLocal({ device_id: e.target.value })}
              disabled={busy}
              className="flex-1"
            >
              <option value="">🔊 Automático (dispositivo activo)</option>
              {sp.devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.isActive ? '▶ ' : ''}
                  {d.name} ({d.type}) · {d.volumePercent}%
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void sp.refreshDevices()}
              disabled={busy || !sp.status.connected}
              title="Refrescar devices"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </fieldset>

        {/* Now playing + queue */}
        <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
          <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle flex items-center gap-2">
            🎶 Reproducción
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                void sp.refreshNow();
                void sp.refreshQueue();
              }}
              disabled={busy}
              className="!h-6 !px-1.5"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </legend>

          {/* Banner */}
          <div className="rounded-lg border border-success/40 bg-gradient-to-r from-success/15 to-info/15 px-3 py-2.5">
            {sp.now.isPlaying && sp.now.track ? (
              <p className="text-sm font-medium">
                🎵 <strong>{sp.now.track.name}</strong>
                {' — '}
                {sp.now.track.artist}
                {sp.now.requestedBy && (
                  <span className="text-fg-subtle">
                    {' '}
                    | Pedida por: <strong>{sp.now.requestedBy}</strong>
                  </span>
                )}
              </p>
            ) : (
              <p className="text-sm text-fg-muted">🎵 Sin reproducción activa</p>
            )}
          </div>

          {/* Controles */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void sp.togglePlayback()}
              disabled={busy || !sp.status.connected}
            >
              {sp.now.isPlaying ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {sp.now.isPlaying ? 'Pausar' : 'Reproducir'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void sp.skip()}
              disabled={busy || !sp.status.connected}
            >
              <SkipForward className="h-3.5 w-3.5" />
              Skip
            </Button>
            <div className="flex-1" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void sp.queueClear()}
              disabled={busy || sp.queue.length === 0}
              className="gap-1.5 whitespace-nowrap"
              title="Vaciar la cola completa"
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" />
              <span>Vaciar cola</span>
            </Button>
          </div>

          {/* Queue */}
          {sp.queue.length === 0 ? (
            <p className="text-[11px] text-fg-subtle italic px-2 py-3 text-center rounded-md border border-dashed border-border">
              Cola vacía.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-bg-elev max-h-[180px] overflow-y-auto">
              {sp.queue.map((q, i) => (
                <li
                  key={`${q.trackId}::${i}`}
                  className="flex items-center gap-2 px-2 py-1.5 text-xs"
                >
                  <span className="text-fg-subtle font-mono w-5">{i + 1}</span>
                  {q.isPriority && (
                    <Badge variant="warning" className="!text-[9px]">
                      ⭐
                    </Badge>
                  )}
                  <span className="flex-1 truncate" title={`${q.trackName} — ${q.artist}`}>
                    <strong>{q.trackName}</strong>
                    <span className="text-fg-muted"> — {q.artist}</span>
                  </span>
                  <span className="text-[10px] text-fg-subtle truncate max-w-[100px]">
                    {q.requestedBy}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void sp.queueRemove(q.trackId)}
                    disabled={busy}
                    title="Quitar de la cola"
                    className="!h-6 !px-1.5"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        {/* Configuración */}
        <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-3">
          <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            ⚙️ Configuración
          </legend>

          <div className="grid grid-cols-[1fr_140px] gap-3 items-end">
            <div>
              <Label htmlFor="sp-mq">Tamaño máx. cola random</Label>
              <p className="text-[11px] text-fg-subtle">
                Cuando se llena, los nuevos `!play` se rechazan hasta que
                rota.
              </p>
            </div>
            <Input
              id="sp-mq"
              type="number"
              min={1}
              max={50}
              value={String(sp.config.max_queue)}
              onChange={(e) =>
                patchConfigLocal({
                  max_queue: Math.max(
                    1,
                    Math.min(50, parseInt(e.target.value, 10) || 5),
                  ),
                })
              }
              disabled={busy}
              suffix="canciones"
            />
          </div>

          <Switch
            checked={sp.config.tts_enabled}
            onChange={(v) => patchConfigLocal({ tts_enabled: v })}
            disabled={busy}
            label="🔊 Voz del bot para música"
            description="Si activado: bot lee los comandos de música. Si no: silencio."
          />

          <div>
            <p className="text-[11px] uppercase tracking-wider text-fg-subtle mb-1">
              Comandos habilitados
            </p>
            <div className="flex flex-wrap gap-1.5">
              {COMMANDS_META.map((c) => {
                const on = sp.config.enabled_commands.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className={[
                      'flex items-center gap-1 rounded-md border px-2 py-1 text-xs cursor-pointer',
                      on
                        ? 'border-accent/40 bg-accent/10 text-fg'
                        : 'border-border bg-bg-elev text-fg-muted hover:border-fg-muted',
                    ].join(' ')}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleCommand(c.id)}
                      disabled={busy}
                      className="h-3 w-3 accent-accent"
                    />
                    <span className="font-emoji">{c.emoji}</span>
                    <span className="font-mono">!{c.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </fieldset>

        {/* Priority users */}
        <fieldset className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2">
          <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            ⭐ Usuarios prioritarios (PlayFan)
          </legend>
          <p className="text-[11px] text-fg-subtle">
            Los usuarios prioritarios pueden usar <code>!playfan</code> que
            saltea la cola random. Cada uno tiene un límite diario.
          </p>

          <div className="flex gap-2">
            <Input
              value={newPriorityUser}
              onChange={(e) => setNewPriorityUser(e.target.value)}
              placeholder="username..."
              disabled={busy}
              className="flex-1"
            />
            <Input
              type="number"
              min={1}
              max={50}
              value={String(newPriorityUses)}
              onChange={(e) =>
                setNewPriorityUses(Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 2)))
              }
              disabled={busy}
              suffix="usos/día"
              className="w-[140px]"
            />
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => void handleAddPriorityUser()}
              disabled={busy || !newPriorityUser.trim()}
            >
              <Plus className="h-3 w-3" />
              Agregar
            </Button>
          </div>

          {Object.keys(sp.config.priority_users).length === 0 ? (
            <Empty
              icon={Music}
              title="Sin usuarios prioritarios"
              description="Agregá al menos uno para habilitar !playfan."
            />
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-bg-elev">
              {Object.entries(sp.config.priority_users).map(([username, uses]) => (
                <li
                  key={username}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs"
                >
                  <span className="font-mono flex-1 truncate">@{username}</span>
                  <Badge variant="default">{uses} usos/día</Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void sp.priorityUserRemove(username)}
                    disabled={busy}
                    title="Quitar"
                    className="!h-6 !px-1.5"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        {sp.loadStatus === 'loading' && (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        )}
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3 bg-bg-base/50">
        <p className="text-[11px] text-fg-subtle flex-1 truncate">
          Config persistida en <code>data/spotify.json</code>. Now playing
          poll cada 45s mientras esté abierto.
        </p>
        <Button variant="ghost" size="sm" onClick={closeModal} disabled={busy}>
          Cerrar
        </Button>
      </footer>
    </Dialog>
  );
}
