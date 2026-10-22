import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ReleaseBody, ReleaseResponse, ReserveBody, ReserveResponse } from '../schemas/credit.js';
import { releaseCredits, reserveCredits } from '../services/credit.service.js';

// Order's calls. The body names the user, so these must never be reachable by
// clients: registered under /api/v1/credit/internal, which the gateway blocks
// and Linkerd only lets order call (ADR-0012).
export const internalRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/reserve',
    {
      schema: {
        tags: ['credit'],
        summary: 'Reserve credits for an order',
        description:
          'Internal: called by Order Service only. Deducts and holds credits for an order; idempotent per orderId.',
        body: ReserveBody,
        response: { 201: ReserveResponse },
      },
    },
    async (request, reply) => {
      reply.code(201);
      return reserveCredits(request.body);
    },
  );

  app.post(
    '/release',
    {
      schema: {
        tags: ['credit'],
        summary: 'Release an order’s reservation',
        description:
          'Internal: called by Order Service only. Refunds the held credits for an order and removes the reservation.',
        body: ReleaseBody,
        response: { 200: ReleaseResponse },
      },
    },
    async (request) => releaseCredits(request.body.orderId),
  );
};
