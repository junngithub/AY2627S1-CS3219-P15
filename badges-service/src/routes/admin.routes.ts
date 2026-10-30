/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Generated the admin-only manual run and run list (replacing the scaffold's
 *        shared-token /internal routes).
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Value } from '@sinclair/typebox/value';
import type { FastifyRequest } from 'fastify';
import { NotFoundError } from '../errors.js';
import { executeRun, listRuns, startRun } from '../jobs/evaluationRun.js';
import { IdentityHeaders, JobRunsResponse, StartRunResponse, Uuid } from '../schemas/badges.js';

// The gateway sets x-is-admin from User Service's authorize answer and strips any
// client-supplied copy. Non-admins get 404, not 403, so the routes don't appear
// to exist (Admin F2.2.1). Returns the admin's user ID.
function requireAdmin(request: FastifyRequest): string {
  const headers = request.headers as IdentityHeaders;
  const userId = headers['x-user-id'];
  if (headers['x-is-admin'] !== 'true' || userId === undefined || !Value.Check(Uuid, userId)) {
    throw new NotFoundError();
  }
  return userId;
}

// Registered under /api/v1/badges/admin.
export const adminRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // Manual trigger (team decision 2026-10-30: an admin route, with a button on
  // the admin dashboard). A full run can take minutes, so it starts in the
  // background and GET /jobs shows how it went.
  app.post(
    '/evaluate',
    { schema: { headers: IdentityHeaders, response: { 202: StartRunResponse } } },
    async (request, reply) => {
      const adminId = requireAdmin(request);
      const runId = await startRun('manual', adminId);
      void executeRun(runId, 'manual').then(
        (summary) => request.log.info({ summary }, 'manual badge run finished'),
        (error: unknown) => request.log.error({ err: error, runId }, 'manual badge run failed'),
      );
      reply.code(202);
      return { runId, status: 'running' as const };
    },
  );

  app.get(
    '/jobs',
    { schema: { headers: IdentityHeaders, response: { 200: JobRunsResponse } } },
    async (request) => {
      requireAdmin(request);
      return { runs: await listRuns() };
    },
  );
};
