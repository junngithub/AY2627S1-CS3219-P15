/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Test helpers: message builders and badge lookups.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../src/database/index.js';
import { userBadge, userMetrics } from '../src/database/schema.js';

export { db };
export { countedOrder, disputedOrder, jobRun, userBadge, userMetrics } from '../src/database/schema.js';

// An order.status.changed message as Order Service publishes it.
export function orderMessage(overrides: Record<string, unknown> = {}) {
  return {
    eventId: randomUUID(),
    eventType: 'order.status.changed',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    orderId: randomUUID(),
    requesterId: randomUUID(),
    courierId: randomUUID(),
    fromStatus: 'COLLECTED',
    toStatus: 'DELIVERED',
    notifyRequester: true,
    ...overrides,
  };
}

// A user.rating.updated message as Rating Service publishes it.
export function ratingMessage(overrides: Record<string, unknown> = {}) {
  return {
    eventId: randomUUID(),
    eventType: 'user.rating.updated',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    userId: randomUUID(),
    newAverage: 4.8,
    totalRatings: 10,
    ...overrides,
  };
}

export async function badgeState(userId: string, badgeId: string) {
  const [row] = await db
    .select()
    .from(userBadge)
    .where(and(eq(userBadge.userId, userId), eq(userBadge.badgeId, badgeId)));
  return row?.state ?? null;
}

export async function metricsOf(userId: string) {
  const [row] = await db.select().from(userMetrics).where(eq(userMetrics.userId, userId));
  return row;
}
