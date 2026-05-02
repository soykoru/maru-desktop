import { useEffect } from 'react';
import { Toaster } from '@maru/ui';
import { MainLayout } from './components/MainLayout.js';
import { ModalRoot } from './components/ModalRoot.js';
import { UpdateBanner } from './components/UpdateBanner.js';
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

  // Warmup en idle: precargar caches pesados (gifts, voices) cuando el
  // browser tenga tiempo libre, sin bloquear el primer paint. Cuando el
  // user abra el modal de gifts o voices, ya está listo. Cero impacto
  // en boot porque corre DESPUÉS de que la UI ya pintó.
  useEffect(() => {
    ric(() => {
      void rpcCall('gifts.list', {}).catch(() => undefined);
    });
    ric(() => {
      void rpcCall('tts.voices.list', {}).catch(() => undefined);
    });
    ric(() => {
      void rpcCall('sounds.list', {}).catch(() => undefined);
    });
  }, []);

  useGlobalShortcuts();

  return (
    <>
      {/* Capa de fondo dedicada — fija, GPU-promoted, aislada de
          repaints. Reemplaza el gradient del <body> que parpadeaba al
          recomponer el backdrop-filter de paneles con cada push event. */}
      <div className="maru-bg-shell" aria-hidden="true" />
      <MainLayout />
      <ModalRoot />
      <UpdateBanner />
      <Toaster />
    </>
  );
}
