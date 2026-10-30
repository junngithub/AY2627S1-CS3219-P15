/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Tests for the daily reconciliation run, with User and Order Service mocked.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchOrderCounts, fetchUserIds, PeerError } from '../src/clients/peers.js';
import { RunInProgressError } from '../src/errors.js';
import { closeInterruptedRuns, listRuns, runNow, startRun } from '../src/jobs/evaluationRun.js';
import { evaluateUser } from '../src/services/badges.service.js';
import { badgeState, db, jobRun, metricsOf, userMetrics } from './helpers.js';

vi.mock('../src/clients/peers.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/clients/peers.js')>()),
  fetchUserIds: vi.fn(),
  fetchOrderCounts: vi.fn(),
}));

const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAROL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// What Order Service reports, per user.
let orderCounts: Record<string, { completedDeliveries: number; completedOrders: number }>;

beforeEach(() => {
  orderCounts = {};
  vi.mocked(fetchUserIds).mockImplementation(async (offset, limit) => {
    const all = [ALICE, BOB, CAROL];
    return { userIds: all.slice(offset, offset + limit), total: all.length };
  });
  vi.mocked(fetchOrderCounts).mockImplementation(async (userIds) =>
    userIds.flatMap((userId) => (orderCounts[userId] ? [{ userId, ...orderCounts[userId] }] : [])),
  );
});

describe('runNow', () => {
  it('pages through every user, stores Order Service counts and awards badges', async () => {
    orderCounts[ALICE] = { completedDeliveries: 10, completedOrders: 0 };
    orderCounts[CAROL] = { completedDeliveries: 0, completedOrders: 1 };

    const summary = await runNow('schedule');

    expect(summary).toMatchObject({ trigger: 'schedule', usersProcessed: 3, usersSkipped: 0, badgesAwarded: 3 });
    // Batches of 2 (vitest.config.ts): two pages for three users.
    expect(fetchUserIds).toHaveBeenCalledTimes(2);
    expect(await badgeState(ALICE, 'ten_deliveries')).toBe('earned');
    expect(await badgeState(ALICE, 'first_delivery')).toBe('earned');
    expect(await badgeState(CAROL, 'first_order')).toBe('earned');
    expect(await metricsOf(BOB)).toMatchObject({ completedDeliveries: 0, completedOrders: 0 });

    const [run] = await listRuns();
    expect(run).toMatchObject({ runId: summary.runId, status: 'succeeded', usersProcessed: 3, badgesAwarded: 3 });
    expect(run?.finishedAt).not.toBeNull();
  });

  it('revokes a badge when Order Service reports fewer orders than were counted', async () => {
    await db.insert(userMetrics).values({ userId: ALICE, completedDeliveries: 1 });
    await evaluateUser(ALICE);
    expect(await badgeState(ALICE, 'first_delivery')).toBe('earned');

    const summary = await runNow('schedule');

    expect(summary.badgesRevoked).toBe(1);
    expect(await badgeState(ALICE, 'first_delivery')).toBe('revoked');
  });

  it('keeps the counts of a user whose order event arrived after the run asked Order Service', async () => {
    const later = new Date(Date.now() + 60_000);
    await db.insert(userMetrics).values({ userId: BOB, completedDeliveries: 2, lastOrderEventAt: later });
    orderCounts[BOB] = { completedDeliveries: 1, completedOrders: 0 };

    const summary = await runNow('schedule');

    expect(summary.usersSkipped).toBe(1);
    expect(await metricsOf(BOB)).toMatchObject({ completedDeliveries: 2 });
  });

  it('overwrites counts an older order event left behind', async () => {
    const earlier = new Date(Date.now() - 60_000);
    await db.insert(userMetrics).values({ userId: BOB, completedDeliveries: 5, lastOrderEventAt: earlier });
    orderCounts[BOB] = { completedDeliveries: 4, completedOrders: 0 };

    await runNow('schedule');

    const metrics = await metricsOf(BOB);
    expect(metrics).toMatchObject({ completedDeliveries: 4 });
    expect(metrics?.reconciledAt).not.toBeNull();
  });

  it('keeps the rating metrics, which only events change', async () => {
    await db.insert(userMetrics).values({ userId: ALICE, averageRating: 4.9, ratingCount: 10 });
    await runNow('schedule');
    expect(await metricsOf(ALICE)).toMatchObject({ averageRating: 4.9, ratingCount: 10 });
    expect(await badgeState(ALICE, 'trusted_user')).toBe('earned');
  });

  it('finishes with nothing to do when there are no users', async () => {
    vi.mocked(fetchUserIds).mockResolvedValue({ userIds: [], total: 0 });
    expect(await runNow('manual')).toMatchObject({ usersProcessed: 0 });
    expect(fetchOrderCounts).not.toHaveBeenCalled();
  });

  it('records a failed run when Order Service answers in an unexpected shape', async () => {
    vi.mocked(fetchOrderCounts).mockResolvedValue([{ userId: ALICE }] as never);
    await expect(runNow('schedule')).rejects.toThrow('unexpected shape');
    const [run] = await listRuns();
    expect(run).toMatchObject({ status: 'failed', error: 'Order Service returned counts in an unexpected shape' });
  });

  it('records a failed run when a peer is down', async () => {
    vi.mocked(fetchUserIds).mockRejectedValue(new PeerError('http://user.test/x', 503));
    await expect(runNow('schedule')).rejects.toBeInstanceOf(PeerError);
    expect((await listRuns())[0]).toMatchObject({ status: 'failed', error: 'http://user.test/x answered 503' });
  });

  it('records a failed run when something that is not an Error is thrown', async () => {
    vi.mocked(fetchUserIds).mockRejectedValue('boom');
    await expect(runNow('schedule')).rejects.toBe('boom');
    expect((await listRuns())[0]).toMatchObject({ status: 'failed', error: 'boom' });
  });
});

describe('startRun', () => {
  it('allows only one run at a time', async () => {
    await startRun('schedule');
    await expect(startRun('manual', ALICE)).rejects.toBeInstanceOf(RunInProgressError);
  });

  it('records who started a manual run', async () => {
    const runId = await startRun('manual', ALICE);
    const [row] = await db.select().from(jobRun).where(eq(jobRun.runId, runId));
    expect(row).toMatchObject({ trigger: 'manual', triggeredBy: ALICE, status: 'running' });
  });
});

describe('closeInterruptedRuns', () => {
  it('marks a run left running by a restart as failed, so the next run can start', async () => {
    await startRun('schedule');
    expect(await closeInterruptedRuns()).toBe(1);
    expect((await listRuns())[0]).toMatchObject({ status: 'failed', error: 'interrupted: the service restarted' });
    await expect(startRun('schedule')).resolves.toBeGreaterThan(0);
  });
});

describe('listRuns', () => {
  it('lists runs newest first', async () => {
    vi.mocked(fetchUserIds).mockResolvedValue({ userIds: [], total: 0 });
    await runNow('schedule');
    await runNow('manual', ALICE);
    expect((await listRuns()).map((run) => run.trigger)).toEqual(['manual', 'schedule']);
  });
});
