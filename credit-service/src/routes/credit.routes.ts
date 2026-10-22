import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { BalanceResponse, MeHeaders } from '../schemas/credit.js';
import { getBalance } from '../services/credit.service.js';

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
};
