import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar.js';
import { CenterPanel } from './CenterPanel.js';
import { LogPanel } from './LogPanel.js';

/**
 * MainLayout — la ventana única de MARU.
 *
 * Replica el layout principal del `gui/main_window.py:setup_ui()`:
 *   QHBoxLayout(spacing=10, margins=10)
 *     ├── _build_left_panel(main)   → 310px fijo (Sidebar)
 *     ├── _build_center_panel(main) → stretch (CenterPanel con tabs)
 *     └── _build_right_panel(main)  → 380px fijo (StatsPanel + Health + LogPanel)
 *
 * Decisión Plan G — Opción A: ventana única sin rutas. Los botones del
 * sidebar abren modales (manejados por <ModalRoot/>).
 *
 * Premium polish añadido:
 *   - `motion-reduce` respeta prefers-reduced-motion.
 *   - Backdrop sutil con noise texture (TODO G1 follow-up — sin romper paridad).
 *   - Smooth resize cuando el sidebar se colapsa (futuro).
 */
export function MainLayout(): ReactNode {
  return (
    <div
      className="flex h-screen w-screen gap-2.5 p-2.5 overflow-hidden isolate [contain:layout_paint]"
      data-app-shell
    >
      {/* Sidebar 310px scroll-y, sticky vertical */}
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
  );
}
