import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar.js';
import { CenterPanel } from './CenterPanel.js';
import { LogPanel } from './LogPanel.js';
import { HeaderGlobal } from './HeaderGlobal.js';

/**
 * MainLayout — la ventana única de MARU.
 *
 * Estructura (v1.0.40 redesign):
 *   ┌────────────────────────────────────────────────────────┐
 *   │  HeaderGlobal (56px)                                   │ ← v1.0.40
 *   ├────────────────────────────────────────────────────────┤
 *   │  Sidebar (310)  │  CenterPanel  │  LogPanel (380)      │
 *   └────────────────────────────────────────────────────────┘
 *
 * Las 3 columnas son IDÉNTICAS al layout previo (paridad total con
 * `gui/main_window.py:setup_ui()`). El header solo agrega contexto
 * global arriba y NO oculta ni reemplaza ningún componente:
 *   - Sidebar conserva sus 6 GroupBoxes y todos sus botones.
 *   - CenterPanel sus tabs (Reglas / Datos / Donaciones / Stats / etc.).
 *   - LogPanel sus filtros, toolbar, autoscroll, virtualización.
 *
 * El status global del header replica visualmente la info que el
 * Sidebar muestra en formato denso (StatusDot por sección). Es señal
 * periférica permanente — NO sustituto. Cualquier acción que antes
 * hacías por el Sidebar la seguís haciendo desde ahí.
 */
export function MainLayout(): ReactNode {
  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden isolate [contain:layout_paint]"
      data-app-shell
    >
      <HeaderGlobal />

      {/* Body con las 3 columnas — paridad EXACTA con el layout previo */}
      <div className="flex flex-1 gap-2.5 p-2.5 overflow-hidden">
        {/* Sidebar 310px scroll-y */}
        <aside
          className="w-[310px] shrink-0 overflow-y-auto overflow-x-hidden"
          aria-label="Menú principal"
          data-scrollbar="thin"
        >
          <Sidebar />
        </aside>

        {/* Center stretch — tabs (Reglas + dynamic) */}
        <main className="flex-1 min-w-0 flex flex-col gap-2.5 overflow-hidden">
          <CenterPanel />
        </main>

        {/* Right log panel 380px */}
        <aside
          className="w-[380px] shrink-0 flex flex-col gap-2 overflow-hidden"
          aria-label="Estadísticas y log"
        >
          <LogPanel />
        </aside>
      </div>
    </div>
  );
}
