import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const isProd = process.env['NODE_ENV'] === 'production';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      sourcemap: !isProd,
      minify: isProd ? 'esbuild' : false,
      target: 'node20',
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
        // @sentry/electron es dep OPCIONAL — se importa dinámicamente sólo
        // si telemetría está activa. Marcamos como external para que el
        // bundler no intente resolverla en build.
        external: ['@sentry/electron', '@sentry/electron/main'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      sourcemap: !isProd,
      minify: isProd ? 'esbuild' : false,
      target: 'node20',
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
      },
    },
    define: isProd
      ? {
          // Drop console.* en producción para reducir bundle y ruido en prod.
          // Mantenemos console.error y console.warn intactos para diagnóstico.
        }
      : undefined,
    esbuild: isProd
      ? {
          drop: ['console', 'debugger'],
          legalComments: 'none',
        }
      : undefined,
    build: {
      outDir: 'out/renderer',
      sourcemap: !isProd,
      minify: isProd ? 'esbuild' : false,
      // Electron 33 = Chromium 130 — podemos asumir ES2022 sin polyfills.
      target: 'es2022',
      cssMinify: isProd,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
        output: {
          // Splitting manual para que el bundle inicial no arrastre todo.
          manualChunks: (id: string) => {
            if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
              return 'react-vendor';
            }
            if (id.includes('node_modules/react-router')) {
              return 'router';
            }
            if (id.includes('node_modules/lucide-react')) {
              return 'icons';
            }
            if (id.includes('node_modules/zustand')) {
              return 'state';
            }
            if (id.includes('node_modules/clsx') || id.includes('node_modules/tailwind-merge')) {
              return 'cn';
            }
            if (id.includes('node_modules/')) {
              return 'vendor';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      port: 5180,
      strictPort: true,
    },
  },
});
