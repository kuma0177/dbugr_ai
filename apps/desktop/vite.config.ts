import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import pkg from './package.json';

export default defineConfig({
  define: {
    __DEBUGR_BUILD_STAMP__: JSON.stringify(
      `${pkg.version} · ${new Date().toISOString().slice(0, -1)}`
    ),
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: [resolve(__dirname, '../..')],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        overlay: resolve(__dirname, 'overlay.html'),
      },
    },
  },
});
