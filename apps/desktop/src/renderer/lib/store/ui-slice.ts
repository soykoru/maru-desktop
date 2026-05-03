import type { StateCreator } from 'zustand';

/**
 * UI slice — estado mínimo de UI global.
 *
 * Tema visual del usuario. Default `midnight` (signature MARU). El tema
 * se aplica via `data-theme="..."` en <html> y persiste en settings.
 * Cambiar el tema NO toca lógica del sidecar — solo tokens CSS via
 * `packages/ui/styles/globals.css`.
 */
export type ThemeId =
  | 'midnight'
  | 'dracula'
  | 'tokyo-night'
  | 'catppuccin-mocha'
  | 'pure-dark'
  | 'nord';

export const THEME_LIST: { id: ThemeId; label: string; emoji: string; description: string }[] = [
  { id: 'midnight',         label: 'Midnight',         emoji: '🌙', description: 'Naranja-mostaza signature MARU' },
  { id: 'dracula',          label: 'Dracula',          emoji: '🦇', description: 'Púrpura/rosa, popular en dev community' },
  { id: 'tokyo-night',      label: 'Tokyo Night',      emoji: '🗼', description: 'Azul-violeta noche, premium VSCode' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', emoji: '🍮', description: 'Pastel mocha, suave y elegante' },
  { id: 'pure-dark',        label: 'Pure Dark',        emoji: '⚫', description: 'Negro absoluto premium, máximo contraste' },
  { id: 'nord',             label: 'Nord',             emoji: '❄️', description: 'Frost ártico, popular dev community' },
];

/**
 * Modal abierto actualmente (single global modal stack).
 */
export type ActiveModal =
  | null
  | 'gifts'
  | 'gift-selector'
  | 'manage-games'
  | 'custom-game'
  | 'edit-predefined'
  | 'new-profile'
  | 'data'
  | 'entity-selector'
  | 'rule'
  | 'social-config'
  | 'ia-config'
  | 'voices'
  | 'sounds'
  | 'profiles'
  | 'simulator'
  | 'backup'
  | 'spotify-config'
  | 'emotes'
  | 'tiktok-sign-key'
  | 'tiktok-api-info';

export interface ModalFrame {
  id: Exclude<ActiveModal, null>;
  payload: unknown;
}

export interface UiSlice {
  /** Sidebar tiene estado dummy por ahora; G1 lo deja siempre visible. */
  sidebarCollapsed: boolean;
  /** Tema visual activo. Persiste vía settings. */
  theme: ThemeId;
  /** Modal en el TOP del stack (null = ninguno). */
  activeModal: ActiveModal;
  /** Payload del modal del top. */
  modalPayload: unknown;
  /** Stack interno — permite abrir gift-selector encima de RuleDialog. */
  modalStack: ModalFrame[];

  toggleSidebar: () => void;
  setTheme: (theme: ThemeId) => void;
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

  setTheme: (theme) => {
    // Aplicar al DOM inmediatamente (sin esperar persistencia)
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
    set({ theme });
  },

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
