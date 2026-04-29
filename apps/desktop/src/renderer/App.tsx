import { useEffect } from 'react';
import { Toaster } from '@maru/ui';
import { MainLayout } from './components/MainLayout.js';
import { ModalRoot } from './components/ModalRoot.js';
import { UpdateBanner } from './components/UpdateBanner.js';
import { useGlobalShortcuts } from './lib/use-shortcuts.js';
import { wireSidecarEvents } from './lib/event-wire.js';

/**
 * App root — ventana única (Plan G · Opción A).
 *
 * Reemplaza al HashRouter inventado en F0-F8 (que rompía paridad con
 * MARU original). MARU es una sola ventana con 3 columnas y diálogos
 * modales — eso replicamos.
 *
 *   <MainLayout>  = sidebar 310 + center stretch + log panel 380.
 *   <ModalRoot>   = stack global de modales (single open at a time).
 *   <Toaster>     = notificaciones flotantes.
 */
export function App() {
  useEffect(() => {
    return wireSidecarEvents();
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
