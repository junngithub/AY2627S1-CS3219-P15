import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { config } from './config.js';
import { registerRoutes } from './routes/index.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger:
      config.nodeEnv === 'development'
        ? { level: config.logLevel, transport: { target: 'pino-pretty' } }
        : { level: config.logLevel },
  });

  // Every error leaves as the team's { error, code } (API contract), not
  // Fastify's default { statusCode, code, error, message }: the frontend shows
  // `error` to the user, and Fastify puts only the status name there.
  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (err.validation) {
      return reply.status(400).send({ error: err.message, code: 'VALIDATION_ERROR' });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      // Details stay in the log; the caller gets nothing internal.
      request.log.error({ err }, 'request failed');
      return reply.status(500).send({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
    return reply.status(status).send({ error: err.message, code: err.code ?? 'ERROR' });
  });

  // Same body as the gateway's 404, so callers see one shape for "no such route".
  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: 'Endpoint not found', code: 'NOT_FOUND' }),
  );

  app.register(registerRoutes);

  return app;
}
