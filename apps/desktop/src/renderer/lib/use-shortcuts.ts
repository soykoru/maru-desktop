/**
 * `useGlobalShortcuts` — atajos de teclado globales (paridad MARU original).
 *
 * Atajos:
 *   - Ctrl+T          → Conectar/Desconectar TikTok
 *   - F5              → Probar conexión con el juego activo
 *   - Ctrl+Shift+S    → Abrir Simulador
 *   - Ctrl+,          → Abrir Configuración (manage-games)
 *   - Esc             → Cerrar modal activo
 *   - Ctrl+L          → Foco al input de búsqueda de log (si visible)
 *
 * Los atajos se ignoran cuando el foco está en un input/textarea para no
 * interferir con la escritura natural — excepto Esc que siempre funciona.
 */

import { useEffect } from 'react';
import { useAppStore } from './store/index.js';
import { rpcCall } from './rpc.js';

function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  return false;
}

export function useGlobalShortcuts(): void {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const store = useAppStore.getState();

      // Esc → cerrar modal (siempre, incluso desde inputs).
      if (e.key === 'Escape') {
        if (store.activeModal !== null) {
          store.closeModal();
          e.preventDefault();
          return;
        }
      }

      // Resto de atajos: ignorar si el user está tipeando.
      if (isTypingTarget(e)) return;

      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const k = e.key.toLowerCase();

      // Ctrl+T → toggle TikTok connect.
      if (ctrl && !shift && k === 't') {
        e.preventDefault();
        const connected = store.tiktokStatus === 'connected';
        const username = store.tiktokUsername;
        if (connected) {
          void rpcCall('tiktok.disconnect', {}).catch(() => undefined);
          store.setTikTokStatus('disconnected');
        } else if (username) {
          store.setTikTokStatus('connecting', username);
          void rpcCall('tiktok.connect', { username }).catch(() => {
            store.setTikTokStatus('disconnected');
          });
        } else {
          store.setTikTokError(
            'Escribí tu usuario de TikTok primero (sidebar)',
          );
        }
        return;
      }

      // F5 → probar conexión con el juego activo.
      if (e.key === 'F5') {
        e.preventDefault();
        const gid = store.selectedGameId;
        if (gid) {
          void rpcCall('games.test', { gameId: gid }).catch(() => undefined);
        }
        return;
      }

      // Ctrl+Shift+S → abrir simulador.
      if (ctrl && shift && k === 's') {
        e.preventDefault();
        store.openModal('simulator');
        return;
      }

      // Ctrl+, → abrir configuración de juegos (paridad ⚙️ MARU).
      if (ctrl && !shift && k === ',') {
        e.preventDefault();
        store.openModal('manage-games');
        return;
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
