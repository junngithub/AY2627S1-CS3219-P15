/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Generated the profile badges route (API contract GET /api/v1/badges/{userId}).
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { NotFoundError } from '../errors.js';
import { IdentityHeaders, UserBadgesResponse, UserParams } from '../schemas/badges.js';
import { getUserBadges } from '../services/badges.service.js';

// Registered under /api/v1/badges. Identity comes from the gateway's x-user-id
// header (deploy/charts/foc-gateway), which it sets after User Service's authorize check.
export const badgeRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // F4. Badges are private to their owner (team decision 2026-09-21): anyone
  // else gets the same 404 as a route that doesn't exist.
  app.get(
    '/:userId',
    { schema: { headers: IdentityHeaders, params: UserParams, response: { 200: UserBadgesResponse } } },
    async (request) => {
      if (request.headers['x-user-id']?.toLowerCase() !== request.params.userId.toLowerCase()) {
        throw new NotFoundError();
      }
      return getUserBadges(request.params.userId);
    },
  );
};
