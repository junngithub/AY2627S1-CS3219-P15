import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { creditLog, creditOrder, creditUser, db, seedOrder, seedUser } from './helpers.js';

const BASE = '/api/v1/credit';

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /me/balance', () => {
  it('returns the balance for a known user', async () => {
    const userId = await seedUser(20);
    const res = await app.inject({
      method: 'GET',
      url: `${BASE}/me/balance`,
      headers: { 'x-user-id': userId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId, balance: 20 });
  });

  it('404 CREDIT_USER_NOT_FOUND for an unknown user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${BASE}/me/balance`,
      headers: { 'x-user-id': randomUUID() },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('CREDIT_USER_NOT_FOUND');
  });

  it('400 when the x-user-id header is missing', async () => {
    const res = await app.inject({ method: 'GET', url: `${BASE}/me/balance` });
    expect(res.statusCode).toBe(400);
  });

  it('400 when x-user-id is not a UUID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${BASE}/me/balance`,
      headers: { 'x-user-id': 'not-a-uuid' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /reserve', () => {
  it('reserves credits, deducts balance, and writes a RESERVATION log', async () => {
    const requesterId = await seedUser(20);
    const orderId = randomUUID();

    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/reserve`,
      payload: { orderId, requesterId, amount: 5 },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ orderId, requesterId, reserved: 5, balance: 15 });

    const [order] = await db.select().from(creditOrder).where(eq(creditOrder.orderId, orderId));
    expect(order?.reservedCredits).toBe(5);

    const [log] = await db.select().from(creditLog).where(eq(creditLog.orderId, orderId));
    expect(log?.operationType).toBe('RESERVATION');
    expect(log?.balanceAfter).toBe(15);

    const [user] = await db.select().from(creditUser).where(eq(creditUser.userId, requesterId));
    expect(user?.balance).toBe(15);
  });

  it('409 CREDIT_INSUFFICIENT_BALANCE and rolls back all side effects', async () => {
    const requesterId = await seedUser(3);

    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/reserve`,
      payload: { orderId: randomUUID(), requesterId, amount: 5 },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CREDIT_INSUFFICIENT_BALANCE');

    expect(await db.select().from(creditOrder)).toHaveLength(0);
    expect(await db.select().from(creditLog)).toHaveLength(0);
    const [user] = await db.select().from(creditUser).where(eq(creditUser.userId, requesterId));
    expect(user?.balance).toBe(3);
  });

  it('404 CREDIT_USER_NOT_FOUND for an unknown requester', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/reserve`,
      payload: { orderId: randomUUID(), requesterId: randomUUID(), amount: 5 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('CREDIT_USER_NOT_FOUND');
  });

  it('400 CREDIT_INVALID_AMOUNT for a zero amount', async () => {
    const requesterId = await seedUser(20);
    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/reserve`,
      payload: { orderId: randomUUID(), requesterId, amount: 0 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('CREDIT_INVALID_AMOUNT');
  });

  it('400 CREDIT_INVALID_AMOUNT for a negative amount', async () => {
    const requesterId = await seedUser(20);
    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/reserve`,
      payload: { orderId: randomUUID(), requesterId, amount: -5 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('CREDIT_INVALID_AMOUNT');
  });

  it('409 CREDIT_ORDER_ALREADY_RESERVED on a duplicate, deducting only once', async () => {
    const requesterId = await seedUser(20);
    const orderId = randomUUID();

    const first = await app.inject({
      method: 'POST',
      url: `${BASE}/reserve`,
      payload: { orderId, requesterId, amount: 5 },
    });
    expect(first.statusCode).toBe(201);

    const dup = await app.inject({
      method: 'POST',
      url: `${BASE}/reserve`,
      payload: { orderId, requesterId, amount: 5 },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('CREDIT_ORDER_ALREADY_RESERVED');

    const [user] = await db.select().from(creditUser).where(eq(creditUser.userId, requesterId));
    expect(user?.balance).toBe(15); // deducted exactly once
  });

  it('400 FST_ERR_VALIDATION for a malformed orderId', async () => {
    const requesterId = await seedUser(20);
    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/reserve`,
      payload: { orderId: 'not-a-uuid', requesterId, amount: 5 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('FST_ERR_VALIDATION');
  });

  it('400 FST_ERR_VALIDATION when amount is missing', async () => {
    const requesterId = await seedUser(20);
    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/reserve`,
      payload: { orderId: randomUUID(), requesterId },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('FST_ERR_VALIDATION');
  });

  it('400 FST_ERR_VALIDATION when amount is not an integer', async () => {
    const requesterId = await seedUser(20);
    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/reserve`,
      payload: { orderId: randomUUID(), requesterId, amount: 1.5 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('FST_ERR_VALIDATION');
  });
});

describe('POST /release', () => {
  it('refunds the requester, removes the order, and writes a RETURN log', async () => {
    const requesterId = await seedUser(15);
    const orderId = await seedOrder(requesterId, 5);

    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/release`,
      payload: { orderId },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ orderId, requesterId, refunded: 5, balance: 20 });

    expect(
      await db.select().from(creditOrder).where(eq(creditOrder.orderId, orderId)),
    ).toHaveLength(0);

    const [log] = await db.select().from(creditLog).where(eq(creditLog.orderId, orderId));
    expect(log?.operationType).toBe('RETURN');
    expect(log?.balanceAfter).toBe(20);
  });

  it('404 CREDIT_ORDER_NOT_FOUND for an unknown order', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${BASE}/release`,
      payload: { orderId: randomUUID() },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('CREDIT_ORDER_NOT_FOUND');
  });

  it('is idempotent: releasing twice 404s the second time and does not double-refund', async () => {
    const requesterId = await seedUser(15);
    const orderId = await seedOrder(requesterId, 5);

    const first = await app.inject({ method: 'POST', url: `${BASE}/release`, payload: { orderId } });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: 'POST', url: `${BASE}/release`, payload: { orderId } });
    expect(second.statusCode).toBe(404);

    const [user] = await db.select().from(creditUser).where(eq(creditUser.userId, requesterId));
    expect(user?.balance).toBe(20); // refunded once
  });
});
