import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  plugins: [svelte()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000,
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    allowedHosts: ['.local', '.ts.net'],
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:4100', ws: true, xfwd: true },
    },
  },
});
