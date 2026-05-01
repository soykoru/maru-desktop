import type { StateCreator } from 'zustand';

/**
 * UI slice — estado mínimo de UI global.
 *
 * Tema único `midnight` (decisión Plan G · G1). El selector de tema
 * inventado en F0-F8 quedó eliminado; midnight es el único theme y
 * se aplica via `data-theme="midnight"` en index.html.
 */
export type ThemeId = 'midnight';

/**
 * Modal abierto actualmente (single global modal stack).
 *
 * MARU original abre los diálogos como modales bloqueantes. Replicamos
 * el patrón con un único modal activo a la vez. Las fases G3-G13 van
 * agregando ids a este union.
 */
export type ActiveModal =
  | null
  | 'gifts' // G3
  | 'gift-selector' // G3 (subdiálogo)
  | 'manage-games' // G4
  | 'custom-game' // G4
  | 'edit-predefined' // G4
  | 'new-profile' // G4
  | 'data' // G5
  | 'entity-selector' // G5
  | 'rule' // G6
  | 'social-config' // G7
  | 'ia-config' // G8
  | 'voices' // G9
  | 'sounds' // G10
  | 'profiles' // G10
  | 'simulator' // G11
  | 'backup' // G12
  | 'spotify-config' // G14
  | 'emotes' // Galería de emotes/stickers por streamer
  | 'tiktok-sign-key' // Configurar API key de eulerstream
  | 'tiktok-api-info'; // Diagnóstico TikTok API (status + version + error)

export interface ModalFrame {
  id: Exclude<ActiveModal, null>;
  payload: unknown;
}

export interface UiSlice {
  /** Sidebar tiene estado dummy por ahora; G1 lo deja siempre visible. */
  sidebarCollapsed: boolean;
  /** Tema único — readonly conceptualmente. */
  theme: ThemeId;
  /** Modal en el TOP del stack (null = ninguno). */
  activeModal: ActiveModal;
  /** Payload del modal del top. */
  modalPayload: unknown;
  /** Stack interno — permite abrir gift-selector encima de RuleDialog
   *  sin destruir el dialog padre (paridad MARU `QDialog.exec_()` modal
   *  apilado). Al cerrar el del top, el padre vuelve a ser visible. */
  modalStack: ModalFrame[];

  toggleSidebar: () => void;
  openModal: (id: Exclude<ActiveModal, null>, payload?: unknown) => void;
  closeModal: () => void;
}

export const createUiSlice: StateCreator<UiSlice, [], [], UiSlice> = (set) => ({
  sidebarCollapsed: false,
  theme: 'midnight',
  activeModal: null,
  modalPayload: null,
  modalStack: [],

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  openModal: (id, payload) =>
    set((s) => {
      const frame: ModalFrame = { id, payload: payload ?? null };
      const nextStack = [...s.modalStack, frame];
      return {
        modalStack: nextStack,
        activeModal: frame.id,
        modalPayload: frame.payload,
      };
    }),

  closeModal: () =>
    set((s) => {
      const nextStack = s.modalStack.slice(0, -1);
      const top = nextStack[nextStack.length - 1] ?? null;
      return {
        modalStack: nextStack,
        activeModal: top ? top.id : null,
        modalPayload: top ? top.payload : null,
      };
    }),
});
