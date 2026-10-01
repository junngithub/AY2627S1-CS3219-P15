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
    { schema: { headers: MeHeaders, response: { 200: BalanceResponse } } },
    async (request) => getBalance(request.headers['x-user-id']),
  );

  app.post(
    '/reserve',
    { schema: { body: ReserveBody, response: { 201: ReserveResponse } } },
    async (request, reply) => {
      reply.code(201);
      return reserveCredits(request.body);
    },
  );

  app.post(
    '/release',
    { schema: { body: ReleaseBody, response: { 200: ReleaseResponse } } },
    async (request) => releaseCredits(request.body.orderId),
  );
};
