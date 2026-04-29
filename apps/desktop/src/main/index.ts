/**
 * Electron main entry — MARU Live Desktop.
 *
 * Responsabilidades:
 *  - Crear la ventana principal con frame nativo del SO (botones ─ ▢ ✕).
 *  - Levantar el sidecar Python en paralelo (no bloquea la UI).
 *  - Iniciar el AutoUpdater y telemetría opcional.
 *  - Exponer IPC para RPC del renderer y controles de updater.
 *
 * En dev:
 *  - El renderer se sirve desde Vite en `process.env.ELECTRON_RENDERER_URL`.
 *  - DevTools se abren detached automáticamente para diagnóstico.
 *  - CSP no se aplica (necesario para HMR de Vite con WS al dev server).
 *
 * En producción:
 *  - El renderer es estático (`out/renderer/index.html`).
 *  - CSP estricta vía response header en `loadFile`.
 */

import { app, BrowserWindow, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SidecarManager } from './sidecar.js';
import { RpcClient } from './rpc-client.js';
import { attachRpcClient, detachRpcClient, installIpcHandlers } from './ipc.js';
import { RUNTIME_CONFIG } from './runtime-config.js';
import { AutoUpdater } from './auto-updater.js';
import { hardenWindow, installShortcutBlockers } from './hardening.js';
import { initTelemetry, captureException } from './telemetry.js';
import { SplashWindow } from './splash.js';
import {
  registerImageProtocolHandler,
  registerImageProtocolPrivileges,
} from './image-protocol.js';
import { installTray, hookWindowToTray, destroyTray } from './tray.js';
import { installNotifications } from './notifications.js';

// CRÍTICO: registrar privilegios del scheme `maru://` ANTES de app.ready.
// Si esto se llama después, Electron lanza error y el protocolo no funciona.
registerImageProtocolPrivileges();

let mainWindow: BrowserWindow | null = null;
let splash: SplashWindow | null = null;
const sidecar = new SidecarManager();
const rpc = new RpcClient();
const updater = new AutoUpdater(() => mainWindow);

initTelemetry(app.getVersion());

function resolvePreloadPath(): string {
  // electron-vite por default emite el preload como `.mjs`; si por algún
  // motivo se generó como `.js` lo aceptamos también.
  const candidates = ['../preload/index.mjs', '../preload/index.js'];
  for (const rel of candidates) {
    const p = join(__dirname, rel);
    if (existsSync(p)) return p;
  }
  // Fallback al .mjs (mismo path que candidates[0]) — Electron mostrará un
  // error claro de "Cannot find module" si tampoco existe ahí.
  return join(__dirname, candidates[0]!);
}

function applyProductionCsp(): void {
  // NO-OP en ambos modos.
  //
  // Histórico: una versión previa inyectaba `Content-Security-Policy`
  // via `onHeadersReceived`. Eso rompía la app empaquetada porque
  // `script-src 'self'` no resolvía bien para `file://` URLs en
  // Chromium → los chunks JS del renderer (`./assets/index-XXX.js`)
  // se bloqueaban silenciosamente → `ready-to-show` nunca disparaba →
  // ventana invisible para siempre.
  //
  // El `index.html` de Vite ya incluye un meta CSP suficiente
  // (`<meta http-equiv="Content-Security-Policy" content="...">`) que
  // se aplica al renderer principal. El splash usa `data:text/html`
  // que vive bajo trust del main process. Doble CSP es redundante y
  // peligroso.
}

function resolveAppIcon(): string | undefined {
  // Empaquetado: el icon vive en `resources/` (extra resource).
  // Dev: el archivo está en `apps/desktop/resources/`.
  const candidates = [
    join(__dirname, '../../resources/icon.ico'),
    join(__dirname, '../../resources/logo.png'),
    join(process.resourcesPath ?? '', 'icon.ico'),
    join(process.resourcesPath ?? '', 'logo.png'),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return undefined;
}

function createMainWindow(): BrowserWindow {
  const icon = resolveAppIcon();
  const win = new BrowserWindow({
    width: 1340,
    height: 860,
    minWidth: 1140,
    minHeight: 740,
    // Background matchea bg-base del tema midnight (#1a1a2e) para evitar
    // flash blanco al cargar el renderer.
    backgroundColor: '#1a1a2e',
    title: 'MARU Live',
    autoHideMenuBar: true,
    icon,
    // Frame nativo del SO — controles ─ ▢ ✕ siempre garantizados.
    show: false,
    webPreferences: {
      // electron-vite emite el preload como .mjs por default; algunos
      // setups antiguos lo dejan en .js. Resolvemos automáticamente.
      preload: resolvePreloadPath(),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  // Diagnóstico: capturar fallos del renderer para que nunca quede en pantalla
  // muda (azul sin contenido). En dev abrimos DevTools si pasa algo.
  win.webContents.on('did-fail-load', (_e, code, description, validatedURL) => {
    console.error(`[renderer] did-fail-load ${code} (${description}) → ${validatedURL}`);
    if (RUNTIME_CONFIG.isDev) win.webContents.openDevTools({ mode: 'detach' });
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] render-process-gone', details);
  });
  win.webContents.on('preload-error', (_e, file, error) => {
    console.error('[renderer] preload-error', file, error);
  });
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) {
      // 0=verbose, 1=info, 2=warning, 3=error
      console.warn(`[renderer:${level}] ${source}:${line} ${message}`);
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Patrón splash → ready-to-show:
  //   1. La ventana arranca con `show:false` y `setOpacity(0)`.
  //   2. Cuando React montó (ready-to-show), esperamos a que el splash
  //      termine su animación (~1.7s); si ya terminó, mostramos al toque.
  //   3. Fade-out del splash + reveal del main con opacidad 1.
  win.setOpacity(0);
  let renderReady = false;
  let splashDone = !splash; // si por algún motivo no hay splash, true
  const tryReveal = async (): Promise<void> => {
    if (!renderReady || !splashDone) return;
    if (splash) {
      void splash.fadeOut();
      splash = null;
    }
    if (!win.isDestroyed()) {
      win.show();
      win.setOpacity(1);
      if (RUNTIME_CONFIG.isDev) {
        win.webContents.openDevTools({ mode: 'detach' });
      }
    }
  };

  win.once('ready-to-show', () => {
    renderReady = true;
    void tryReveal();
  });

  if (splash) {
    splash.onFinished(() => {
      splashDone = true;
      void tryReveal();
    });
  }

  // Hardening solo en prod (en dev DevTools necesitan estar abiertas).
  hardenWindow(win);

  if (RUNTIME_CONFIG.isDev && process.env['ELECTRON_RENDERER_URL']) {
    console.log(`[main] loading renderer from ${process.env['ELECTRON_RENDERER_URL']}`);
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    const file = join(__dirname, '../renderer/index.html');
    console.log(`[main] loading renderer from file ${file}`);
    void win.loadFile(file);
  }

  return win;
}

async function bootSidecar(): Promise<void> {
  try {
    const info = await sidecar.start();
    console.log(`[main] sidecar ready on port ${info.rpcPort} (pid ${info.pid})`);
    await rpc.connect(info.rpcPort);
    attachRpcClient(rpc, mainWindow);
    mainWindow?.webContents.send('sidecar:ready', info);
  } catch (err) {
    console.error('[main] sidecar boot failed', err);
    captureException(err);
  }
}

app.whenReady().then(async () => {
  applyProductionCsp();
  // Custom protocol `maru://` para imágenes del bundle (G2.2).
  // Sirve donaciones / triggers / game_images / templates con LRU cache.
  registerImageProtocolHandler();
  installIpcHandlers(() => mainWindow, updater);
  installShortcutBlockers();
  // Splash primero: 380x280 frameless con progress bar gradient.
  // Replica `gui/widgets/splash.py:AnimatedSplashScreen` del MARU original.
  splash = new SplashWindow();
  await splash.show();
  mainWindow = createMainWindow();
  // Tray + minimize-to-tray (paridad MARU original).
  installTray(() => mainWindow);
  hookWindowToTray(mainWindow);
  // OS notifications cuando llegan eventos relevantes (gifts, follows).
  installNotifications(() => mainWindow);
  // El sidecar arranca en paralelo — la UI se muestra antes y se actualiza
  // cuando el push event `sidecar:ready` llega.
  void bootSidecar();
  updater.init();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      void bootSidecar();
    }
  });
});

app.on('window-all-closed', async () => {
  detachRpcClient();
  updater.dispose();
  destroyTray();
  await rpc.disconnect();
  await sidecar.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (e) => {
  // Evitar shutdown abrupto: drenamos sidecar y rpc antes de salir.
  if (sidecar.rpcPort === null && !rpc.isConnected) return;
  e.preventDefault();
  updater.dispose();
  await rpc.disconnect();
  await sidecar.stop();
  app.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException', err);
  captureException(err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection', reason);
  captureException(reason);
});
