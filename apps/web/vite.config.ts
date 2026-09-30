// ============================================================
// vite.config.ts — конфигурация Vite для SPA
// HMR работает напрямую на 5173, минуя nginx.
// ============================================================

import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const PROXY_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://api:3000';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
    cssCodeSplit: true,
    assetsInlineLimit: 4096,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // HMR напрямую на 5173, не через nginx.
    // При доступе к приложению через https://localhost страница
    // открывается на 443, но HMR-сокет идёт на ws://localhost:5173.
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      clientPort: 5173,
    },
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      'ulybka-web',
    ],
    watch: {
      usePolling: true,
      interval: 300,
    },
    proxy: {
      '/api': {
        target: PROXY_TARGET,
        changeOrigin: true,
        secure: false,
      },
      '/ws': {
        target: PROXY_TARGET,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
  },
  esbuild: {
    legalComments: 'none',
  },
});