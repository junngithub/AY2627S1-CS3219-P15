import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { averageOf } from '../src/services/rating.service.js';
import { db, outbox, rating, seedGrant, userRating } from './helpers.js';

const BASE = '/api/v1/rating';

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

function submit(raterId: string, orderId: string, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `${BASE}/orders/${orderId}`,
    headers: { 'x-user-id': raterId },
    payload,
  });
}

describe('averageOf', () => {
  it('is null with no ratings and rounds to 2 decimal places', () => {
    expect(averageOf(0, 0)).toBeNull();
    expect(averageOf(14, 3)).toBe(4.67);
  });
});

describe('GET /:userId', () => {
  it('returns a null average and count 0 for a user nobody has rated', async () => {
    const userId = randomUUID();
    const res = await app.inject({ method: 'GET', url: `${BASE}/${userId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId, average: null, count: 0 });
  });

  it('returns the unified average across both roles', async () => {
    const userId = randomUUID();
    const asRequester = await seedGrant({ rateeId: userId, rateeRole: 'REQUESTER' });
    const asCourier = await seedGrant({
      rateeId: userId,
      rateeRole: 'COURIER',
      raterRole: 'REQUESTER',
    });
    await submit(asRequester.raterId, asRequester.orderId, { score: 5 });
    await submit(asCourier.raterId, asCourier.orderId, { score: 4 });

    const res = await app.inject({ method: 'GET', url: `${BASE}/${userId}` });
    expect(res.json()).toEqual({ userId, average: 4.5, count: 2 });
  });

  it('400 when userId is not a UUID', async () => {
    const res = await app.inject({ method: 'GET', url: `${BASE}/not-a-uuid` });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /orders/:orderId', () => {
  it('stores the rating, updates the totals and queues user.rating.updated', async () => {
    const grant = await seedGrant();
    const res = await submit(grant.raterId, grant.orderId, { score: 4, comment: '  On time  ' });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      orderId: grant.orderId,
      rateeId: grant.rateeId,
      rateeRole: 'REQUESTER',
      score: 4,
      comment: 'On time',
    });

    const [saved] = await db.select().from(rating).where(eq(rating.orderId, grant.orderId));
    expect(saved).toMatchObject({ raterId: grant.raterId, raterRole: 'COURIER', score: 4 });

    const [totals] = await db
      .select()
      .from(userRating)
      .where(eq(userRating.userId, grant.rateeId));
    expect(totals).toMatchObject({ ratingSum: 4, ratingCount: 1 });

    const [queued] = await db.select().from(outbox);
    expect(queued).toMatchObject({ topic: 'foc.user.rating', messageKey: grant.rateeId, sentAt: null });
    expect(queued?.payload).toMatchObject({
      eventType: 'user.rating.updated',
      schemaVersion: 1,
      userId: grant.rateeId,
      newAverage: 4,
      totalRatings: 1,
    });
  });

  it('stores a blank comment as null', async () => {
    const grant = await seedGrant();
    const res = await submit(grant.raterId, grant.orderId, { score: 3, comment: '   ' });
    expect(res.json().comment).toBeNull();
  });

  it('403 RATING_NOT_PERMITTED without a grant for this rater', async () => {
    const grant = await seedGrant();
    const res = await submit(randomUUID(), grant.orderId, { score: 5 });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('RATING_NOT_PERMITTED');
    expect(await db.select().from(rating)).toHaveLength(0);
  });

  it('409 RATING_ALREADY_SUBMITTED on a second rating, counting only the first', async () => {
    const grant = await seedGrant();
    expect((await submit(grant.raterId, grant.orderId, { score: 5 })).statusCode).toBe(201);

    const dup = await submit(grant.raterId, grant.orderId, { score: 1 });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('RATING_ALREADY_SUBMITTED');

    const [totals] = await db
      .select()
      .from(userRating)
      .where(eq(userRating.userId, grant.rateeId));
    expect(totals).toMatchObject({ ratingSum: 5, ratingCount: 1 });
    expect(await db.select().from(outbox)).toHaveLength(1);
  });

  it('keeps the totals right under concurrent ratings for one user', async () => {
    const rateeId = randomUUID();
    const grants = await Promise.all(
      Array.from({ length: 10 }, () => seedGrant({ rateeId })),
    );
    const results = await Promise.all(
      grants.map((g) => submit(g.raterId, g.orderId, { score: 3 })),
    );
    expect(results.every((r) => r.statusCode === 201)).toBe(true);

    const [totals] = await db.select().from(userRating).where(eq(userRating.userId, rateeId));
    expect(totals).toMatchObject({ ratingSum: 30, ratingCount: 10 });
  });

  it.each([
    ['score 0', { score: 0 }],
    ['score 6', { score: 6 }],
    ['a fractional score', { score: 4.5 }],
    ['a missing score', {}],
    ['a comment over 500 characters', { score: 4, comment: 'x'.repeat(501) }],
  ])('400 VALIDATION_ERROR for %s', async (_label, payload) => {
    const grant = await seedGrant();
    const res = await submit(grant.raterId, grant.orderId, payload);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('ignores identity fields in the body (Fastify strips unknown properties)', async () => {
    const grant = await seedGrant();
    const res = await submit(grant.raterId, grant.orderId, { score: 4, raterId: randomUUID() });
    expect(res.statusCode).toBe(201);
    const [saved] = await db.select().from(rating).where(eq(rating.orderId, grant.orderId));
    expect(saved?.raterId).toBe(grant.raterId);
  });

  it('400 when the x-user-id header is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/orders/${randomUUID()}`,
      payload: { score: 4 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /me/pending', () => {
  it('lists only the caller’s grants that have not been used', async () => {
    const raterId = randomUUID();
    const used = await seedGrant({ raterId });
    const open = await seedGrant({ raterId });
    await seedGrant(); // someone else's
    await submit(raterId, used.orderId, { score: 5 });

    const res = await app.inject({
      method: 'GET',
      url: `${BASE}/me/pending`,
      headers: { 'x-user-id': raterId },
    });
    expect(res.statusCode).toBe(200);
    const { pending } = res.json();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      orderId: open.orderId,
      rateeId: open.rateeId,
      rateeRole: 'REQUESTER',
    });
  });
});

describe('error format', () => {
  it('sends domain errors as { error, code } with a readable message', async () => {
    const grant = await seedGrant();
    const res = await submit(randomUUID(), grant.orderId, { score: 5 });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: `You have no rating to give for order ${grant.orderId}`,
      code: 'RATING_NOT_PERMITTED',
    });
  });

  it('sends validation errors as { error, code }', async () => {
    const grant = await seedGrant();
    const res = await submit(grant.raterId, grant.orderId, { score: 9 });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json()).sort()).toEqual(['code', 'error']);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('answers an unknown route with the gateway-style 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Endpoint not found', code: 'NOT_FOUND' });
  });
});
