import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS is mandatory for WebXR on Meta Quest (except on localhost).
// basicSsl generates a self-signed certificate; `host: true` exposes the
// server on the local network so the headset can reach it.
export default defineConfig({
  base: './',
  plugins: [basicSsl()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
