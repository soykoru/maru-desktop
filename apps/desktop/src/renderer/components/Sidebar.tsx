import type { ReactNode } from 'react';
import { Button, GroupBox, StatusDot, CountUp, VolumeSlider } from '@maru/ui';
import {
  Plug,
  Settings as SettingsIcon,
  Volume2,
  Sparkles,
  Gift,
  Bell,
  Theater,
  Save,
  RefreshCw,
  Wrench,
  PlugZap,
  Mic2,
  Heart,
  Bot,
  Music,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import logoSrc from '../assets/logo.png';
import { useAppStore } from '../lib/store/index.js';
import { useGames } from '../lib/use-games.js';
import { useGifts } from '../lib/use-gifts.js';
import { useTts } from '../lib/use-tts.js';
import { rpcCall } from '../lib/rpc.js';
import type { FortunesConfig, GameId, TtsVoiceMode } from '@maru/shared';
import { GiftSelectorDialog } from './dialogs/gifts/GiftSelectorDialog.js';
import { MaruImage } from '@maru/ui';
import { ThemeSwitcher } from './ThemeSwitcher.js';
import { NowPlayingCard } from './NowPlayingCard.js';

/**
 * Sidebar — réplica fiel del `_build_left_panel` del MARU original.
 *
 * Estructura espejo:
 *   Logo (100x100) + subtitle "Chaos Engine v8.5"
 *   GroupBox  🎵 TikTok Live      → status, likes, user input, conectar btn
 *   GroupBox  🎮 Perfil de Juego  → selector + Probar + Config + Añadir
 *   GroupBox  🔊 Texto a Voz      → toggle, voice combo, volumen, prueba, voces
 *   GroupBox  🔮 Fortuna          → toggle, gift selector, voz, volumen, prueba
 *   GroupBox  💬 Sistema Social   → toggle, Configurar, Minijuegos
 *   GroupBox  ⚙️ Configuración    → 🎁 Regalos, 🔔 Sonidos, 🎭 Sim, 💾 Perfiles,
 *                                    🔄 Respaldos, 🔧 TikTok API, 🎬 Overlays
 *
 * En G1 el contenido es UI estática (skeleton interactivo). Los datos
 * reales y handlers se cablean en G4-G14 conforme cada sistema entra.
 *
 * Premium polish:
 *   - Iconos lucide en vez de emojis crudos para los botones (mantenemos
 *     emoji en GroupBox titles porque eso ES la identidad MARU).
 *   - StatusDot con pulse animation para "TikTok conectado".
 *   - Tooltips con shortcuts de teclado.
 *   - Spacing consistente con design tokens.
 */
export function Sidebar(): ReactNode {
  const openModal = useAppStore((s) => s.openModal);
  const selectedGameId = useAppStore((s) => s.selectedGameId);
  const setSelectedGameId = useAppStore((s) => s.setSelectedGameId);
  const { games, byId } = useGames({ autoLoad: true });
  const activeGame = selectedGameId ? byId(selectedGameId) : null;

  const tts = useTts({ autoLoad: true });
  const [testText, setTestText] = useState('Hola, esta es una prueba');
  const [testing, setTesting] = useState(false);

  async function handleTtsTest() {
    setTesting(true);
    try {
      await tts.test({ text: testText, voice: tts.config.default_voice });
    } finally {
      setTesting(false);
    }
  }

  function patchTtsConfig(p: Parameters<typeof tts.saveConfig>[0]) {
    void tts.saveConfig(p).catch(() => undefined);
  }

  // ── Social system enabled (persistente vía social.config) ───────────
  const [socialEnabled, setSocialEnabled] = useState(true);
  useEffect(() => {
    void rpcCall('social.config.get', {})
      .then((r) => {
        const c = (r as { config?: { enabled?: boolean } }).config;
        if (c && typeof c.enabled === 'boolean') setSocialEnabled(c.enabled);
      })
      .catch(() => undefined);
  }, []);

  function patchSocialEnabled(v: boolean) {
    setSocialEnabled(v);
    void rpcCall('social.config.set', { patch: { enabled: v } }).catch(
      () => undefined,
    );
  }

  // ── Master switch: ON = enviar acciones a juegos, OFF = solo loguear.
  const [gamesEnabled, setGamesEnabled] = useState(true);
  useEffect(() => {
    void rpcCall('settings.get', {})
      .then((r) => {
        const cfg = (r as { config?: { gamesEnabled?: boolean } }).config;
        if (cfg && typeof cfg.gamesEnabled === 'boolean') {
          setGamesEnabled(cfg.gamesEnabled);
        }
      })
      .catch(() => undefined);
  }, []);
  function toggleGamesEnabled() {
    const next = !gamesEnabled;
    setGamesEnabled(next);
    void rpcCall('settings.set', { patch: { gamesEnabled: next } }).catch(
      () => undefined,
    );
  }

  // ── Probar juego (test connection) ────────────────────────────────────
  const [gameTest, setGameTest] = useState<{
    state: 'idle' | 'testing' | 'ok' | 'error';
    message?: string;
  }>({ state: 'idle' });

  useEffect(() => {
    setGameTest({ state: 'idle' });
  }, [selectedGameId]);

  async function handleGameTest() {
    if (!selectedGameId) return;
    setGameTest({ state: 'testing' });
    try {
      const res = (await rpcCall('games.test', {
        gameId: selectedGameId,
      })) as { ok: boolean; message?: string; latencyMs?: number };
      if (res.ok) {
        setGameTest({
          state: 'ok',
          message: res.latencyMs != null ? `${res.latencyMs}ms` : (res.message || 'Conectado'),
        });
      } else {
        setGameTest({ state: 'error', message: res.message || 'No conecta' });
      }
    } catch (ex) {
      setGameTest({
        state: 'error',
        message: ex instanceof Error ? ex.message : String(ex),
      });
    }
  }

  // ── Fortuna wiring (sistema de Suerte) ────────────────────────────────
  const { allGifts } = useGifts({ autoLoad: true });
  const [fortunesConfig, setFortunesConfig] = useState<FortunesConfig>({
    enabled: false,
    gift_id: '',
    voice: 'en_female_madam_leota',
    volume_pct: 80,
    // Fallback antes de cargar la config real — coincide con el default
    // del sidecar (incluye 'grosera' y todas las temáticas).
    categories: [
      'good', 'bad', 'neutral', 'specific', 'philosophical',
      'love', 'money', 'health', 'work', 'gaming', 'social',
      'creative', 'mystery', 'humor', 'stream', 'luck', 'wisdom',
      'grosera',
    ],
  });
  const [fortuneTesting, setFortuneTesting] = useState(false);
  const [fortuneFlash, setFortuneFlash] = useState<string | null>(null);
  const [fortuneGiftPickerOpen, setFortuneGiftPickerOpen] = useState(false);

  useEffect(() => {
    void rpcCall('fortunes.config.get', {})
      .then((r) => setFortunesConfig(r.config))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!fortuneFlash) return;
    const t = window.setTimeout(() => setFortuneFlash(null), 4000);
    return () => window.clearTimeout(t);
  }, [fortuneFlash]);

  function patchFortunes(patch: Partial<FortunesConfig>) {
    const next = { ...fortunesConfig, ...patch };
    setFortunesConfig(next);
    void rpcCall('fortunes.config.set', { patch }).catch(() => undefined);
  }

  async function handleFortuneTest() {
    setFortuneTesting(true);
    setFortuneFlash(null);
    try {
      const r = await rpcCall('fortunes.test', { name: 'TestUser' });
      setFortuneFlash(r.ok ? `🔮 ${r.text}` : `✗ ${r.error || r.text}`);
    } catch (ex) {
      setFortuneFlash(
        '✗ ' + (ex instanceof Error ? ex.message : String(ex)),
      );
    } finally {
      setFortuneTesting(false);
    }
  }

  // ── G14: TikTok wiring ────────────────────────────────────────────────
  const tiktokStatus = useAppStore((s) => s.tiktokStatus);
  const tiktokUsername = useAppStore((s) => s.tiktokUsername);
  const tiktokStats = useAppStore((s) => s.tiktokStats);
  const tiktokError = useAppStore((s) => s.tiktokError);
  const setTikTokStatus = useAppStore((s) => s.setTikTokStatus);
  const setTikTokError = useAppStore((s) => s.setTikTokError);
  const [usernameInput, setUsernameInput] = useState('');
  const [connecting, setConnecting] = useState(false);

  const isConnected = tiktokStatus === 'connected';
  const isConnecting = tiktokStatus === 'connecting' || connecting;

  // Connect button visual states (v1.0.34 polish):
  // - Al conectar exitoso: flash anillo verde 1.4s una vez.
  // - Al fallar: shake horizontal 0.5s una vez.
  // Se gatean con keys efímeros para no re-disparar en cada render.
  const [successFlashKey, setSuccessFlashKey] = useState(0);
  const [errorShakeKey, setErrorShakeKey] = useState(0);
  const prevConnectedRef = useRef(false);
  useEffect(() => {
    if (isConnected && !prevConnectedRef.current) {
      setSuccessFlashKey((k) => k + 1);
    }
    prevConnectedRef.current = isConnected;
  }, [isConnected]);
  useEffect(() => {
    if (tiktokError) {
      setErrorShakeKey((k) => k + 1);
    }
  }, [tiktokError]);

  // Restaurar último username al boot (paridad MARU original que persiste
  // en config.json `tiktok_last_username`).
  useEffect(() => {
    void rpcCall('settings.get', {})
      .then((r) => {
        const cfg = (r as { config?: Record<string, unknown> }).config || {};
        const last = cfg['tiktok_last_username'];
        if (typeof last === 'string' && last && !usernameInput) {
          setUsernameInput(last);
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleTikTokToggle() {
    setConnecting(true);
    setTikTokError(null);
    try {
      if (isConnected) {
        await window.maruApi.rpc.call('tiktok.disconnect', {});
        setTikTokStatus('disconnected');
      } else {
        const u = usernameInput.trim();
        if (!u) {
          setTikTokError('Escribí tu usuario de TikTok primero');
          return;
        }
        setTikTokStatus('connecting', u);
        void rpcCall('settings.set', {
          patch: { tiktok_last_username: u },
        }).catch(() => undefined);
        const res = (await window.maruApi.rpc.call('tiktok.connect', {
          username: u,
        })) as { ok: boolean; error?: string };
        if (!res.ok) {
          setTikTokError(res.error || 'No se pudo conectar');
          setTikTokStatus('disconnected');
        }
      }
    } catch (ex) {
      setTikTokError(ex instanceof Error ? ex.message : String(ex));
      setTikTokStatus('disconnected');
    } finally {
      setConnecting(false);
    }
  }

  /** Mejora sobre el original: cancelar mientras está intentando conectar
   *  (el original solo deshabilita el botón). Llama disconnect, lo cual
   *  detiene el worker y cancela el ciclo de retries del TikTokWorker. */
  async function handleCancelConnect() {
    try {
      await window.maruApi.rpc.call('tiktok.disconnect', {});
    } catch {
      /* noop */
    } finally {
      setTikTokStatus('disconnected');
      setConnecting(false);
      setTikTokError('Conexión cancelada');
    }
  }

  // Si vino username del backend, usarlo en el input al cargar.
  // (El user puede cambiarlo libremente cuando está desconectado.)
  const inputValue = isConnected
    ? tiktokUsername ?? usernameInput
    : usernameInput;

  return (
    <div className="flex flex-col gap-2 pr-1">
      {/* ── Hero card del logo (v1.0.40) ──────────────────────────── */}
      {/* Mesh gradient animado de 3 blobs flotando detrás del logo —
          composite-only (filter: blur + transform), GPU. Cero RAM
          extra: solo 3 divs absolutos + 2 keyframes. La animación se
          neutraliza por la regla global `prefers-reduced-motion` ya
          presente en globals.css. */}
      <div className="maru-hero-card">
        <div className="maru-hero-mesh" aria-hidden="true">
          <div className="blob b1" />
          <div className="blob b2" />
          <div className="blob b3" />
        </div>
        <div className="maru-hero-content flex flex-col items-center">
          <img
            src={logoSrc}
            alt="MaruLive"
            width={88}
            height={88}
            className="select-none drop-shadow-[0_8px_24px_rgb(0_0_0/0.4)]"
            draggable={false}
          />
          <span className="mt-2 text-[14px] font-extrabold tracking-tight"
                style={{
                  background: 'linear-gradient(135deg, rgb(var(--maru-fg)), rgb(var(--maru-fg-muted)))',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
          >
            MARU LIVE
          </span>
          <span className="mt-0.5 text-[9px] uppercase tracking-[0.22em] text-fg-subtle font-mono">
            Chaos Engine
          </span>
        </div>
      </div>

      {/* ── 🎵 TikTok Live (v1.0.40 premium) ──────────────────────── */}
      {/* Conserva el GroupBox + título cyan + TODA la lógica de
          conexión/cancel/error. Solo se rediseñan visualmente:
            (1) header con avatar circular + LIVE badge cuando conectado.
            (2) stats en 3 tiles modernos en vez de inline mono.
          handleTikTokToggle / handleCancelConnect / setUsernameInput /
          tiktokError / successFlashKey / errorShakeKey siguen idénticos. */}
      <GroupBox title="🎵 TikTok Live" density="md">
        {/* Header: avatar + nombre + badge LIVE */}
        <div className="flex items-center gap-2.5">
          <div
            className={[
              'maru-avatar-v140',
              isConnected ? 'live' : 'disconnected',
            ].join(' ')}
            aria-hidden="true"
          >
            {(tiktokUsername || usernameInput || '?')
              .replace(/^@/, '')
              .charAt(0)
              .toUpperCase() || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <StatusDot
                status={
                  tiktokStatus === 'connected'
                    ? 'connected'
                    : tiktokStatus === 'connecting'
                      ? 'connecting'
                      : tiktokStatus === 'error'
                        ? 'error'
                        : 'disconnected'
                }
                label=""
              />
              <span className="text-sm font-bold truncate">
                {isConnected
                  ? `@${tiktokUsername ?? ''}`
                  : isConnecting
                    ? 'Conectando…'
                    : 'Desconectado'}
              </span>
            </div>
            {!isConnected && !isConnecting && (
              <span className="text-[10px] text-fg-subtle">
                Esperando conexión
              </span>
            )}
          </div>
          {isConnected && (
            <span className="maru-live-pill" aria-label="Live activo">
              <span className="dot" />
              LIVE
            </span>
          )}
        </div>

        {/* Stats en 3 tiles modernos (reemplaza el grid inline) */}
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <div className="maru-stat-tile">
            <div className="maru-stat-tile-label text-accent-red">
              <Heart className="h-3 w-3" /> Likes
            </div>
            <div className="maru-stat-tile-value">
              <CountUp value={tiktokStats.likes} durationMs={500} />
            </div>
          </div>
          <div className="maru-stat-tile">
            <div className="maru-stat-tile-label text-info">
              <span aria-hidden="true">👁</span> Vista
            </div>
            <div className="maru-stat-tile-value">
              <CountUp value={tiktokStats.viewers} durationMs={500} />
            </div>
          </div>
          <div className="maru-stat-tile">
            <div className="maru-stat-tile-label text-warning">
              <span aria-hidden="true">💎</span> Coins
            </div>
            <div className="maru-stat-tile-value">
              <CountUp value={tiktokStats.diamonds} durationMs={500} />
            </div>
          </div>
        </div>

        <input
          className="mt-3 maru-input w-full text-sm"
          placeholder="👤 Tu usuario de TikTok (sin @)"
          autoComplete="off"
          spellCheck={false}
          value={inputValue}
          onChange={(e) => setUsernameInput(e.target.value)}
          disabled={isConnected || isConnecting}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isConnected && usernameInput.trim()) {
              void handleTikTokToggle();
            }
          }}
        />

        {isConnecting ? (
          <div className="mt-2 flex gap-1.5">
            <Button
              variant="ghost"
              className="flex-1 cursor-wait border border-accent/40 bg-accent/10 text-accent transition-all duration-200"
              disabled
              aria-busy
            >
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
              Conectando…
            </Button>
            <Button
              variant="danger"
              className="transition-all duration-200"
              onClick={() => void handleCancelConnect()}
              title="Cancelar conexión"
            >
              ✕ Cancelar
            </Button>
          </div>
        ) : (
          <Button
            key={`connect-${successFlashKey}-${errorShakeKey}`}
            variant={isConnected ? 'secondary' : 'primary'}
            className={[
              'mt-2 w-full transition-all duration-200',
              isConnected
                ? 'shadow-[0_0_0_1px_rgb(46_213_115/0.3)] animate-success-flash'
                : '',
              tiktokError && !isConnected ? 'animate-error-shake' : '',
            ].join(' ')}
            title={
              isConnected
                ? 'Desconectar TikTok (Ctrl+T)'
                : 'Conectar a TikTok Live (Ctrl+T)'
            }
            aria-keyshortcuts="Control+T"
            onClick={() => void handleTikTokToggle()}
            disabled={!isConnected && !usernameInput.trim()}
          >
            {isConnected ? (
              <PlugZap className="h-4 w-4" aria-hidden />
            ) : (
              <Plug className="h-4 w-4" aria-hidden />
            )}
            {isConnected ? 'Desconectar' : 'Conectar a Live'}
          </Button>
        )}

        {tiktokError && (
          <div className="mt-2 rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[10px] text-danger animate-fade-in">
            ⚠ {tiktokError}
          </div>
        )}

        {/* Sign API key (eulerstream) — opcional, soluciona SIGN_NOT_200. */}
        <button
          type="button"
          className="mt-2 w-full text-[10px] text-fg-subtle hover:text-fg-default underline"
          onClick={() => openModal('tiktok-sign-key', {})}
        >
          🔑 Configurar API key (evita rate limit de eulerstream)
        </button>
      </GroupBox>

      {/* ── 🎶 Now Playing (Spotify) — solo aparece si conectado ─────── */}
      {/* No reemplaza el botón "Spotify" que sigue en el GroupBox de
          Configuración. Si Spotify NO está conectado, este componente
          retorna null y no afecta el layout. */}
      <NowPlayingCard />

      {/* ── 🎮 Perfil de Juego ─────────────────────────────────────── */}
      <GroupBox title="🎮 Perfil de Juego" density="md">
        {/* Master switch — ON envía acciones al juego, OFF solo loguea
            en el panel para evitar inundar de errores HTTP cuando el
            juego no está abierto. Las reglas siguen disparando, pero el
            HTTP/RCON queda suprimido. */}
        <button
          type="button"
          onClick={toggleGamesEnabled}
          className={[
            'mb-2 w-full rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors',
            gamesEnabled
              ? 'border-success/60 bg-success/10 text-success hover:bg-success/15'
              : 'border-danger/60 bg-danger/10 text-danger hover:bg-danger/15',
          ].join(' ')}
          title={
            gamesEnabled
              ? 'Las acciones de las reglas SE envían al juego. Click para desactivar.'
              : 'Las reglas disparan pero NO se envían al juego (modo seguro). Click para activar.'
          }
        >
          {gamesEnabled ? '🟢 Juegos ACTIVOS' : '🔴 Juegos DESACTIVADOS'}
        </button>

        <select
          className="maru-input w-full text-sm"
          value={selectedGameId ?? ''}
          onChange={(e) =>
            setSelectedGameId(((e.target.value as GameId) || null))
          }
        >
          {games.length === 0 && <option value="">Sin juegos</option>}
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.icon} {g.name}
            </option>
          ))}
        </select>

        <div className="mt-2 flex items-center gap-2 text-xs">
          <StatusDot
            status={
              gameTest.state === 'ok'
                ? 'connected'
                : gameTest.state === 'error'
                  ? 'error'
                  : gameTest.state === 'testing'
                    ? 'connecting'
                    : 'disconnected'
            }
            label=""
          />
          <span
            className={
              gameTest.state === 'ok'
                ? 'text-success'
                : gameTest.state === 'error'
                  ? 'text-danger'
                  : 'text-fg-subtle'
            }
          >
            {gameTest.state === 'testing'
              ? 'Probando…'
              : gameTest.state === 'ok'
                ? `Conectado · ${gameTest.message || ''}`
                : gameTest.state === 'error'
                  ? `Falló: ${gameTest.message}`
                  : 'Sin probar'}
          </span>
        </div>

        <p className="mt-1 text-[10px] text-fg-subtle leading-snug whitespace-pre-line">
          {activeGame
            ? `${activeGame.connectionType.toUpperCase()} · ${activeGame.connection.host}:${activeGame.connection.port}\n${activeGame.hasEntities ? '✅' : '❌'} Entidades  ${activeGame.hasItems ? '✅' : '❌'} Items  ${activeGame.hasEvents ? '✅' : '❌'} Eventos`
            : 'Selecciona un perfil…'}
        </p>

        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            title="Probar conexión con el juego (F5)"
            aria-keyshortcuts="F5"
            onClick={() => void handleGameTest()}
            disabled={!selectedGameId || gameTest.state === 'testing'}
          >
            <PlugZap className="h-3.5 w-3.5" />
            {gameTest.state === 'testing' ? 'Probando…' : 'Probar'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            title="Configurar perfiles de juego (host, puerto, RCON)"
            onClick={() => openModal('manage-games')}
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            Config
          </Button>
        </div>

        <Button
          variant="secondary"
          size="sm"
          className="mt-1.5 w-full"
          title="Crear un juego personalizado con tus propios comandos"
          onClick={() => openModal('manage-games')}
        >
          <span className="text-base leading-none">+</span>
          Añadir Juego
        </Button>
      </GroupBox>

      {/* ── 🔊 Texto a Voz ─────────────────────────────────────────── */}
      <GroupBox title="🔊 Texto a Voz" density="md">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={tts.config.enabled_chat && tts.config.enabled}
            onChange={(e) => patchTtsConfig({ enabled_chat: e.target.checked })}
            className="h-4 w-4 accent-mn-button"
          />
          Leer comentarios del chat
        </label>

        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-fg-muted shrink-0 w-9">Voz:</span>
          <select
            className="maru-input w-full text-xs"
            value={tts.config.default_voice}
            onChange={(e) =>
              patchTtsConfig({ default_voice: e.target.value })
            }
            disabled={tts.voicesStatus !== 'ready'}
          >
            {tts.voices.length === 0 && (
              <option value={tts.config.default_voice}>
                {tts.config.default_voice || 'Cargando…'}
              </option>
            )}
            {tts.voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>

        <VolumeSlider
          className="mt-2"
          icon={<Volume2 className="h-3.5 w-3.5" />}
          value={tts.config.volume_chat}
          onChange={(v) => patchTtsConfig({ volume_chat: v })}
          aria-label="Volumen TTS chat"
        />

        <input
          className="mt-2 maru-input w-full text-xs"
          placeholder="Texto de prueba..."
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
        />

        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleTtsTest()}
            disabled={testing || !testText.trim()}
          >
            {testing ? '⏳' : '▶'} Probar
          </Button>
          <Button
            variant="secondary"
            size="sm"
            title="Configurar voces por @usuario"
            onClick={() => openModal('voices')}
          >
            <Mic2 className="h-3.5 w-3.5" />
            Voces
          </Button>
        </div>

        <div className="mt-2 flex items-center gap-3 text-[11px]">
          {(['profile', 'global'] as TtsVoiceMode[]).map((mode) => (
            <label key={mode} className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="voicemode"
                checked={tts.config.voice_mode === mode}
                onChange={() => patchTtsConfig({ voice_mode: mode })}
              />
              <span>{mode === 'profile' ? '📁 Por perfil' : '🌐 Globales'}</span>
            </label>
          ))}
        </div>
      </GroupBox>

      {/* ── 🔮 Fortuna ─────────────────────────────────────────────── */}
      <GroupBox title="🔮 Fortuna" density="md">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-mn-button"
            checked={fortunesConfig.enabled}
            onChange={(e) => patchFortunes({ enabled: e.target.checked })}
          />
          Activar lectura de fortuna
        </label>

        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-fg-muted shrink-0 w-12">Regalo:</span>
          {(() => {
            const sel = allGifts.find((g) => g.id === fortunesConfig.gift_id);
            const iconRel = sel?.iconPath?.startsWith('donaciones/')
              ? sel.iconPath.slice('donaciones/'.length)
              : sel?.iconPath;
            return (
              <button
                type="button"
                onClick={() => setFortuneGiftPickerOpen(true)}
                disabled={!fortunesConfig.enabled}
                className={[
                  'maru-input flex w-full items-center gap-2 text-xs px-2 py-1',
                  'hover:border-fg-muted disabled:opacity-50 disabled:cursor-not-allowed',
                  'cursor-pointer text-left',
                ].join(' ')}
                title={
                  sel
                    ? `${sel.name} (${sel.coins}💎) — click para cambiar`
                    : 'Click para abrir la galería de regalos'
                }
              >
                {sel ? (
                  <>
                    <span className="shrink-0 flex h-5 w-5 items-center justify-center">
                      {iconRel ? (
                        <MaruImage
                          scope="donaciones"
                          path={iconRel}
                          alt={sel.name}
                          width={20}
                          height={20}
                          fallback={sel.icon || '🎁'}
                          className="object-contain max-w-[20px] max-h-[20px]"
                        />
                      ) : (
                        <span className="font-emoji">{sel.icon || '🎁'}</span>
                      )}
                    </span>
                    <span className="flex-1 truncate">{sel.name}</span>
                    <span className="text-[10px] text-fg-subtle font-mono shrink-0">
                      💎{sel.coins}
                    </span>
                  </>
                ) : (
                  <span className="text-fg-subtle italic">
                    🎁 Elegir regalo de la galería…
                  </span>
                )}
              </button>
            );
          })()}
        </div>
        <GiftSelectorDialog
          open={fortuneGiftPickerOpen}
          onClose={() => setFortuneGiftPickerOpen(false)}
          initialId={fortunesConfig.gift_id || null}
          title="🎁 Regalo que dispara fortuna"
          onSelect={(g) => {
            patchFortunes({ gift_id: g.id });
            setFortuneGiftPickerOpen(false);
          }}
        />

        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-fg-muted shrink-0 w-12">Voz:</span>
          <select
            className="maru-input w-full text-xs"
            value={fortunesConfig.voice}
            onChange={(e) => patchFortunes({ voice: e.target.value })}
            disabled={tts.voicesStatus !== 'ready'}
          >
            {tts.voices.length === 0 && (
              <option value={fortunesConfig.voice}>
                {fortunesConfig.voice || 'Cargando…'}
              </option>
            )}
            {tts.voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>

        <VolumeSlider
          className="mt-2"
          icon={<Volume2 className="h-3.5 w-3.5" />}
          value={fortunesConfig.volume_pct}
          onChange={(v) => patchFortunes({ volume_pct: v })}
          aria-label="Volumen Fortuna"
        />

        <Button
          variant="secondary"
          size="sm"
          className="mt-2 w-full"
          onClick={() => void handleFortuneTest()}
          disabled={fortuneTesting}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {fortuneTesting ? 'Leyendo…' : 'Probar Fortuna'}
        </Button>

        {fortuneFlash && (
          <div className="mt-2 rounded-md border border-accent/30 bg-accent/5 px-2 py-1.5 text-[10px] text-fg leading-snug max-h-20 overflow-y-auto">
            {fortuneFlash}
          </div>
        )}

        <p className="mt-2 text-[10px] text-fg-subtle leading-snug">
          💡 Lee la suerte del viewer que envíe el regalo
        </p>
      </GroupBox>

      {/* ── 💬 Sistema Social ──────────────────────────────────────── */}
      <GroupBox title="💬 Sistema Social" density="md">
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={socialEnabled}
              onChange={(e) => patchSocialEnabled(e.target.checked)}
              className="h-4 w-4 accent-mn-button"
            />
            Activar
          </label>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => openModal('social-config')}
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            Configurar
          </Button>
        </div>

      </GroupBox>

      {/* ── ⚙️ Configuración ──────────────────────────────────────── */}
      <GroupBox title="⚙️ Configuración" density="md">
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            title="Gestionar regalos personalizados"
            onClick={() => openModal('gifts')}
          >
            <Gift className="h-3.5 w-3.5" />
            Regalos
          </Button>
          <Button
            variant="secondary"
            size="sm"
            title="Gestionar sonidos por evento"
            onClick={() => openModal('sounds')}
          >
            <Bell className="h-3.5 w-3.5" />
            Sonidos
          </Button>
          <Button
            variant="secondary"
            size="sm"
            title="Galería de emotes/stickers por streamer"
            onClick={() => openModal('emotes')}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Emotes
          </Button>
        </div>

        <Button
          variant="secondary"
          size="sm"
          className="mt-1.5 w-full"
          title="Simular eventos TikTok (Ctrl+Shift+S)"
          aria-keyshortcuts="Control+Shift+S"
          onClick={() => openModal('simulator')}
        >
          <Theater className="h-3.5 w-3.5" />
          Simulador
        </Button>

        <Button
          variant="secondary"
          size="sm"
          className="mt-1.5 w-full"
          title="Guardar / cargar configuraciones"
          onClick={() => openModal('profiles')}
        >
          <Save className="h-3.5 w-3.5" />
          Perfiles
        </Button>

        <Button
          variant="secondary"
          size="sm"
          className="mt-1.5 w-full"
          title="Gestionar respaldos automáticos"
          onClick={() => openModal('backup')}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Respaldos
        </Button>

        <Button
          variant="secondary"
          size="sm"
          className="mt-1.5 w-full"
          title="Configurar IA (Claude / Groq / Gemini / OpenAI)"
          onClick={() => openModal('ia-config')}
        >
          <Bot className="h-3.5 w-3.5" />
          IA
        </Button>

        <Button
          variant="secondary"
          size="sm"
          className="mt-1.5 w-full"
          title="Configurar Spotify (cuentas, queue, comandos)"
          onClick={() => openModal('spotify-config')}
        >
          <Music className="h-3.5 w-3.5" />
          Spotify
        </Button>

        <Button
          variant="secondary"
          size="sm"
          className="mt-1.5 w-full"
          title="Diagnóstico del cliente TikTokLive (estado, versión, errores)"
          onClick={() => openModal('tiktok-api-info')}
        >
          <Wrench className="h-3.5 w-3.5" />
          TikTok API
        </Button>

      </GroupBox>

      {/* ── 🎨 Tema visual ─────────────────────────────────────────── */}
      <div className="mt-2">
        <ThemeSwitcher />
      </div>

      {/* Spacer al final */}
      <div className="h-2" />
    </div>
  );
}
