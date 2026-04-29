/**
 * Splash screen del MARU original (G1.4).
 *
 * Réplica fiel de `gui/widgets/splash.py:AnimatedSplashScreen`:
 *   - 380x280 frameless, transparent, alwaysOnTop.
 *   - Container interior #0d0d14 border-radius 16.
 *   - Logo 100x100 + título "MaruLive" 28px weight 600 letter-spacing 2.
 *   - Progress bar 3px gradient horizontal #e74c3c → #9b59b6.
 *   - Avanza 1.5%/25ms (~1.7s hasta 100%) y emite `finished`.
 *
 * El splash se muestra ANTES del MainWindow. La main window arranca
 * con `show:false` y `setOpacity(0)`; cuando el splash termina, hace
 * fade-out y la main window se reveló con opacidad 1.
 *
 * Patrón equivalente al `_warmup_overlays_manager` del original: dejar
 * que Chromium termine de inicializar detrás del splash para evitar
 * el flicker en la primera apertura.
 */

import { BrowserWindow, screen } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const SPLASH_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>MARU Live</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 100%;
    height: 100%;
    background: transparent;
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
    -webkit-app-region: drag;
    font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
  }
  .container {
    width: 100%;
    height: 100%;
    background: #0d0d14;
    border-radius: 16px;
    padding: 50px 40px 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    box-shadow:
      0 0 0 1px rgba(255, 255, 255, 0.04) inset,
      0 24px 80px rgba(0, 0, 0, 0.6);
    position: relative;
    overflow: hidden;
    animation: fadeIn 200ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  /* Glow ambiental sutil detrás del logo (premium polish) */
  .container::before {
    content: '';
    position: absolute;
    inset: -50%;
    background: radial-gradient(
      circle at 50% 30%,
      rgba(243, 156, 18, 0.10) 0%,
      transparent 50%
    );
    pointer-events: none;
  }
  .logo {
    width: 100px;
    height: 100px;
    object-fit: contain;
    filter: drop-shadow(0 8px 24px rgba(0, 0, 0, 0.5));
    z-index: 1;
  }
  .title {
    margin-top: 20px;
    font-size: 28px;
    font-weight: 600;
    color: #ffffff;
    letter-spacing: 2px;
    z-index: 1;
  }
  .subtitle {
    margin-top: 6px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.4);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    z-index: 1;
  }
  .spacer { flex: 1; }
  .progress-bar {
    width: 100%;
    height: 3px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    overflow: hidden;
    z-index: 1;
  }
  .progress-fill {
    height: 100%;
    width: 0%;
    background: linear-gradient(to right, #e74c3c, #9b59b6);
    border-radius: 2px;
    transition: width 25ms linear;
    box-shadow: 0 0 12px rgba(155, 89, 182, 0.5);
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  body.fade-out {
    transition: opacity 250ms cubic-bezier(0.22, 1, 0.36, 1);
    opacity: 0;
  }
</style>
</head>
<body>
  <div class="container">
    <img src="__LOGO__" class="logo" alt="MARU Live" />
    <div class="title">MaruLive</div>
    <div class="subtitle">Chaos Engine</div>
    <div class="spacer"></div>
    <div class="progress-bar">
      <div class="progress-fill" id="fill"></div>
    </div>
  </div>
  <script>
    const fill = document.getElementById('fill');
    let progress = 0;
    const INC = 1.5;
    const interval = setInterval(() => {
      progress = Math.min(100, progress + INC);
      fill.style.width = progress + '%';
      if (progress >= 100) {
        clearInterval(interval);
        // Aviso al main process
        try {
          require('electron').ipcRenderer.send('splash:finished');
        } catch (e) {
          console.error('IPC failed', e);
        }
      }
    }, 25);

    // API simple para fade-out desde main process
    require('electron').ipcRenderer.on('splash:fade-out', () => {
      document.body.classList.add('fade-out');
    });
  </script>
</body>
</html>`;

function resolveLogoPath(): string {
  const candidates = [
    join(__dirname, '../../resources/logo.png'),
    join(process.resourcesPath ?? '', 'logo.png'),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p.replace(/\\/g, '/');
  }
  return '';
}

export class SplashWindow {
  private win: BrowserWindow | null = null;
  private finishedHandlers: Array<() => void> = [];

  /**
   * Muestra el splash centrado en pantalla. Devuelve cuando el splash
   * está listo (DOM ready). El progreso avanza solo dentro del HTML.
   */
  async show(): Promise<void> {
    const display = screen.getPrimaryDisplay();
    const { width: screenW, height: screenH } = display.workAreaSize;

    this.win = new BrowserWindow({
      width: 380,
      height: 280,
      x: Math.round((screenW - 380) / 2),
      y: Math.round((screenH - 280) / 2),
      frame: false,
      transparent: true,
      resizable: false,
      movable: true, // habilitado por -webkit-app-region: drag en CSS
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: true,
      backgroundColor: '#00000000',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
      },
    });

    const { ipcMain } = await import('electron');
    ipcMain.once('splash:finished', () => {
      for (const h of this.finishedHandlers) h();
    });

    const logoPath = resolveLogoPath();
    // El splash se carga via `data:text/html` URL — en ese contexto
    // Chromium NO permite cargar `file:///` por security policy. Por eso
    // el `<img src="file://...">` daba 404. Solución: embeber el logo
    // como base64 data URI dentro del propio HTML.
    let logoUrl = '';
    if (logoPath) {
      try {
        const { readFileSync } = await import('node:fs');
        const buf = readFileSync(logoPath);
        const ext = logoPath.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
        logoUrl = `data:image/${ext};base64,${buf.toString('base64')}`;
      } catch {
        // Fallback: dejar vacío — el splash se ve sin logo pero igual carga.
      }
    }
    const html = SPLASH_HTML.replace('__LOGO__', logoUrl);

    await this.win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );
  }

  /** Registra callback que se dispara cuando el progress llega a 100%. */
  onFinished(cb: () => void): void {
    this.finishedHandlers.push(cb);
  }

  /** Inicia el fade-out (250ms) y cierra la ventana al terminar. */
  async fadeOut(): Promise<void> {
    if (!this.win) return;
    try {
      this.win.webContents.send('splash:fade-out');
    } catch {
      // no-op
    }
    await new Promise((r) => setTimeout(r, 280));
    this.close();
  }

  /** Cierra inmediatamente sin animación. */
  close(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.close();
    }
    this.win = null;
  }
}
