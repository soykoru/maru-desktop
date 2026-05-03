/**
 * Puente IPC entre el renderer y el main.
 *
 * - Renderer ↔ sidecar: `rpc:call` invoca `RpcClient.call`.
 * - Renderer ← sidecar: push events forwardeados por canal nombrado
 *   (mismos nombres que en `@maru/shared/rpc/events`).
 * - Renderer ↔ ventana: minimize/maximize/close.
 * - Renderer ↔ updater: state, checkNow, installAndRestart, disable.
 */

import { app, ipcMain, shell, type BrowserWindow } from 'electron';
import type { RpcClient } from './rpc-client.js';
import type { AutoUpdater } from './auto-updater.js';
import { maybeNotifyPushEvent } from './notifications.js';
import { clearImageCache } from './image-protocol.js';

let activeClient: RpcClient | null = null;
// Listeners actualmente conectados — los retenemos para poder
// removerlos en `attachRpcClient` antes de re-adjuntar. Sin esto,
// llamar `attachRpcClient` dos veces (caso real: una vez antes del boot
// del sidecar para bufferizar RPCs tempranos, otra vez después para
// re-asociar la window) DUPLICABA cada push event en el renderer →
// cada `log:entry`, `tiktok:event`, etc. llegaba 2x al store.
let attachedListeners: Array<{ event: string; fn: (...args: unknown[]) => void }> = [];

const FORWARDED_PUSH_EVENTS = [
  'sidecar:log',
  'tiktok:status',
  'tiktok:event',
  'tiktok:stats',
  'tiktok:error',
  'tiktok:log', // detalle granular del worker (reconexión, API errors)
  'rules:fired',
  'rules:executed', // RuleDispatcher → log feed con ✅/❌
  'gifts:updated', // gift descargado/reactivado → refresca galería
  'emotes:updated', // emote nuevo descargado → refresca pestaña emotes
  'tiktok:comment-enriched', // comment con super_fan/moderator/etc.
  'spotify:status', // G14
  'spotify:now-playing',
  'spotify:queue', // cola actualizada en tiempo real
  'social:update',
  'log:entry', // G11
] as const;

export function attachRpcClient(client: RpcClient, win: BrowserWindow | null): void {
  // Remover listeners previos del cliente (si quedó del attach anterior).
  // EventEmitter.on agrega siempre — sin esta limpieza el segundo
  // attachRpcClient duplicaba cada push event al renderer.
  if (activeClient) {
    for (const { event, fn } of attachedListeners) {
      activeClient.off(event, fn);
    }
  }
  attachedListeners = [];

  activeClient = client;

  const connectedFn = () => win?.webContents.send('rpc:connected');
  const disconnectedFn = () => win?.webContents.send('rpc:disconnected');
  client.on('connected', connectedFn);
  client.on('disconnected', disconnectedFn);
  attachedListeners.push({ event: 'connected', fn: connectedFn });
  attachedListeners.push({ event: 'disconnected', fn: disconnectedFn });

  for (const evt of FORWARDED_PUSH_EVENTS) {
    const fn = (payload: unknown) => {
      // Cuando se descarga un gift/emote nuevo, invalidar el LRU cache
      // del image-protocol. Sin esto, si el LRU tenía cacheado el path
      // como null/404 (por intento previo cuando el archivo no existía),
      // el frontend seguía recibiendo el cache stale.
      if (evt === 'gifts:updated' || evt === 'emotes:updated') {
        clearImageCache();
      }
      win?.webContents.send(evt, payload);
      // OS notifications cuando ventana está minimizada/sin foco.
      maybeNotifyPushEvent(evt, payload, win);
    };
    client.on(evt as never, fn as never);
    attachedListeners.push({ event: evt, fn: fn as (...args: unknown[]) => void });
  }
}

export function detachRpcClient(): void {
  if (activeClient) {
    for (const { event, fn } of attachedListeners) {
      activeClient.off(event, fn);
    }
  }
  attachedListeners = [];
  activeClient = null;
}

export function installIpcHandlers(
  getWindow: () => BrowserWindow | null,
  updater: AutoUpdater,
): void {
  ipcMain.handle('rpc:call', async (_evt, method: string, params: unknown) => {
    // CRÍTICO: NO chequear `isConnected` acá. El `client.call()` ya tiene
    // `waitConnected(15s)` internamente que bufferiza RPCs hechos antes
    // de que el sidecar termine su boot (PyInstaller tarda 3-7s).
    //
    // Antes acá había `if (!isConnected) throw 'sidecar not connected'`
    // que rechazaba TODOS los RPCs tempranos del renderer (los hooks
    // useGames, useRules, useTts, useProfiles, etc) → state vacío
    // permanente. El waitConnected del client.call NUNCA se ejecutaba.
    if (!activeClient) {
      // Solo este caso es legítimo: bootSidecar ni siquiera empezó.
      throw new Error('rpc client no inicializado todavía');
    }
    return activeClient.call(method as never, params as never);
  });

  ipcMain.handle('app:get-version', () => {
    // Bug raíz: `npm_package_version` solo existe cuando la app corre
    // bajo `pnpm run`. En el .exe empaquetado ese env no está → caía
    // al fallback "0.0.0". `app.getVersion()` lee el package.json
    // embebido en el asar y funciona TANTO en dev como en prod.
    return { version: app.getVersion() };
  });

  // Abre URL externa en el navegador del usuario. Filtramos http/https
  // por seguridad — no permitimos abrir file:// ni esquemas custom.
  ipcMain.handle('shell:open-external', async (_evt, url: unknown) => {
    if (typeof url !== 'string') return;
    if (!url.startsWith('http://') && !url.startsWith('https://')) return;
    await shell.openExternal(url);
  });

  // Window controls
  ipcMain.handle('window:minimize', () => getWindow()?.minimize());
  ipcMain.handle('window:maximize-toggle', () => {
    const w = getWindow();
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.handle('window:close', () => getWindow()?.close());
  ipcMain.handle('window:is-maximized', () => getWindow()?.isMaximized() ?? false);

  // Updater
  ipcMain.handle('updater:state', () => updater.getState());
  ipcMain.handle('updater:check-now', async () => {
    await updater.checkNow();
    return updater.getState();
  });
  ipcMain.handle('updater:install-and-restart', () => updater.installAndRestart());
  ipcMain.handle('updater:disable', () => updater.disable('user disabled from UI'));
}
