/**
 * Preload script — expone una API segura al renderer (contextBridge).
 * El renderer NO accede a Node ni a WebSocket; usa `window.maruApi`.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { RpcMethodName, RpcParams, RpcResult, RpcPushEventName } from '@maru/shared';
import type { UpdateState } from '../main/auto-updater.js';

const ALLOWED_CHANNELS = new Set<string>([
  'sidecar:ready',
  'sidecar:log',
  'rpc:connected',
  'rpc:disconnected',
  'tiktok:status',
  'tiktok:event',
  'tiktok:stats',
  'tiktok:error',
  'rules:fired',
  'rules:executed',
  'tiktok:log',
  'tiktok:comment-enriched',
  'gifts:updated',
  'emotes:updated',
  'spotify:status', // G14
  'spotify:now-playing',
  'spotify:queue',
  'social:update',
  'log:entry', // G11
  'window:state',
  'updater:state',
]);

const api = {
  rpc: {
    call<M extends RpcMethodName>(method: M, params: RpcParams<M>): Promise<RpcResult<M>> {
      return ipcRenderer.invoke('rpc:call', method, params) as Promise<RpcResult<M>>;
    },
  },
  on(
    channel: RpcPushEventName | 'rpc:connected' | 'rpc:disconnected' | 'updater:state' | 'window:state',
    cb: (payload: unknown) => void,
  ): () => void {
    if (!ALLOWED_CHANNELS.has(channel)) {
      console.warn('[preload] canal no permitido:', channel);
      return () => {};
    }
    const listener = (_evt: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  },
  app: {
    getVersion(): Promise<{ version: string }> {
      return ipcRenderer.invoke('app:get-version');
    },
  },
  shell: {
    openExternal(url: string): Promise<void> {
      return ipcRenderer.invoke('shell:open-external', url);
    },
  },
  clipboard: {
    /** Escribe `text` al clipboard del SO usando la API nativa del
     * main (más confiable que navigator.clipboard en Electron, que
     * puede silenciar fallar sin foco). */
    write(text: string): Promise<boolean> {
      return ipcRenderer.invoke('clipboard:write', text);
    },
  },
  /**
   * Devuelve el path absoluto en disco de un `File` seleccionado por
   * el user (`<input type="file">` o drag-and-drop).
   *
   * En Electron 32+ la propiedad `File.path` fue removida por seguridad;
   * el reemplazo oficial es `webUtils.getPathForFile(file)` (solo
   * disponible en preload). Sin esto, los diálogos de "Asignar sonido" /
   * "Agregar a librería" recibían `undefined` y silenciosamente no
   * hacían nada.
   */
  getPathForFile(file: File): string {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  window: {
    minimize(): Promise<void> {
      return ipcRenderer.invoke('window:minimize');
    },
    maximizeToggle(): Promise<void> {
      return ipcRenderer.invoke('window:maximize-toggle');
    },
    close(): Promise<void> {
      return ipcRenderer.invoke('window:close');
    },
    isMaximized(): Promise<boolean> {
      return ipcRenderer.invoke('window:is-maximized');
    },
  },
  updater: {
    getState(): Promise<UpdateState> {
      return ipcRenderer.invoke('updater:state');
    },
    checkNow(): Promise<UpdateState> {
      return ipcRenderer.invoke('updater:check-now');
    },
    installAndRestart(): Promise<void> {
      return ipcRenderer.invoke('updater:install-and-restart');
    },
    disable(): Promise<void> {
      return ipcRenderer.invoke('updater:disable');
    },
  },
};

contextBridge.exposeInMainWorld('maruApi', api);

export type MaruApi = typeof api;
