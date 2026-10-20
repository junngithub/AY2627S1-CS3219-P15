import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  BalanceResponse,
  MeHeaders,
  ReleaseBody,
  ReleaseResponse,
  ReserveBody,
  ReserveResponse,
} from '../schemas/credit.js';
import { getBalance, releaseCredits, reserveCredits } from '../services/credit.service.js';

// Registered under /api/v1/credit; request/response types inferred from schemas.
export const creditRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // Identity from the x-user-id header — stand-in until auth (JWT / gateway).
  app.get(
    '/me/balance',
    {
      schema: {
        tags: ['credit'],
        summary: 'Get the caller’s credit balance',
        description: 'Returns the balance for the user in the x-user-id header.',
        headers: MeHeaders,
        response: { 200: BalanceResponse },
      },
    },
    async (request) => getBalance(request.headers['x-user-id']),
  );

  app.post(
    '/reserve',
    {
      schema: {
        tags: ['credit'],
        summary: 'Reserve credits for an order',
        description: 'Deducts and holds credits for an order; idempotent per orderId.',
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
        description: 'Refunds the held credits for an order and removes the reservation.',
        body: ReleaseBody,
        response: { 200: ReleaseResponse },
      },
    },
    async (request) => releaseCredits(request.body.orderId),
  );
};
