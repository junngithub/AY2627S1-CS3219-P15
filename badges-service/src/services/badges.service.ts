/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Generated per-user evaluation (award and revoke) and the profile read, ported from
 *        the scaffold's evaluationJob.ts and badgeRoutes.ts.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, type Executor } from '../database/index.js';
import { userBadge, userMetrics } from '../database/schema.js';
import { evaluateAll, evaluateBadge } from '../rules/evaluator.js';
import type { BadgeChanges, BadgeDefinition, UserMetrics } from '../types.js';
import { loadCatalog } from './catalog.service.js';

export async function readMetrics(userId: string, executor: Executor = db): Promise<UserMetrics> {
  const [row] = await executor.select().from(userMetrics).where(eq(userMetrics.userId, userId));
  return {
    userId,
    completedDeliveries: row?.completedDeliveries ?? 0,
    completedOrders: row?.completedOrders ?? 0,
    averageRating: row?.averageRating ?? null,
    ratingCount: row?.ratingCount ?? 0,
  };
}

/**
 * Re-checks every badge for one user against their stored metrics, and writes
 * only what changed: newly satisfied badges are earned (or re-earned after a
 * revocation), badges no longer satisfied are revoked. Running it twice changes
 * nothing the second time (F3.1.1).
 */
export async function evaluateUser(
  userId: string,
  executor: Executor = db,
  catalog?: BadgeDefinition[],
): Promise<BadgeChanges> {
  const definitions = catalog ?? (await loadCatalog(executor));
  const metrics = await readMetrics(userId, executor);
  const held = new Set(
    (
      await executor
        .select({ badgeId: userBadge.badgeId })
        .from(userBadge)
        .where(and(eq(userBadge.userId, userId), eq(userBadge.state, 'earned')))
    ).map((row) => row.badgeId),
  );

  const evaluations = evaluateAll(definitions, metrics);
  const toAward = evaluations.filter((e) => e.satisfied && !held.has(e.badgeId)).map((e) => e.badgeId);
  const toRevoke = evaluations.filter((e) => !e.satisfied && held.has(e.badgeId)).map((e) => e.badgeId);

  if (toAward.length > 0) {
    await executor
      .insert(userBadge)
      .values(toAward.map((badgeId) => ({ userId, badgeId, state: 'earned' as const, earnedAt: new Date() })))
      .onConflictDoUpdate({
        target: [userBadge.userId, userBadge.badgeId],
        set: { state: 'earned', earnedAt: sql`now()`, revokedAt: null, updatedAt: sql`now()` },
      });
  }
  if (toRevoke.length > 0) {
    await executor
      .update(userBadge)
      .set({ state: 'revoked', revokedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(userBadge.userId, userId), inArray(userBadge.badgeId, toRevoke)));
  }

  return { awarded: toAward.length, revoked: toRevoke.length };
}

/**
 * F4: every catalog badge for one user, earned or not, with the unlock criteria
 * (F4.1) and progress towards unearned ones (F4.1.1). Reads stored state only,
 * so a profile view never calls Order or Rating.
 */
export async function getUserBadges(userId: string) {
  const [catalog, metricsRows, badgeRows] = await Promise.all([
    loadCatalog(),
    db.select().from(userMetrics).where(eq(userMetrics.userId, userId)),
    db.select().from(userBadge).where(eq(userBadge.userId, userId)),
  ]);
  const metricsRow = metricsRows[0];
  const metrics: UserMetrics = {
    userId,
    completedDeliveries: metricsRow?.completedDeliveries ?? 0,
    completedOrders: metricsRow?.completedOrders ?? 0,
    averageRating: metricsRow?.averageRating ?? null,
    ratingCount: metricsRow?.ratingCount ?? 0,
  };
  const records = new Map(badgeRows.map((row) => [row.badgeId, row]));

  const badges = catalog.map((definition) => {
    const record = records.get(definition.badgeId);
    const earned = record?.state === 'earned';
    const evaluation = evaluateBadge(definition, metrics);
    return {
      badgeId: definition.badgeId,
      title: definition.title,
      description: definition.description,
      targetRole: definition.targetRole,
      displayOrder: definition.displayOrder,
      iconUrl: earned ? definition.iconEarnedUrl : definition.iconUnearnedUrl,
      earned,
      earnedAt: earned && record?.earnedAt ? record.earnedAt.toISOString() : null,
      criteria: definition.conditions,
      progress: earned ? null : evaluation.progress,
    };
  });

  return {
    userId,
    // When the metrics last changed, so the profile can say how fresh this is.
    metricsAsOf: metricsRow ? metricsRow.updatedAt.toISOString() : null,
    earnedCount: badges.filter((b) => b.earned).length,
    totalCount: badges.length,
    badges,
  };
}
