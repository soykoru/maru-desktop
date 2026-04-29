/**
 * Auto-update con electron-updater + GitHub Releases.
 *
 * Flujo:
 *  - En producción (`app.isPackaged`): check inmediato + cada 6h.
 *  - Update detectada → download en background.
 *  - Download terminado → emite `update-ready` al renderer; el usuario
 *    decide cuándo reiniciar (no forzamos).
 *  - `installAndRestart()` aplica la nueva versión.
 *
 * En dev no hace nada — los updates son para builds firmados.
 *
 * Configuración del feed: `electron-builder.yml` → `publish: github`.
 * Para repo privado, requiere `GH_TOKEN` (variable de entorno al hacer
 * release, NO embebido).
 */

import { app, BrowserWindow } from 'electron';
import pkg from 'electron-updater';

const { autoUpdater } = pkg;

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 horas

export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'disabled'; reason: string }
  | { phase: 'checking' }
  | { phase: 'available'; version: string; releaseNotes?: string }
  | { phase: 'not-available'; current: string }
  | {
      phase: 'downloading';
      percent: number;
      transferredBytes: number;
      totalBytes: number;
      bytesPerSecond: number;
    }
  | { phase: 'ready'; version: string }
  | { phase: 'error'; message: string };

export class AutoUpdater {
  private getWindow: () => BrowserWindow | null;
  private state: UpdateState = { phase: 'idle' };
  private timer: NodeJS.Timeout | null = null;
  private enabled = true;
  private subscribers = new Set<(s: UpdateState) => void>();

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow;
  }

  init(): void {
    if (!app.isPackaged) {
      this.setState({ phase: 'disabled', reason: 'dev mode' });
      return;
    }
    if (process.env['MARU_DISABLE_UPDATER'] === '1') {
      this.setState({ phase: 'disabled', reason: 'MARU_DISABLE_UPDATER=1' });
      return;
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    // electron-updater tiene su propio logger; lo silenciamos a INFO
    (autoUpdater as unknown as { logger: unknown }).logger = {
      info: (m: string) => console.log('[updater]', m),
      warn: (m: string) => console.warn('[updater]', m),
      error: (m: string) => console.error('[updater]', m),
      debug: () => {},
    };

    autoUpdater.on('checking-for-update', () => this.setState({ phase: 'checking' }));

    autoUpdater.on('update-available', (info) => {
      this.setState({
        phase: 'available',
        version: info.version,
        releaseNotes:
          typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      });
    });

    autoUpdater.on('update-not-available', () => {
      this.setState({ phase: 'not-available', current: app.getVersion() });
    });

    autoUpdater.on('download-progress', (p) => {
      this.setState({
        phase: 'downloading',
        percent: Math.round(p.percent ?? 0),
        transferredBytes: p.transferred ?? 0,
        totalBytes: p.total ?? 0,
        bytesPerSecond: p.bytesPerSecond ?? 0,
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      this.setState({ phase: 'ready', version: info.version });
    });

    autoUpdater.on('error', (err) => {
      this.setState({ phase: 'error', message: err.message });
    });

    void this.checkNow();
    this.timer = setInterval(() => void this.checkNow(), CHECK_INTERVAL_MS);
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async checkNow(): Promise<void> {
    if (!this.enabled || !app.isPackaged) return;
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      this.setState({ phase: 'error', message: (err as Error).message });
    }
  }

  installAndRestart(): void {
    if (this.state.phase !== 'ready') return;
    autoUpdater.quitAndInstall(false, true);
  }

  disable(reason = 'user disabled'): void {
    this.enabled = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.setState({ phase: 'disabled', reason });
  }

  getState(): UpdateState {
    return this.state;
  }

  subscribe(cb: (s: UpdateState) => void): () => void {
    this.subscribers.add(cb);
    cb(this.state);
    return () => this.subscribers.delete(cb);
  }

  private setState(next: UpdateState): void {
    this.state = next;
    const win = this.getWindow();
    win?.webContents.send('updater:state', next);
    this.subscribers.forEach((s) => {
      try {
        s(next);
      } catch {
        // ignore subscriber errors
      }
    });
  }
}
