import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { devApi } from './devApi.js';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => ({
  root: here,
  plugins: [react(), devApi(mode, resolve(here, '..'))],
  server: { fs: { allow: [resolve(here, '..')] } },
  build: { outDir: resolve(here, '../dist'), emptyOutDir: true, chunkSizeWarningLimit: 800 },
}));
