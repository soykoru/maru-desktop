/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('@maru/ui/tailwind-preset')],
  content: [
    './src/renderer/index.html',
    './src/renderer/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
};
