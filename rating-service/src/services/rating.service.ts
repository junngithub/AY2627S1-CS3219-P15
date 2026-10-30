import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../database/index.js';
import { outbox, rating, ratingGrant, userRating } from '../database/schema.js';
import { RatingAlreadySubmittedError, RatingNotPermittedError } from '../errors.js';
import { ratingUpdatedMessage } from '../messaging/messages.js';
import type {
  PendingRatingsResponse,
  SubmitRatingBody,
  SubmitRatingResponse,
  UserRatingResponse,
} from '../schemas/rating.js';

export function averageOf(sum: number, count: number): number | null {
  if (count === 0) return null;
  return Math.round((sum / count) * 100) / 100;
}

export async function getUserRating(userId: string): Promise<UserRatingResponse> {
  const [row] = await db
    .select({ sum: userRating.ratingSum, count: userRating.ratingCount })
    .from(userRating)
    .where(eq(userRating.userId, userId));

  // A user nobody has rated yet is not an error: they simply have no average.
  const sum = row?.sum ?? 0;
  const count = row?.count ?? 0;
  return { userId, average: averageOf(sum, count), count };
}

export async function submitRating(
  raterId: string,
  orderId: string,
  input: SubmitRatingBody,
): Promise<SubmitRatingResponse> {
  const comment = input.comment?.trim() || null;

  return db.transaction(async (tx) => {
    // Only Order Service's rating.permission.granted message lets someone rate (F2.1.1).
    const [grant] = await tx
      .select()
      .from(ratingGrant)
      .where(and(eq(ratingGrant.orderId, orderId), eq(ratingGrant.raterId, raterId)));

    if (!grant) throw new RatingNotPermittedError(orderId);

    // The unique (order_id, rater_id) constraint rejects a second submission (NFR2.1.1).
    const [saved] = await tx
      .insert(rating)
      .values({
        orderId,
        raterId,
        raterRole: grant.raterRole,
        rateeId: grant.rateeId,
        rateeRole: grant.rateeRole,
        score: input.score,
        comment,
      })
      .onConflictDoNothing()
      .returning({ createdAt: rating.createdAt });

    if (!saved) throw new RatingAlreadySubmittedError(orderId);

    // A single upsert is atomic, so concurrent ratings for one user can't lose an update (NFR1.1.1).
    const [totals] = await tx
      .insert(userRating)
      .values({ userId: grant.rateeId, ratingSum: input.score, ratingCount: 1 })
      .onConflictDoUpdate({
        target: userRating.userId,
        set: {
          ratingSum: sql`${userRating.ratingSum} + ${input.score}`,
          ratingCount: sql`${userRating.ratingCount} + 1`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ sum: userRating.ratingSum, count: userRating.ratingCount });

    // Always returned by the upsert above; the guard is for the type checker.
    if (!totals) throw new Error('user_rating upsert returned no row');

    await tx.insert(outbox).values({
      topic: config.kafka.ratingTopic,
      messageKey: grant.rateeId,
      payload: ratingUpdatedMessage(grant.rateeId, averageOf(totals.sum, totals.count), totals.count),
    });

    return {
      orderId,
      rateeId: grant.rateeId,
      rateeRole: grant.rateeRole,
      score: input.score,
      comment,
      createdAt: saved.createdAt.toISOString(),
    };
  });
}

export async function listPendingRatings(raterId: string): Promise<PendingRatingsResponse> {
  const rows = await db
    .select({
      orderId: ratingGrant.orderId,
      rateeId: ratingGrant.rateeId,
      rateeRole: ratingGrant.rateeRole,
      grantedAt: ratingGrant.grantedAt,
    })
    .from(ratingGrant)
    .leftJoin(
      rating,
      and(eq(rating.orderId, ratingGrant.orderId), eq(rating.raterId, ratingGrant.raterId)),
    )
    .where(and(eq(ratingGrant.raterId, raterId), isNull(rating.ratingId)))
    .orderBy(asc(ratingGrant.grantedAt));

  return {
    pending: rows.map((r) => ({ ...r, grantedAt: r.grantedAt.toISOString() })),
  };
}
