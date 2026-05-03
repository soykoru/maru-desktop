import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, RefreshCw, Sparkles } from 'lucide-react';
import { useAppStore } from '../lib/store/index.js';
import { THEME_LIST, type ThemeId } from '../lib/store/ui-slice.js';
import { rpcCall } from '../lib/rpc.js';
import logoSrc from '../assets/logo.png';

/**
 * `HeaderGlobal` — barra superior 56px premium (FASE V1 redesign v1.0.40).
 *
 * Componentes visuales:
 *   - Brand mark con gradient (logo iniciales) + nombre "MARU LIVE" en
 *     gradient text + subtitle "Chaos Engine vX.Y.Z".
 *   - Status pill global con 4 dots (TikTok / Sidecar / Spotify / TTS) —
 *     señal periférica permanente, no intrusiva.
 *   - Theme switcher como 4 swatches circulares clickeables (replica el
 *     ThemeSwitcher original pero más compacto y siempre visible).
 *   - Botón update: aparece SOLO cuando hay update disponible. Permanece
 *     consistente con el UpdateBanner inferior — se puede tapar uno sin
 *     perder la otra señal.
 *
 * Reglas duras:
 *   - NO sustituye al Sidebar/LogPanel: solo agrega contexto global arriba.
 *   - NO oculta ni reemplaza ningún botón existente. ThemeSwitcher full
 *     sigue disponible internamente desde el sidebar/configuración.
 *   - Cero RPC nuevos. Reusa selectors del store (zustand) — no agrega
 *     re-renders globales.
 *
 * Layout: 56px alto, `flex-shrink-0`, `backdrop-filter: blur(20px)`,
 * borde inferior con shimmer accent — composite-only.
 */
export function HeaderGlobal(): ReactNode {
  // Status global desde el store — los mismos selectors que ya usa el
  // Sidebar y el SystemHealthWidget, sin nuevas suscripciones.
  const tiktokStatus = useAppStore((s) => s.tiktokStatus);
  const tiktokAvatarUrl = useAppStore((s) => s.tiktokAvatarUrl);
  const tiktokUsername = useAppStore((s) => s.tiktokUsername);
  const sidecarStatus = useAppStore((s) => s.sidecarStatus);
  const spotifyConnected = useAppStore((s) => s.spotifyStatus.connected);
  const updater = useAppStore((s) => s.updater);
  const dismissedBanner = useAppStore((s) => s.bannerDismissed);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  // TTS no tiene "estado de conexión" como TikTok/Spotify; lo derivamos
  // del sidecar (si el sidecar está vivo, TTS está disponible). Esto es
  // consistente con SystemHealthWidget.
  const ttsAvailable = sidecarStatus === 'connected';

  function handleSelectTheme(id: ThemeId) {
    if (id === theme) return;
    setTheme(id);
    void rpcCall('settings.set', { patch: { theme: id } }).catch(() => undefined);
  }

  // ── Versión actual de la app, para el subtitle del brand ─────────
  // Se carga 1 sola vez al montar; 100% local (IPC del main, no llega
  // al sidecar). Si el handler aún no está listo, dejamos string vacío
  // y el subtitle muestra solo "Chaos Engine" (degrada bien).
  const [appVersion, setAppVersion] = useState<string>('');
  useEffect(() => {
    let cancelled = false;
    void window.maruApi.app
      .getVersion()
      .then((r) => {
        if (!cancelled && r && typeof r.version === 'string') {
          setAppVersion(r.version);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Update CTA: comparte estado con UpdateBanner pero ofrece acción
  // rápida sin abrir la cara más extensa del banner. ───────────────
  const showUpdateCta =
    updater.phase === 'available' || updater.phase === 'downloading' || updater.phase === 'ready';

  // Pulse del update icon cuando hay novedad: animado solo si el banner
  // grande no está visible (evita doble-anuncio de la misma señal).
  const pulse = showUpdateCta && dismissedBanner;

  return (
    <header
      className="header-v140 relative z-10 flex h-14 shrink-0 items-center justify-between gap-3 px-4"
      aria-label="Barra superior"
    >
      <BrandBlock
        version={appVersion}
        avatarUrl={tiktokAvatarUrl}
        username={tiktokUsername}
        connected={tiktokStatus === 'connected'}
      />

      <GlobalStatusPill
        tiktok={tiktokStatus === 'connected'}
        sidecar={sidecarStatus === 'connected'}
        spotify={spotifyConnected}
        tts={ttsAvailable}
      />

      <div className="flex items-center gap-3">
        <ThemeSwatchRow theme={theme} onSelect={handleSelectTheme} />
        {showUpdateCta && (
          <UpdateCta
            phase={updater.phase}
            version={
              updater.phase === 'available' || updater.phase === 'ready'
                ? updater.version
                : undefined
            }
            pulse={pulse}
          />
        )}
      </div>
    </header>
  );
}

// ────────────────────────────────────────────────────────────────────
// Subcomponentes locales (no exportados — reuso solo dentro del header)
// ────────────────────────────────────────────────────────────────────

function BrandBlock({
  version,
  avatarUrl,
  username,
  connected,
}: {
  version: string;
  avatarUrl: string;
  username: string | null;
  connected: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      {/* Logo real (logo.png) sin marco — el container es transparente
          para que el logo respire sin un cuadrado de fondo encima. */}
      <div className="header-v140-mark" aria-hidden="true">
        <img
          src={logoSrc}
          alt="MARU"
          width={36}
          height={36}
          className="block h-full w-full object-contain"
          draggable={false}
        />
      </div>
      <div className="leading-tight min-w-0">
        <div className="header-v140-brand text-[15px] font-extrabold tracking-tight">
          MARU LIVE
        </div>
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-fg-subtle font-mono">
          {version ? `v${version}` : '—'}
        </div>
      </div>
      {/* Avatar + handle del streamer cuando está conectado al live. */}
      {connected && username && (
        <div className="ml-3 flex items-center gap-2 rounded-full border border-fg/10 bg-bg-elevated/40 pl-1 pr-3 py-1 animate-fade-in">
          <div className="h-7 w-7 rounded-full overflow-hidden bg-bg-elev shrink-0 ring-2 ring-success/40">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
                draggable={false}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[12px] font-bold text-fg-muted">
                {username.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex flex-col leading-none gap-1">
            <span className="text-[11px] font-bold leading-tight">@{username}</span>
            <span className="text-[9px] text-success font-semibold tracking-wider uppercase leading-none">en vivo</span>
          </div>
        </div>
      )}
    </div>
  );
}

function GlobalStatusPill({
  tiktok,
  sidecar,
  spotify,
  tts,
}: {
  tiktok: boolean;
  sidecar: boolean;
  spotify: boolean;
  tts: boolean;
}) {
  const items: { label: string; ok: boolean; key: string }[] = [
    { label: 'TikTok', ok: tiktok, key: 'tk' },
    { label: 'Sidecar', ok: sidecar, key: 'sc' },
    { label: 'Spotify', ok: spotify, key: 'sp' },
    { label: 'TTS', ok: tts, key: 'tt' },
  ];
  return (
    <div
      className="hidden md:flex items-center gap-3 rounded-full border border-border-subtle/70 bg-bg-elevated/40 px-3 py-1.5"
      role="status"
      aria-live="polite"
    >
      {items.map((it) => (
        <div key={it.key} className="flex items-center gap-1.5 text-[11px] text-fg-muted">
          <span
            className={[
              'inline-block h-2 w-2 rounded-full',
              it.ok
                ? 'bg-success shadow-[0_0_6px_rgb(46_204_113/0.55)]'
                : 'bg-fg-subtle/60',
            ].join(' ')}
            aria-label={it.ok ? `${it.label} conectado` : `${it.label} desconectado`}
          />
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

function ThemeSwatchRow({
  theme,
  onSelect,
}: {
  theme: ThemeId;
  onSelect: (id: ThemeId) => void;
}) {
  // Gradients precomputados — los mismos colores firma de cada tema.
  const swatchBg: Record<ThemeId, string> = {
    midnight: 'linear-gradient(135deg, #f39c12, #74b9ff)',
    dracula: 'linear-gradient(135deg, #ff79c6, #bd93f9)',
    'tokyo-night': 'linear-gradient(135deg, #7aa2f7, #bb9af7)',
    'catppuccin-mocha': 'linear-gradient(135deg, #cba6f7, #f5c2e7)',
    'pure-dark': 'linear-gradient(135deg, #000000, #2a2a35)',
    nord: 'linear-gradient(135deg, #88c0d0, #5e81ac)',
  };
  return (
    <div
      className="flex items-center gap-1.5"
      role="radiogroup"
      aria-label="Cambiar tema visual"
    >
      {THEME_LIST.map((t) => {
        const active = t.id === theme;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(t.id)}
            title={`${t.emoji} ${t.label} — ${t.description}`}
            className={[
              'theme-swatch-v140 relative h-[18px] w-[18px] rounded-full border-2 transition-all duration-200',
              active
                ? 'border-fg shadow-[0_0_0_2px_rgb(var(--maru-accent)/0.5)]'
                : 'border-fg/15 hover:border-fg/40 hover:scale-110',
            ].join(' ')}
            style={{ background: swatchBg[t.id] }}
          />
        );
      })}
    </div>
  );
}

function UpdateCta({
  phase,
  version,
  pulse,
}: {
  phase: 'available' | 'downloading' | 'ready' | string;
  version?: string;
  pulse: boolean;
}) {
  // Acción del CTA depende de la fase. Para `downloading` (sin acción
  // útil que tomar) hacemos no-op visualmente pero sigue siendo
  // hover-able para mostrar el tooltip con el estado completo.
  const checkNow = () => void window.maruApi.updater.checkNow();
  const installRestart = () => void window.maruApi.updater.installAndRestart();

  let label = '';
  let icon: ReactNode = <Download className="h-3.5 w-3.5" />;
  let onClick: () => void = checkNow;

  if (phase === 'available') {
    label = `v${version ?? '?'} disponible`;
    icon = <Sparkles className="h-3.5 w-3.5" />;
  } else if (phase === 'downloading') {
    label = 'Descargando…';
    icon = <RefreshCw className="h-3.5 w-3.5 animate-spin" />;
    onClick = () => undefined;
  } else if (phase === 'ready') {
    label = 'Listo · Reiniciar';
    icon = <Download className="h-3.5 w-3.5" />;
    onClick = installRestart;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'header-v140-cta inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-all duration-200',
        'border-accent/30 bg-accent/12 text-accent hover:bg-accent/20 hover:scale-[1.03]',
        pulse ? 'animate-pulse-soft' : '',
      ].join(' ')}
      title={`Estado del actualizador: ${phase}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
