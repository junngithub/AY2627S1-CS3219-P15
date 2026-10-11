import { eq, sql } from 'drizzle-orm';
import { db } from '../database/index.js';
import { creditLog, creditOrder, creditUser } from '../database/schema.js';
import {
  InsufficientCreditsError,
  InvalidAmountError,
  OrderAlreadyReservedError,
  OrderNotFoundError,
  UserNotFoundError,
} from '../errors.js';
import type {
  BalanceResponse,
  ReleaseResponse,
  ReserveBody,
  ReserveResponse,
} from '../schemas/credit.js';

export async function getBalance(userId: string): Promise<BalanceResponse> {
  const [row] = await db
    .select({ balance: creditUser.balance })
    .from(creditUser)
    .where(eq(creditUser.userId, userId));

  if (!row) throw new UserNotFoundError(userId);
  return { userId, balance: row.balance };
}

export async function reserveCredits(input: ReserveBody): Promise<ReserveResponse> {
  const { orderId, requesterId, amount } = input;

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new InvalidAmountError(amount);
  }

  return db.transaction(async (tx) => {
    // Lock the requester's row so concurrent reserves cannot double-spend.
    const [user] = await tx
      .select({ balance: creditUser.balance })
      .from(creditUser)
      .where(eq(creditUser.userId, requesterId))
      .for('update');

    if (!user) throw new UserNotFoundError(requesterId);
    if (user.balance < amount) {
      throw new InsufficientCreditsError(amount, user.balance);
    }

    // A PK conflict means this order already holds a reservation.
    const reserved = await tx
      .insert(creditOrder)
      .values({ orderId, requesterId, reservedCredits: amount })
      .onConflictDoNothing()
      .returning({ orderId: creditOrder.orderId });

    if (reserved.length === 0) throw new OrderAlreadyReservedError(orderId);

    const newBalance = user.balance - amount;
    await tx
      .update(creditUser)
      .set({ balance: newBalance, updatedAt: sql`now()` })
      .where(eq(creditUser.userId, requesterId));

    await tx.insert(creditLog).values({
      operationType: 'RESERVATION',
      amount,
      actorId: requesterId,
      orderId,
      balanceAfter: newBalance,
    });

    return { orderId, requesterId, reserved: amount, balance: newBalance };
  });
}

export async function releaseCredits(orderId: string): Promise<ReleaseResponse> {
  return db.transaction(async (tx) => {
    // Deleting the reservation also validates that it exists (F5.1.1).
    const [order] = await tx
      .delete(creditOrder)
      .where(eq(creditOrder.orderId, orderId))
      .returning({
        requesterId: creditOrder.requesterId,
        reservedCredits: creditOrder.reservedCredits,
      });

    if (!order) throw new OrderNotFoundError(orderId);

    const [updated] = await tx
      .update(creditUser)
      .set({
        balance: sql`${creditUser.balance} + ${order.reservedCredits}`,
        updatedAt: sql`now()`,
      })
      .where(eq(creditUser.userId, order.requesterId))
      .returning({ balance: creditUser.balance });

    /* v8 ignore next -- defensive: the FK guarantees the requester row exists */
    if (!updated) throw new UserNotFoundError(order.requesterId);

    await tx.insert(creditLog).values({
      operationType: 'RETURN',
      amount: order.reservedCredits,
      actorId: order.requesterId,
      orderId,
      balanceAfter: updated.balance,
    });

    return {
      orderId,
      requesterId: order.requesterId,
      refunded: order.reservedCredits,
      balance: updated.balance,
    };
  });
}

// F2 onboarding: create a credit account (starting balance 20) for a verified
// user, exactly once. Driven by the foc.user.status `UserVerified` event (see
// src/kafka/). Structurally idempotent — the credit_user PK + ON CONFLICT DO
// NOTHING makes a redelivered event a no-op, even under concurrent delivery.
export async function onboardUser(userId: string, eventId: string | null = null): Promise<void> {
  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(creditUser)
      .values({ userId })
      .onConflictDoNothing()
      .returning({ userId: creditUser.userId });

    // Already onboarded (or a redelivered event): nothing to do, no second log.
    if (!created) return;

    await tx.insert(creditLog).values({
      operationType: 'ONBOARDING',
      amount: 20, // the starting grant; balance defaults to 20 in the schema
      actorId: userId,
      balanceAfter: 20,
      eventId, // traceability back to the source event
    });
  });
}

// F4 order events — implemented later.
/* v8 ignore start -- stubs, coverage added when implemented */
export async function completeOrder(_orderId: string, _courierId: string): Promise<void> {
  throw new Error('completeOrder: not implemented');
}

export async function cancelOrder(_orderId: string): Promise<void> {
  throw new Error('cancelOrder: not implemented');
}
/* v8 ignore stop */
