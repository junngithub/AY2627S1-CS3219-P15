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

  app.register(registerRoutes);

  return app;
}
