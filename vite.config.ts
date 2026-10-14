import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  build: { outDir: '../../dist/client', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
});
