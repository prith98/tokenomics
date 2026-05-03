import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const PROXY_PATHS = ['/v1', '/costs', '/cache', '/events', '/policy', '/healthz'];

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      PROXY_PATHS.map((p) => [
        p,
        { target: 'http://localhost:8080', changeOrigin: true, ws: false },
      ]),
    ),
  },
});
