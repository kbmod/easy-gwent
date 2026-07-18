import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Dev: browser talks to Vite; WS upgrades proxy to the game server.
      '/': {
        target: 'http://127.0.0.1:8787',
        ws: true,
        bypass: (req) => {
          // Let Vite handle app assets; only proxy bare WS upgrade to the game server.
          if (req.headers.upgrade === 'websocket') return undefined;
          return req.url;
        },
      },
    },
  },
});
