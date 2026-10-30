/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Route registration, in rating-service's layout.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import type { FastifyInstance } from 'fastify';
import { adminRoutes } from './admin.routes.js';
import { badgeRoutes } from './badges.routes.js';
import { healthRoutes } from './health.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  // The static /admin prefix is matched before /api/v1/badges/:userId.
  await app.register(adminRoutes, { prefix: '/api/v1/badges/admin' });
  await app.register(badgeRoutes, { prefix: '/api/v1/badges' });
}
