/**
 * Hooks de optimización de runtime.
 *
 * - `useDocumentVisible`: pausa polling cuando la ventana no está activa.
 * - `usePollingInterval`: setInterval que respeta visibility + cleanup correcto.
 */

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from './store/index.js';
import type { ActiveModal } from './store/ui-slice.js';

/**
 * Devuelve `{open, payload}` para un modal específico, considerando el
 * STACK completo (no solo el top). Permite que un modal "padre" (ej:
 * RuleDialog) siga renderizándose cuando hay un modal hijo encima
 * (gift-selector, entity-selector). Sin esto, abrir la galería desde
 * el editor de regla cerraba ambos.
 */
export function useModalState(id: Exclude<ActiveModal, null>): {
  open: boolean;
  payload: unknown;
} {
  const open = useAppStore((s) =>
    s.modalStack.some((f) => f.id === id),
  );
  const payload = useAppStore(
    (s) => s.modalStack.find((f) => f.id === id)?.payload ?? null,
  );
  return { open, payload };
}

export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden,
  );
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
    };
  }, []);
  return visible;
}

/**
 * Polling con auto-pausa cuando la pestaña/ventana no está visible.
 *
 * - Llama `tick()` inmediatamente al montar.
 * - Repite cada `intervalMs` mientras visible.
 * - Cuando la ventana se oculta, detiene el timer; al volver, dispara
 *   un tick de catch-up y vuelve al ciclo normal.
 */
export function usePollingInterval(tick: () => void | Promise<void>, intervalMs: number): void {
  const tickRef = useRef(tick);
  tickRef.current = tick;
  const visible = useDocumentVisible();

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const run = async () => {
      if (!alive) return;
      try {
        await tickRef.current();
      } catch {
        // silenciar errores transitorios — el componente decide qué hacer
      }
    };
    void run();
    const id = window.setInterval(() => void run(), intervalMs);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [visible, intervalMs]);
}
