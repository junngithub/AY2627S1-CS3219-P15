/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Generated the user.rating.updated handler, the only source of rating metrics.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import { Value } from '@sinclair/typebox/value';
import { sql } from 'drizzle-orm';
import { db } from '../database/index.js';
import { userMetrics } from '../database/schema.js';
import { evaluateUser } from '../services/badges.service.js';
import { USER_RATING_UPDATED, UserRatingUpdated } from './messages.js';

export type RatingOutcome = 'updated' | 'stale' | 'ignored' | 'invalid';

/**
 * Handles one message from foc.user.rating. The message carries the user's whole
 * current average and count, and ratings are never deleted, so a higher count is
 * always newer: an older or redelivered message is 'stale' and changes nothing (NFR2.1).
 */
export async function handleRatingEvent(raw: string): Promise<RatingOutcome> {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return 'invalid';
  }

  const eventType = (message as { eventType?: unknown } | null)?.eventType;
  if (eventType !== USER_RATING_UPDATED) return 'ignored';
  if (!Value.Check(UserRatingUpdated, message)) return 'invalid';

  const { userId, newAverage, totalRatings } = message;

  return db.transaction(async (tx) => {
    const updated = await tx
      .insert(userMetrics)
      .values({ userId, averageRating: newAverage, ratingCount: totalRatings })
      .onConflictDoUpdate({
        target: userMetrics.userId,
        set: { averageRating: newAverage, ratingCount: totalRatings, updatedAt: sql`now()` },
        setWhere: sql`${userMetrics.ratingCount} < ${totalRatings}`,
      })
      .returning({ userId: userMetrics.userId });
    if (updated.length === 0) return 'stale';

    await evaluateUser(userId, tx);
    return 'updated';
  });
}
