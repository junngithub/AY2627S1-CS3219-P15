import { eq, sql } from 'drizzle-orm';
import { db, type Database } from '../database/index.js';
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

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

// The requester-side refunds: the HTTP return (F5.2) and the cancel / expiry
// events (F4.2). Delete-once, per docs/schema.md: the reservation is deleted
// first and the requester credited only if it existed. Returns null when the
// order has no active reservation.
async function refundRequester(
  tx: Transaction,
  orderId: string,
  operationType: 'RETURN' | 'CANCELLATION' | 'EXPIRY',
  eventId: string | null,
): Promise<Omit<ReleaseResponse, 'orderId'> | null> {
  const [order] = await tx
    .delete(creditOrder)
    .where(eq(creditOrder.orderId, orderId))
    .returning({
      requesterId: creditOrder.requesterId,
      reservedCredits: creditOrder.reservedCredits,
    });

  if (!order) return null;

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
    operationType,
    amount: order.reservedCredits,
    actorId: order.requesterId,
    orderId,
    balanceAfter: updated.balance,
    eventId,
  });

  return {
    requesterId: order.requesterId,
    refunded: order.reservedCredits,
    balance: updated.balance,
  };
}

export async function releaseCredits(orderId: string): Promise<ReleaseResponse> {
  return db.transaction(async (tx) => {
    // Deleting the reservation also validates that it exists (F5.1.1).
    const refund = await refundRequester(tx, orderId, 'RETURN', null);
    if (!refund) throw new OrderNotFoundError(orderId);
    return { orderId, ...refund };
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

// F4 order events, driven by the order service's foc.credit.commands (see
// src/kafka/). Each returns true if it settled the reservation, or false if the
// order had none — already settled, so a redelivered command is a no-op.

// F4.3 completion: pay the order's reserved credits to its courier. The courier
// must already have a credit account (created at onboarding): if not, this
// throws, and the transaction rolls back with the reservation intact for a
// retry. An account is never created here.
// TODO: add retry + DLQ
export async function completeOrder(
  orderId: string,
  courierId: string,
  eventId: string | null = null,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .delete(creditOrder)
      .where(eq(creditOrder.orderId, orderId))
      .returning({ reservedCredits: creditOrder.reservedCredits });

    if (!order) return false;

    const [courier] = await tx
      .update(creditUser)
      .set({
        balance: sql`${creditUser.balance} + ${order.reservedCredits}`,
        updatedAt: sql`now()`,
      })
      .where(eq(creditUser.userId, courierId))
      .returning({ balance: creditUser.balance });

    if (!courier) throw new UserNotFoundError(courierId);

    await tx.insert(creditLog).values({
      operationType: 'COMPLETION',
      amount: order.reservedCredits,
      actorId: courierId,
      orderId,
      balanceAfter: courier.balance,
      eventId,
    });
    return true;
  });
}

// F4.2 cancellation / expiry: refund the order's reserved credits to its requester.
export async function cancelOrder(
  orderId: string,
  operationType: 'CANCELLATION' | 'EXPIRY',
  eventId: string | null = null,
): Promise<boolean> {
  return db.transaction(
    async (tx) => (await refundRequester(tx, orderId, operationType, eventId)) !== null,
  );
}
