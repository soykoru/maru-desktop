/**
 * OS-level notifications — paridad con MARU original.
 *
 * Muestra notificaciones del sistema cuando:
 *   - Llega un gift de TikTok (con nombre + diamantes).
 *   - Nuevo follower / share / superfan.
 *   - Update listo para instalar.
 *
 * Solo dispara la notification si la ventana está minimizada/escondida
 * o sin foco — para no spammear cuando el user está mirando la app.
 */

import { Notification, type BrowserWindow } from 'electron';

interface TikTokEventPayload {
  type: 'gift' | 'like' | 'follow' | 'share' | 'comment' | 'join' | 'command';
  user: string;
  nickname?: string;
  data?: Record<string, unknown>;
}

let attached = false;

function shouldNotify(win: BrowserWindow | null): boolean {
  if (!win || win.isDestroyed()) return false;
  // Notificar solo cuando NO está visible o no tiene foco.
  return !win.isVisible() || !win.isFocused() || win.isMinimized();
}

function safe(s: unknown): string {
  return typeof s === 'string' ? s : '';
}

export function installNotifications(getWindow: () => BrowserWindow | null): void {
  if (attached) return;
  attached = true;

  if (!Notification.isSupported()) {
    console.warn('[notifications] sistema no soporta Notification API');
    return;
  }

  // Hook al RPC client via attachRpcClient — pero como ese forwardea a
  // win.webContents.send, escuchamos directamente al EventBus del cliente
  // RPC. Para simplificar, exponemos una función pública que el ipc.ts
  // puede invocar antes de enviar al renderer.
}

/**
 * Llamado por ipc.ts cuando llega un push event del sidecar.
 * Si la ventana está sin foco y el evento es relevante, dispara una
 * Notification del SO. No bloquea si el user prefiere silencio.
 */
export function maybeNotifyPushEvent(
  channel: string,
  payload: unknown,
  win: BrowserWindow | null,
): void {
  if (!Notification.isSupported()) return;
  if (!shouldNotify(win)) return;

  let title = '';
  let body = '';

  if (channel === 'tiktok:event') {
    const e = payload as TikTokEventPayload;
    const who = e.nickname || e.user || '?';
    // Solo notificar gifts (acción importante con valor económico).
    // Follows / shares NO notifican para evitar spam — ya se ven en
    // el panel de la app cuando el user vuelve. Esto es paridad con
    // el comportamiento del MARU original que solo notificaba en gift.
    if (e.type === 'gift') {
      const data = e.data || {};
      const giftName = safe(data['giftName'] || data['name']) || 'un regalo';
      const count = Number(data['repeatCount'] || data['count'] || 1);
      title = `🎁 ${who}`;
      body = `Envió ${giftName}${count > 1 ? ` x${count}` : ''}`;
    } else {
      return;
    }
  } else if (channel === 'tiktok:status') {
    const s = payload as { connected: boolean; willReconnect?: boolean };
    if (!s.connected && s.willReconnect) {
      title = '⚠️ TikTok desconectado';
      body = 'Reconectando automáticamente…';
    } else {
      return;
    }
  } else if (channel === 'updater:state') {
    const s = payload as { phase: string; version?: string };
    if (s.phase === 'ready' && s.version) {
      title = '✅ Actualización lista';
      body = `MARU v${s.version} se instalará al reiniciar`;
    } else {
      return;
    }
  } else {
    return;
  }

  if (!title) return;

  try {
    const n = new Notification({
      title,
      body,
      silent: false,
      urgency: 'normal',
    });
    n.on('click', () => {
      const w = win;
      if (!w || w.isDestroyed()) return;
      if (w.isMinimized()) w.restore();
      if (!w.isVisible()) w.show();
      w.focus();
    });
    n.show();
  } catch (err) {
    console.warn('[notifications] error mostrando:', err);
  }
}
