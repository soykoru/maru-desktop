/**
 * Hardening de seguridad para producción.
 *
 * En producción (`app.isPackaged`):
 *  - DevTools bloqueadas (no se abren con F12 / shortcut).
 *  - Navegación a cualquier URL fuera de la app: cancelada y abierta en
 *    browser externo (vía `shell.openExternal`).
 *  - Refrescos por shortcut (Ctrl/Cmd+R, Ctrl/Cmd+Shift+R) bloqueados.
 *  - Permisos del webContents (camera/mic/...) negados por default.
 *  - Atajos de Electron globales no peligrosos (zoom etc.) preservados.
 *
 * En dev: no-op a menos que se setee `MARU_FORCE_HARDENING=1` para probar.
 */

import { app, BrowserWindow, shell } from 'electron';

const isProd = (): boolean =>
  app.isPackaged || process.env['MARU_FORCE_HARDENING'] === '1';

export function hardenWindow(win: BrowserWindow): void {
  if (!isProd()) return;

  const wc = win.webContents;

  // 1. Bloquear DevTools (cierra y previene apertura)
  wc.on('devtools-opened', () => wc.closeDevTools());
  wc.on('before-input-event', (event, input) => {
    const isF12 = input.key === 'F12';
    const isCmdOrCtrl = input.control || input.meta;
    const isShift = input.shift;
    const isI = input.key.toLowerCase() === 'i';
    const isJ = input.key.toLowerCase() === 'j';
    const isU = input.key.toLowerCase() === 'u';
    const isR = input.key.toLowerCase() === 'r';
    if (
      isF12 ||
      (isCmdOrCtrl && isShift && (isI || isJ)) ||
      (isCmdOrCtrl && isU) ||
      (isCmdOrCtrl && isR)
    ) {
      event.preventDefault();
    }
  });

  // 2. Bloquear navegación fuera del app — abrir en browser externo
  wc.on('will-navigate', (event, url) => {
    const allowed = url.startsWith('file://') || url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? '__none__');
    if (!allowed) {
      event.preventDefault();
      if (url.startsWith('http')) void shell.openExternal(url);
    }
  });

  // 3. Bloquear creación de nuevas ventanas (excepto links externos vía openExternal)
  wc.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // 4. Permisos: por defecto denegar
  wc.session.setPermissionRequestHandler((_, _permission, callback) => {
    callback(false);
  });

  // 5. Bloquear webview (no debería haber, pero por las dudas)
  wc.on('will-attach-webview', (event) => event.preventDefault());
}

/**
 * Bloquea atajos peligrosos a nivel global de la app.
 * Llamar una sola vez al `app.whenReady`.
 */
export function installShortcutBlockers(): void {
  if (!isProd()) return;
  // Por ahora confiamos en `before-input-event` por ventana. Si en F8
  // detectamos que algún atajo se cuela, acá registraríamos
  // `globalShortcut.register('CommandOrControl+Shift+I', () => {})`
  // para "robar" el atajo a nivel global.
}
