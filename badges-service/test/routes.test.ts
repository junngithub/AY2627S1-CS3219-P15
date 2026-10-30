/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Route tests through fastify.inject, with User and Order Service mocked.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { fetchOrderCounts, fetchUserIds } from '../src/clients/peers.js';
import { listRuns } from '../src/jobs/evaluationRun.js';
import { handleOrderEvent } from '../src/messaging/orderEvents.js';
import { orderMessage } from './helpers.js';

vi.mock('../src/clients/peers.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/clients/peers.js')>()),
  fetchUserIds: vi.fn(),
  fetchOrderCounts: vi.fn(),
}));

const ADMIN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const app = buildApp();

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.mocked(fetchUserIds).mockResolvedValue({ userIds: [], total: 0 });
  vi.mocked(fetchOrderCounts).mockResolvedValue([]);
});

async function waitForRun(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if ((await listRuns())[0]?.status !== 'running') return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('run did not finish');
}

describe('health', () => {
  it('answers /health and /health/db', async () => {
    expect((await app.inject({ url: '/health' })).json()).toEqual({ service: 'badges-service', status: 'ok' });
    expect((await app.inject({ url: '/health/db' })).json()).toEqual({ status: 'ok', db: 'up' });
  });
});

describe('GET /api/v1/badges/:userId', () => {
  it('returns every catalog badge for the owner, earned ones first in display order', async () => {
    const message = orderMessage();
    await handleOrderEvent(JSON.stringify(message));
    const courierId = message.courierId as string;

    const response = await app.inject({ url: `/api/v1/badges/${courierId}`, headers: { 'x-user-id': courierId } });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ userId: courierId, earnedCount: 1, totalCount: 6 });
    expect(body.metricsAsOf).not.toBeNull();

    const first = body.badges.find((b: { badgeId: string }) => b.badgeId === 'first_delivery');
    expect(first).toMatchObject({ earned: true, progress: null, iconUrl: '/badges/first-run.svg' });
    expect(first.earnedAt).not.toBeNull();

    const ten = body.badges.find((b: { badgeId: string }) => b.badgeId === 'ten_deliveries');
    expect(ten).toMatchObject({
      earned: false,
      earnedAt: null,
      progress: { current: 1, target: 10 },
      criteria: [{ metric: 'completedDeliveries', op: 'gte', value: 10 }],
      iconUrl: '/badges/ten-runs-locked.svg',
    });
  });

  it('shows an empty profile for a user with no activity yet', async () => {
    const userId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const body = (await app.inject({ url: `/api/v1/badges/${userId}`, headers: { 'x-user-id': userId } })).json();
    expect(body).toMatchObject({ metricsAsOf: null, earnedCount: 0, totalCount: 6 });
  });

  it("answers 404 for someone else's badges or a missing identity", async () => {
    const other = await app.inject({ url: `/api/v1/badges/${ADMIN}`, headers: { 'x-user-id': 'someone-else' } });
    expect(other.statusCode).toBe(404);
    expect(other.json()).toEqual({ error: 'Endpoint not found', code: 'NOT_FOUND' });

    expect((await app.inject({ url: `/api/v1/badges/${ADMIN}` })).statusCode).toBe(404);
  });

  it('rejects a user ID that is not a UUID', async () => {
    const response = await app.inject({ url: '/api/v1/badges/alice', headers: { 'x-user-id': 'alice' } });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });
});

describe('admin routes', () => {
  const admin = { 'x-user-id': ADMIN, 'x-is-admin': 'true' };

  it('starts a manual run in the background and lists it', async () => {
    const started = await app.inject({ method: 'POST', url: '/api/v1/badges/admin/evaluate', headers: admin });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toEqual({ runId: 1, status: 'running' });
    await waitForRun();

    const jobs = await app.inject({ url: '/api/v1/badges/admin/jobs', headers: admin });
    expect(jobs.statusCode).toBe(200);
    expect(jobs.json().runs[0]).toMatchObject({ runId: 1, trigger: 'manual', triggeredBy: ADMIN, status: 'succeeded' });
  });

  it('logs a manual run that fails without failing the request', async () => {
    vi.mocked(fetchUserIds).mockRejectedValue(new Error('user down'));
    const started = await app.inject({ method: 'POST', url: '/api/v1/badges/admin/evaluate', headers: admin });
    expect(started.statusCode).toBe(202);
    await waitForRun();
    expect((await listRuns())[0]).toMatchObject({ status: 'failed', error: 'user down' });
  });

  it('answers 409 while a run is in progress', async () => {
    let release!: () => void;
    vi.mocked(fetchUserIds).mockImplementation(
      () => new Promise((resolve) => (release = () => resolve({ userIds: [], total: 0 }))),
    );
    await app.inject({ method: 'POST', url: '/api/v1/badges/admin/evaluate', headers: admin });

    const second = await app.inject({ method: 'POST', url: '/api/v1/badges/admin/evaluate', headers: admin });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: 'A badge run is already in progress', code: 'RUN_IN_PROGRESS' });

    release();
    await waitForRun();
  });

  it.each([
    ['no identity', {}],
    ['a non-admin', { 'x-user-id': ADMIN, 'x-is-admin': 'false' }],
    ['an admin flag without a user ID', { 'x-is-admin': 'true' }],
    ['a user ID that is not a UUID', { 'x-user-id': 'admin', 'x-is-admin': 'true' }],
  ])('hides the admin routes from %s with 404', async (_label, headers) => {
    const evaluate = await app.inject({ method: 'POST', url: '/api/v1/badges/admin/evaluate', headers });
    const jobs = await app.inject({ url: '/api/v1/badges/admin/jobs', headers });
    expect(evaluate.statusCode).toBe(404);
    expect(jobs.statusCode).toBe(404);
    expect(await listRuns()).toHaveLength(0);
  });
});

describe('unknown routes', () => {
  it("answer with the gateway's 404 body", async () => {
    const response = await app.inject({ url: '/api/v1/badges' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Endpoint not found', code: 'NOT_FOUND' });
  });
});
