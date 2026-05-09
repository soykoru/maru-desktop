/**
 * Puente IPC entre el renderer y el main.
 *
 * - Renderer ↔ sidecar: `rpc:call` invoca `RpcClient.call`.
 * - Renderer ← sidecar: push events forwardeados por canal nombrado
 *   (mismos nombres que en `@maru/shared/rpc/events`).
 * - Renderer ↔ ventana: minimize/maximize/close.
 * - Renderer ↔ updater: state, checkNow, installAndRestart, disable.
 */

import { app, clipboard, dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
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
  'social:user-updated', // v1.0.90+ refresh single user (ej. perdió SuperFan)
  'profiles:loaded', // v1.0.91+ perfil restaurado → invalidar caches
  'log:entry', // G11
  'log:entry:updated', // v1.1.3 — promote-to-bottom de entries dedupadas
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

  // Quit real: el botón "X" de la ventana esconde al tray (paridad MARU
  // original); este endpoint expone la salida explícita para un botón
  // de la UI del header. Dispara `before-quit` → drena sidecar/RPC
  // limpiamente antes de exit. Sin esto el renderer no tenía forma de
  // pedir un quit completo (terminaba sólo via tray > Salir).
  ipcMain.handle('app:quit', () => {
    app.quit();
  });

  // Updater
  ipcMain.handle('updater:state', () => updater.getState());
  ipcMain.handle('updater:check-now', async () => {
    await updater.checkNow();
    return updater.getState();
  });
  ipcMain.handle('updater:install-and-restart', () => updater.installAndRestart());
  ipcMain.handle('updater:disable', () => updater.disable('user disabled from UI'));

  // Clipboard write — `navigator.clipboard.writeText` en el renderer
  // de Electron falla silenciosamente cuando la ventana no está
  // estrictamente focused o si la sesión no tiene permission para
  // ClipboardWrite (default false). El IPC al main usa la API nativa
  // `clipboard.writeText` que SIEMPRE funciona desde main process.
  ipcMain.handle('clipboard:write', (_evt, text: unknown) => {
    if (typeof text !== 'string' || !text) return false;
    try {
      clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  });

  // v1.0.71: descarga de archivo de texto via save dialog nativo del SO.
  // Usado por la UI para descargar la documentación de juegos como .md.
  ipcMain.handle(
    'dialog:save-text',
    async (
      _evt,
      payload: unknown,
    ): Promise<{ ok: boolean; path?: string; error?: string }> => {
      if (
        !payload ||
        typeof payload !== 'object' ||
        typeof (payload as { content?: unknown }).content !== 'string'
      ) {
        return { ok: false, error: 'payload inválido' };
      }
      const p = payload as { content: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> };
      const win = getWindow();
      try {
        const result = await (win
          ? dialog.showSaveDialog(win, {
              defaultPath: p.defaultPath ?? 'archivo.txt',
              filters: p.filters ?? [{ name: 'Markdown', extensions: ['md'] }, { name: 'Todos', extensions: ['*'] }],
            })
          : dialog.showSaveDialog({
              defaultPath: p.defaultPath ?? 'archivo.txt',
              filters: p.filters ?? [{ name: 'Markdown', extensions: ['md'] }, { name: 'Todos', extensions: ['*'] }],
            }));
        if (result.canceled || !result.filePath) return { ok: false };
        await writeFile(result.filePath, p.content, { encoding: 'utf-8' });
        return { ok: true, path: result.filePath };
      } catch (exc) {
        return { ok: false, error: exc instanceof Error ? exc.message : String(exc) };
      }
    },
  );

  // v1.0.74: file picker para abrir un archivo (imagen). El renderer lo
  // usa en el CustomGameDialog para que el user elija portada del disco.
  // Devuelve el path absoluto seleccionado o cancelled=true.
  ipcMain.handle(
    'dialog:open-file',
    async (
      _evt,
      payload: unknown,
    ): Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }> => {
      const p = (payload && typeof payload === 'object' ? payload : {}) as {
        title?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
      };
      const win = getWindow();
      try {
        const opts: Electron.OpenDialogOptions = {
          title: p.title ?? 'Seleccionar archivo',
          filters: p.filters ?? [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
          properties: ['openFile'],
        };
        const result = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts));
        if (result.canceled || result.filePaths.length === 0) {
          return { ok: false, cancelled: true };
        }
        return { ok: true, path: result.filePaths[0] };
      } catch (exc) {
        return { ok: false, error: exc instanceof Error ? exc.message : String(exc) };
      }
    },
  );
}
