import type { FastifyInstance } from 'fastify';
import { healthRoutes } from './health.js';
import { ratingRoutes } from './rating.routes.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(ratingRoutes, { prefix: '/api/v1/rating' });
}
