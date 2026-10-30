/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Generated the domain errors, in rating-service's @fastify/error style.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import createError from '@fastify/error';

// Domain errors (@fastify/error): stable code + message template + HTTP status.
// The error handler in app.ts sends them as { error: message, code }.

// Badges are private to their owner, and the admin routes are hidden from
// non-admins (Admin F2.2.1), so both answer with the gateway's own 404.
export const NotFoundError = createError('NOT_FOUND', 'Endpoint not found', 404);

export const RunInProgressError = createError(
  'RUN_IN_PROGRESS',
  'A badge run is already in progress',
  409,
);
