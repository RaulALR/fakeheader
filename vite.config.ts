import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { extensionManifest } from './src/manifest';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'fakeheader-manifest',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'manifest.json',
          source: JSON.stringify(extensionManifest, null, 2),
        });
      },
    },
  ],
  build: {
    modulePreload: { polyfill: false },
    sourcemap: false,
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(fileURLToPath(new URL('.', import.meta.url)), 'popup.html'),
        options: resolve(fileURLToPath(new URL('.', import.meta.url)), 'options.html'),
        background: resolve(
          fileURLToPath(new URL('.', import.meta.url)),
          'src/background/service-worker.ts',
        ),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'service-worker.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
