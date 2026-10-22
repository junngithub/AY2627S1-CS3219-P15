import type { FastifyInstance } from 'fastify';
import { creditRoutes } from './credit.routes.js';
import { healthRoutes } from './health.js';
import { internalRoutes } from './internal.routes.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(creditRoutes, { prefix: '/api/v1/credit' });
  await app.register(internalRoutes, { prefix: '/api/v1/credit/internal' });
}
