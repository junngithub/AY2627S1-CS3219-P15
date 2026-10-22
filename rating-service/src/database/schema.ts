import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const ratingRole = pgEnum('rating_role', ['COURIER', 'REQUESTER']);

// One row per rating.permission.granted message from Order Service: this rater
// may rate this ratee for this order. The PK makes redelivery a no-op.
export const ratingGrant = pgTable(
  'rating_grant',
  {
    orderId: uuid('order_id').notNull(),
    raterId: uuid('rater_id').notNull(),
    raterRole: ratingRole('rater_role').notNull(),
    rateeId: uuid('ratee_id').notNull(),
    rateeRole: ratingRole('ratee_role').notNull(),
    eventId: uuid('event_id').notNull().unique(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.raterId] })],
);

// Raw submissions, kept for disputes or recomputing (F1.2). One per grant (NFR2.1).
export const rating = pgTable(
  'rating',
  {
    ratingId: bigserial('rating_id', { mode: 'number' }).primaryKey(),
    orderId: uuid('order_id').notNull(),
    raterId: uuid('rater_id').notNull(),
    raterRole: ratingRole('rater_role').notNull(),
    rateeId: uuid('ratee_id').notNull(),
    rateeRole: ratingRole('ratee_role').notNull(),
    score: smallint('score').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('rating_order_rater_unique').on(t.orderId, t.raterId),
    index('rating_ratee_idx').on(t.rateeId),
    check('rating_score_range', sql`${t.score} between 1 and 5`),
  ],
);

// Running totals: one unified average per user, whichever role they were rated in.
export const userRating = pgTable(
  'user_rating',
  {
    userId: uuid('user_id').primaryKey(),
    ratingSum: integer('rating_sum').notNull().default(0),
    ratingCount: integer('rating_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('user_rating_sum_nonneg', sql`${t.ratingSum} >= 0`),
    check('user_rating_count_nonneg', sql`${t.ratingCount} >= 0`),
  ],
);

// Transactional outbox: written in the same transaction as the rating, so
// user.rating.updated is published only after the write commits (F4.1.1).
export const outbox = pgTable(
  'outbox',
  {
    outboxId: bigserial('outbox_id', { mode: 'number' }).primaryKey(),
    topic: text('topic').notNull(),
    messageKey: text('message_key').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [index('outbox_unsent_idx').on(t.outboxId).where(sql`${t.sentAt} is null`)],
);

export type RatingGrant = typeof ratingGrant.$inferSelect;
export type NewRatingGrant = typeof ratingGrant.$inferInsert;
export type Rating = typeof rating.$inferSelect;
export type UserRating = typeof userRating.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;
