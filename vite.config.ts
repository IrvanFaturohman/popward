import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the built dist/ can be served from any sub-folder.
  base: './',
  server: { port: 5173 },
  build: { target: 'es2020', chunkSizeWarningLimit: 800 },
});
