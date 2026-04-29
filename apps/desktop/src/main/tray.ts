/**
 * System Tray integration — paridad con MARU original que minimiza al tray.
 *
 * - Click izquierdo en el icon: muestra/restaura ventana.
 * - Click derecho: menu contextual (Mostrar / Salir).
 * - Cuando el user minimiza la ventana, la escondemos al tray.
 * - El icon usa el mismo `icon.ico` / `logo.png` que la ventana.
 */

import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  type NativeImage,
} from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

let trayInstance: Tray | null = null;

function resolveTrayIcon(): NativeImage | undefined {
  const candidates = [
    join(__dirname, '../../resources/icon.ico'),
    join(__dirname, '../../resources/logo.png'),
    join(process.resourcesPath ?? '', 'icon.ico'),
    join(process.resourcesPath ?? '', 'logo.png'),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) {
      try {
        return nativeImage.createFromPath(p);
      } catch {
        /* try next */
      }
    }
  }
  return undefined;
}

export function installTray(getWindow: () => BrowserWindow | null): void {
  if (trayInstance) return;
  const icon = resolveTrayIcon();
  if (!icon || icon.isEmpty()) {
    console.warn('[tray] no se pudo resolver icon, tray deshabilitado');
    return;
  }

  trayInstance = new Tray(icon);
  trayInstance.setToolTip('MARU Live');

  function showWindow() {
    const w = getWindow();
    if (!w) return;
    if (w.isMinimized()) w.restore();
    if (!w.isVisible()) w.show();
    w.focus();
  }

  trayInstance.on('click', showWindow);
  trayInstance.on('double-click', showWindow);

  const menu = Menu.buildFromTemplate([
    {
      label: 'Mostrar MARU',
      click: showWindow,
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        // Forzar quit (no minimizar al tray otra vez).
        app.quit();
      },
    },
  ]);
  trayInstance.setContextMenu(menu);
}

/**
 * Cablea minimize → hide-to-tray. Esconde la ventana en lugar de minimizar
 * si el tray está activo. El close (X) también esconde, salvo en macOS o
 * si el user fuerza quit desde el menú.
 */
export function hookWindowToTray(win: BrowserWindow): void {
  if (!trayInstance) return;

  let forcedQuit = false;
  app.on('before-quit', () => {
    forcedQuit = true;
  });

  // Cast: en algunas versiones de @types/electron el listener de 'minimize'
  // se tipa sin Event, pero en runtime sí recibe uno con preventDefault().
  win.on('minimize', ((e: Electron.Event) => {
    if (process.platform === 'darwin') return; // mac usa dock, no tray
    e.preventDefault();
    win.hide();
  }) as () => void);

  win.on('close', (e) => {
    if (forcedQuit || process.platform === 'darwin') return;
    e.preventDefault();
    win.hide();
  });
}

export function destroyTray(): void {
  if (trayInstance) {
    trayInstance.destroy();
    trayInstance = null;
  }
}
