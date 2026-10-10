import type { FastifyInstance } from 'fastify';
import { creditRoutes } from './credit.routes.js';
import { healthRoutes } from './health.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(creditRoutes, { prefix: '/api/v1/credit' });
}
