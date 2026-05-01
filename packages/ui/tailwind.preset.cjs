/**
 * Preset Tailwind para MARU Live Desktop.
 *
 * Tokens en CSS vars (ver `styles/globals.css`).
 * Tema único: `midnight` — paleta exacta del MARU original.
 *
 * Convención: nombres semánticos + scale numerada para los accent
 * variants (accent-blue, accent-green, etc.) que existen en MARU.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          base: 'rgb(var(--maru-bg-base) / <alpha-value>)',
          surface: 'rgb(var(--maru-bg-surface) / <alpha-value>)',
          elevated: 'rgb(var(--maru-bg-elevated) / <alpha-value>)',
          overlay: 'rgb(var(--maru-bg-overlay) / <alpha-value>)',
        },
        fg: {
          DEFAULT: 'rgb(var(--maru-fg) / <alpha-value>)',
          muted: 'rgb(var(--maru-fg-muted) / <alpha-value>)',
          subtle: 'rgb(var(--maru-fg-subtle) / <alpha-value>)',
          hint: 'rgb(var(--maru-fg-hint) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--maru-accent) / <alpha-value>)',
          hover: 'rgb(var(--maru-accent-hover) / <alpha-value>)',
          blue: 'rgb(var(--maru-accent-blue) / <alpha-value>)',
          green: 'rgb(var(--maru-accent-green) / <alpha-value>)',
          'green-light':
            'rgb(var(--maru-accent-green-light) / <alpha-value>)',
          red: 'rgb(var(--maru-accent-red) / <alpha-value>)',
          'red-dark':
            'rgb(var(--maru-accent-red-dark) / <alpha-value>)',
          purple: 'rgb(var(--maru-accent-purple) / <alpha-value>)',
        },
        // Midnight QSS palette del MARU original
        mn: {
          button: 'rgb(var(--maru-mn-button) / <alpha-value>)',
          'button-end':
            'rgb(var(--maru-mn-button-end) / <alpha-value>)',
          'button-hover':
            'rgb(var(--maru-mn-button-hover) / <alpha-value>)',
          cyan: 'rgb(var(--maru-mn-cyan) / <alpha-value>)',
          card: 'rgb(var(--maru-mn-card) / <alpha-value>)',
          input: 'rgb(var(--maru-mn-input) / <alpha-value>)',
          'input-border':
            'rgb(var(--maru-mn-input-border) / <alpha-value>)',
        },
        success: 'rgb(var(--maru-success) / <alpha-value>)',
        warning: 'rgb(var(--maru-warning) / <alpha-value>)',
        danger: 'rgb(var(--maru-danger) / <alpha-value>)',
        info: 'rgb(var(--maru-info) / <alpha-value>)',
        border: {
          DEFAULT: 'rgb(var(--maru-border) / <alpha-value>)',
          strong: 'rgb(var(--maru-border-strong) / <alpha-value>)',
          subtle: 'rgb(var(--maru-border-subtle) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: [
          'Geist',
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'Consolas',
          'Courier New',
          'monospace',
        ],
        emoji: [
          'Segoe UI Emoji',
          'Apple Color Emoji',
          'Noto Color Emoji',
          'sans-serif',
        ],
      },
      borderRadius: {
        sm: 'var(--maru-radius-sm)',
        md: 'var(--maru-radius-md)',
        lg: 'var(--maru-radius-lg)',
        xl: 'var(--maru-radius-xl)',
        '2xl': 'var(--maru-radius-2xl)',
      },
      boxShadow: {
        'elev-1': 'var(--maru-elev-1)',
        'elev-2': 'var(--maru-elev-2)',
        'elev-3': 'var(--maru-elev-3)',
        'elev-4': 'var(--maru-elev-4)',
        'elev-5': 'var(--maru-elev-5)',
        sm: 'var(--maru-shadow-sm)',
        md: 'var(--maru-shadow-md)',
        lg: 'var(--maru-shadow-lg)',
        glow: 'var(--maru-glow-accent)',
        'glow-blue': 'var(--maru-glow-blue)',
        'glow-green': 'var(--maru-glow-green)',
        'inset-top': 'var(--maru-inset-top)',
        'inset-top-strong': 'var(--maru-inset-top-strong)',
      },
      transitionTimingFunction: {
        maru: 'var(--maru-ease)',
        spring: 'var(--maru-ease-spring)',
      },
      transitionDuration: {
        fast: 'var(--maru-dur-fast)',
        base: 'var(--maru-dur-base)',
        slow: 'var(--maru-dur-slow)',
      },
      zIndex: {
        sticky: 'var(--maru-z-sticky)',
        dropdown: 'var(--maru-z-dropdown)',
        'modal-backdrop': 'var(--maru-z-modal-backdrop)',
        modal: 'var(--maru-z-modal)',
        toast: 'var(--maru-z-toast)',
        splash: 'var(--maru-z-splash)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down': {
          from: { opacity: '0', transform: 'translateY(-12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '0.5' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'fade-in':
          'fade-in var(--maru-dur-base) var(--maru-ease)',
        'slide-up':
          'slide-up 240ms var(--maru-ease)',
        'slide-down':
          'slide-down var(--maru-dur-base) var(--maru-ease)',
        'scale-in':
          'scale-in 160ms var(--maru-ease)',
        shimmer: 'shimmer 1.6s infinite',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
