import { useEffect } from 'react';
import { Toaster } from '@maru/ui';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { MainLayout } from './components/MainLayout.js';
import { ModalRoot } from './components/ModalRoot.js';
import { NotifyHost } from './components/NotifyHost.js';
import { useGlobalShortcuts } from './lib/use-shortcuts.js';
import { wireSidecarEvents } from './lib/event-wire.js';
import { useAppStore } from './lib/store/index.js';
import { THEME_LIST, type ThemeId } from './lib/store/ui-slice.js';
import { rpcCall } from './lib/rpc.js';

/** requestIdleCallback con fallback a setTimeout(0) para Electron 33+. */
const ric: (cb: () => void) => number =
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? (cb) => (window as Window & {
        requestIdleCallback: (cb: () => void) => number;
      }).requestIdleCallback(cb)
    : (cb) => window.setTimeout(cb, 1);

/**
 * App root — ventana única.
 *
 *   <MainLayout>  = sidebar 310 + center stretch + log panel 380.
 *   <ModalRoot>   = stack global de modales (single open at a time).
 *   <Toaster>     = notificaciones flotantes.
 *
 * Theme boot: lee settings.theme y aplica `data-theme` en <html> antes
 * de que el usuario interactúe. Si no hay tema persistido o es inválido,
 * usa `midnight` (default).
 */
export function App() {
  const setTheme = useAppStore((s) => s.setTheme);

  // Bootstrap del tema persistido (corre 1 vez al montar)
  useEffect(() => {
    void rpcCall('settings.get', {})
      .then((r) => {
        const cfg = (r as { config?: { theme?: string } }).config;
        const persisted = cfg?.theme;
        if (
          typeof persisted === 'string' &&
          THEME_LIST.some((t) => t.id === persisted)
        ) {
          setTheme(persisted as ThemeId);
        } else {
          // Asegurar data-theme aunque no haya nada persistido
          document.documentElement.setAttribute('data-theme', 'midnight');
        }
      })
      .catch(() => {
        document.documentElement.setAttribute('data-theme', 'midnight');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return wireSidecarEvents();
  }, []);

  // Warmup en idle: precargar caches del store cuando el browser tenga
  // tiempo libre, sin bloquear el primer paint.
  //
  // Estrategia v1.0.35:
  //  1. Para hooks con auto-load (gifts, voices), poblamos el STORE
  //     directamente vía setGifts/setVoices/etc. Esto setea
  //     status='ready' y el hook no dispara refresh al montar el modal.
  //  2. Para configs (social, spotify, ia, tts), un rpcCall simple
  //     calienta el cache del sidecar Python — la 2da vez es instantáneo.
  //
  // Stagger 80ms entre warmups para no saturar el sidecar.
  useEffect(() => {
    type Warmup = () => Promise<void>;

    const warmups: Warmup[] = [
      // Gifts → store
      async () => {
        try {
          const r = (await rpcCall('donations.list', {
            includeDisabled: true,
          })) as { gifts?: unknown[] };
          const s = useAppStore.getState();
          if (r?.gifts && s.giftsStatus === 'idle') {
            s.setGifts(r.gifts as never);
          }
        } catch { /* sidecar no listo, el hook reintenta cuando se abra */ }
      },
      // TTS voices → calienta el cache del sidecar
      async () => {
        try { await rpcCall('tts.list-voices', {}); } catch { /* */ }
      },
      // Resto: solo calienta cache del sidecar
      async () => { try { await rpcCall('games.list', {}); } catch {} },
      async () => { try { await rpcCall('sounds.list', { scope: 'global' }); } catch {} },
      async () => { try { await rpcCall('social.config.get', {}); } catch {} },
      async () => { try { await rpcCall('spotify.config.get', {}); } catch {} },
      async () => { try { await rpcCall('ia.config.get', {}); } catch {} },
      async () => { try { await rpcCall('tts.config.get', {}); } catch {} },
      async () => { try { await rpcCall('tts.user-voices.list', {}); } catch {} },
      async () => { try { await rpcCall('spotify.accounts.list', {}); } catch {} },
      async () => { try { await rpcCall('profiles.list', {}); } catch {} },
    ];

    const timers: number[] = [];
    warmups.forEach((fn, i) => {
      const t = window.setTimeout(() => {
        ric(() => { void fn(); });
      }, i * 80);
      timers.push(t);
    });
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  useGlobalShortcuts();

  return (
    <ErrorBoundary>
      {/* Capa de fondo dedicada — fija, GPU-promoted, aislada de
          repaints. Reemplaza el gradient del <body> que parpadeaba al
          recomponer el backdrop-filter de paneles con cada push event. */}
      <div className="maru-bg-shell" aria-hidden="true" />
      <MainLayout />
      <ModalRoot />
      {/* v1.0.94+: confirm dialog global (reemplaza window.confirm). */}
      <NotifyHost />
      {/* UpdateBanner inferior removido v1.0.49 — el CTA en el
          HeaderGlobal cubre la misma funcionalidad sin duplicarla. */}
      <Toaster />
    </ErrorBoundary>
  );
}
