/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Health routes, copied from rating-service.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../database/index.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ service: 'badges-service', status: 'ok' as const }));

  app.get('/health/db', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: 'ok' as const, db: 'up' as const };
    } catch (error) {
      app.log.error({ err: error }, 'database health check failed');
      reply.code(503);
      return { status: 'error' as const, db: 'down' as const };
    }
  });
}
