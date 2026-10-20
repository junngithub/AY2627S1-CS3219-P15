import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// See docs/schema.md for the full design and requirement mapping (F1–F5).

export const creditOperation = pgEnum('credit_operation', [
  'ONBOARDING',
  'RESERVATION',
  'CANCELLATION',
  'EXPIRY',
  'COMPLETION',
  'RETURN',
]);

export const creditUser = pgTable(
  'credit_user',
  {
    userId: uuid('user_id').primaryKey(),
    balance: integer('balance').notNull().default(20),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('credit_user_balance_nonneg', sql`${t.balance} >= 0`)],
);

// Active reservations only — rows are hard-deleted when an order resolves.
export const creditOrder = pgTable(
  'credit_order',
  {
    orderId: uuid('order_id').primaryKey(),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => creditUser.userId),
    reservedCredits: integer('reserved_credits').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('credit_order_reserved_positive', sql`${t.reservedCredits} > 0`)],
);

// Append-only audit log.
export const creditLog = pgTable(
  'credit_log',
  {
    logId: bigserial('log_id', { mode: 'number' }).primaryKey(),
    operationType: creditOperation('operation_type').notNull(),
    amount: integer('amount').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => creditUser.userId),
    // Soft reference (nullable, no FK): orders are hard-deleted but logs persist.
    orderId: uuid('order_id'),
    balanceAfter: integer('balance_after').notNull(),
    eventId: uuid('event_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('credit_log_amount_positive', sql`${t.amount} > 0`),
    check('credit_log_balance_nonneg', sql`${t.balanceAfter} >= 0`),
  ],
);

export type CreditUser = typeof creditUser.$inferSelect;
export type NewCreditUser = typeof creditUser.$inferInsert;
export type CreditOrder = typeof creditOrder.$inferSelect;
export type NewCreditOrder = typeof creditOrder.$inferInsert;
export type CreditLog = typeof creditLog.$inferSelect;
export type NewCreditLog = typeof creditLog.$inferInsert;
