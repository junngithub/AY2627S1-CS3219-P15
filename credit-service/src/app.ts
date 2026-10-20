import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { config } from './config.js';
import { registerRoutes } from './routes/index.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger:
      config.nodeEnv === 'development'
        ? { level: config.logLevel, transport: { target: 'pino-pretty' } }
        : { level: config.logLevel },
  });

  // OpenAPI: the plugin reads each route's TypeBox schema, so it must load
  // before the routes. Spec served at /docs/json, Swagger UI at /docs.
  app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'FoC Credit Service API',
        description: 'Closed credit economy for Friends on Campus (FoC).',
        version: '0.1.0',
      },
      tags: [
        { name: 'credit', description: 'Credit balances, reservations and releases' },
        { name: 'health', description: 'Liveness and database readiness' },
      ],
    },
  });
  app.register(fastifySwaggerUi, { routePrefix: '/docs' });

  app.register(registerRoutes);

  return app;
}
