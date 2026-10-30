import { randomUUID } from 'node:crypto';
import { db } from '../src/database/index.js';
import { ratingGrant } from '../src/database/schema.js';

export { db };
export { outbox, rating, ratingGrant, userRating } from '../src/database/schema.js';

type Role = 'COURIER' | 'REQUESTER';

// A rating.permission.granted message as Order Service publishes it.
export function grantMessage(overrides: Record<string, unknown> = {}) {
  return {
    eventId: randomUUID(),
    eventType: 'rating.permission.granted',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    orderId: randomUUID(),
    raterId: randomUUID(),
    raterRole: 'COURIER',
    rateeId: randomUUID(),
    rateeRole: 'REQUESTER',
    ...overrides,
  };
}

// Insert a grant directly; returns its ids.
export async function seedGrant(
  input: { raterId?: string; rateeId?: string; raterRole?: Role; rateeRole?: Role } = {},
) {
  const row = {
    orderId: randomUUID(),
    raterId: input.raterId ?? randomUUID(),
    raterRole: input.raterRole ?? ('COURIER' as const),
    rateeId: input.rateeId ?? randomUUID(),
    rateeRole: input.rateeRole ?? ('REQUESTER' as const),
    eventId: randomUUID(),
  };
  await db.insert(ratingGrant).values(row);
  return row;
}
