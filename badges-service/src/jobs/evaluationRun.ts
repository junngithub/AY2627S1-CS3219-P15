/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Generated the daily reconciliation run (ported from the scaffold's evaluationJob.ts):
 *        overwrite counts from Order Service, then re-check every user's badges.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { desc, eq, sql } from 'drizzle-orm';
import { fetchOrderCounts, fetchUserIds } from '../clients/peers.js';
import { config } from '../config.js';
import { db } from '../database/index.js';
import { jobRun, userMetrics } from '../database/schema.js';
import { RunInProgressError } from '../errors.js';
import { evaluateUser } from '../services/badges.service.js';
import { loadCatalog } from '../services/catalog.service.js';
import type { JobSummary } from '../types.js';

type Trigger = 'schedule' | 'manual';

const OrderCountsResponse = Type.Array(
  Type.Object({
    userId: Type.String(),
    completedDeliveries: Type.Integer({ minimum: 0 }),
    completedOrders: Type.Integer({ minimum: 0 }),
  }),
);

function isUniqueViolation(error: unknown): boolean {
  const err = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return err?.code === '23505' || err?.cause?.code === '23505';
}

/**
 * Records a new run. The partial unique index on job_run allows one 'running'
 * row at a time, so a second start (another replica, or a double click) fails here.
 */
export async function startRun(trigger: Trigger, triggeredBy: string | null = null): Promise<number> {
  try {
    const [row] = await db.insert(jobRun).values({ trigger, triggeredBy }).returning({ runId: jobRun.runId });
    return row!.runId;
  } catch (error) {
    if (isUniqueViolation(error)) throw new RunInProgressError();
    throw error;
  }
}

/**
 * A run still marked 'running' when the service starts was cut off by a restart.
 * Close it so the next run is not blocked forever. Assumes one replica (the
 * deploy default); with more, a restarting pod would close a live run's row.
 */
export async function closeInterruptedRuns(): Promise<number> {
  const closed = await db
    .update(jobRun)
    .set({ status: 'failed', finishedAt: sql`now()`, error: 'interrupted: the service restarted' })
    .where(eq(jobRun.status, 'running'))
    .returning({ runId: jobRun.runId });
  return closed.length;
}

/**
 * Pages through every user (NFR1.1.1: at most 1,000 per batch), overwrites their
 * delivery and request counts with Order Service's, then re-checks their badges.
 * This is the reconciliation half of the design: it repairs anything the events
 * missed and is how a badge is revoked by the next daily run (NFR2.1.1).
 */
export async function executeRun(runId: number, trigger: Trigger): Promise<JobSummary> {
  const startedAt = Date.now();
  const counts = { usersProcessed: 0, usersSkipped: 0, badgesAwarded: 0, badgesRevoked: 0 };

  const finish = (status: 'succeeded' | 'failed', error: string | null = null) =>
    db
      .update(jobRun)
      .set({ status, finishedAt: sql`now()`, error, ...counts })
      .where(eq(jobRun.runId, runId));

  try {
    const catalog = await loadCatalog();
    let offset = 0;

    for (;;) {
      // Anything an order event changes after this moment is newer than what
      // Order Service is about to report, so those users keep their counts.
      const fetchedAt = new Date().toISOString();
      const page = await fetchUserIds(offset, config.batchSize);
      if (page.userIds.length === 0) break;

      const orderCounts = await fetchOrderCounts(page.userIds);
      if (!Value.Check(OrderCountsResponse, orderCounts)) {
        throw new Error('Order Service returned counts in an unexpected shape');
      }
      const byUser = new Map(orderCounts.map((row) => [row.userId, row]));

      const written = await db
        .insert(userMetrics)
        .values(
          page.userIds.map((userId) => ({
            userId,
            completedDeliveries: byUser.get(userId)?.completedDeliveries ?? 0,
            completedOrders: byUser.get(userId)?.completedOrders ?? 0,
            reconciledAt: new Date(fetchedAt),
          })),
        )
        .onConflictDoUpdate({
          target: userMetrics.userId,
          set: {
            completedDeliveries: sql`excluded.completed_deliveries`,
            completedOrders: sql`excluded.completed_orders`,
            reconciledAt: sql`excluded.reconciled_at`,
            updatedAt: sql`now()`,
          },
          setWhere: sql`${userMetrics.lastOrderEventAt} is null or ${userMetrics.lastOrderEventAt} < ${fetchedAt}::timestamptz`,
        })
        .returning({ userId: userMetrics.userId });
      counts.usersSkipped += page.userIds.length - written.length;

      // Every user is re-checked, skipped or not: a catalog change or a rating
      // change still needs applying.
      for (const userId of page.userIds) {
        const changes = await evaluateUser(userId, db, catalog);
        counts.badgesAwarded += changes.awarded;
        counts.badgesRevoked += changes.revoked;
        counts.usersProcessed += 1;
      }

      offset += page.userIds.length;
      if (offset >= page.total) break;
    }

    await finish('succeeded');
    return { runId, trigger, ...counts, durationMs: Date.now() - startedAt };
  } catch (error) {
    await finish('failed', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/** Starts and finishes a run in one call: what the daily schedule does. */
export async function runNow(trigger: Trigger, triggeredBy: string | null = null): Promise<JobSummary> {
  const runId = await startRun(trigger, triggeredBy);
  return executeRun(runId, trigger);
}

/** The last 20 runs, newest first, for the admin job list. */
export async function listRuns() {
  const rows = await db.select().from(jobRun).orderBy(desc(jobRun.runId)).limit(20);
  return rows.map((row) => ({
    ...row,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  }));
}
