/**
 * Puente IPC entre el renderer y el main.
 *
 * - Renderer ↔ sidecar: `rpc:call` invoca `RpcClient.call`.
 * - Renderer ← sidecar: push events forwardeados por canal nombrado
 *   (mismos nombres que en `@maru/shared/rpc/events`).
 * - Renderer ↔ ventana: minimize/maximize/close.
 * - Renderer ↔ updater: state, checkNow, installAndRestart, disable.
 */

import { ipcMain, shell, type BrowserWindow } from 'electron';
import type { RpcClient } from './rpc-client.js';
import type { AutoUpdater } from './auto-updater.js';
import { maybeNotifyPushEvent } from './notifications.js';

let activeClient: RpcClient | null = null;

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
  activeClient = client;
  client.on('connected', () => win?.webContents.send('rpc:connected'));
  client.on('disconnected', () => win?.webContents.send('rpc:disconnected'));
  for (const evt of FORWARDED_PUSH_EVENTS) {
    client.on(evt as never, (payload: unknown) => {
      win?.webContents.send(evt, payload);
      // OS notifications cuando ventana está minimizada/sin foco.
      maybeNotifyPushEvent(evt, payload, win);
    });
  }
}

export function detachRpcClient(): void {
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
    const win = getWindow();
    return win ? { version: process.env['npm_package_version'] ?? '0.0.0' } : null;
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
