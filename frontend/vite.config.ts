// AI Assistance Disclosure
// Tool: Claude Code (Claude Opus 5), date: 2026-09-23
// Scope: Generated Vite configuration and the dev-server proxy that mirrors
//        the nginx one, so the app runs against the same paths in both.
// Reviewed by Ngooi Jun Sen.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backends run on the host during development. In the container they are
// reached by service name instead; see frontend/nginx.conf.
const SUPPLIER_SERVICE = 'http://localhost:8081';
const BADGES_SERVICE = 'http://localhost:4006';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same one-origin arrangement as nginx: the app only ever calls its own
    // origin, so there is no cross-origin request and no service needs CORS.
    proxy: {
      // Supplier Service already serves this prefix, so nothing is rewritten.
      '/api/v1/supplier': {
        target: SUPPLIER_SERVICE,
        changeOrigin: true,
      },
      // Badges Service serves the contract's base path directly.
      '/api/v1/badges': {
        target: BADGES_SERVICE,
        changeOrigin: true,
      },
    },
  },
});
