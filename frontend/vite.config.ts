// AI Assistance Disclosure
// Tool: Claude Code (Claude Opus 5), date: 2026-09-23
// Scope: Generated Vite configuration and the dev-server proxy that mirrors
//        the nginx one, so the app runs against the same paths in both.
// Reviewed by Ngooi Jun Sen.

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Backends run on the host during development. In the container they are
// reached by service name instead; see frontend/nginx.conf.
const SUPPLIER_SERVICE = 'http://localhost:8081';
const BADGES_SERVICE = 'http://localhost:4006';

export default defineConfig(({ mode }) => {
  // TODO(team): no port is agreed for the User or Admin Service yet. These
  // defaults are placeholders; override them in frontend/.env.local once the
  // services pick one, and update nginx.conf to match.
  const env = loadEnv(mode, '.', '');
  const userService = env.USER_SERVICE_URL || 'http://localhost:8082';
  const adminService = env.ADMIN_SERVICE_URL || 'http://localhost:8083';

  return {
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
        // Every path below assumes the service serves the contract's base
        // path unchanged, as Supplier and Badges do.
        '/api/v1/user': {
          target: userService,
          changeOrigin: true,
        },
        '/api/v1/admin': {
          target: adminService,
          changeOrigin: true,
        },
      },
    },
  };
});
