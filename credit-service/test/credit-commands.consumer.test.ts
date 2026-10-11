import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { handleCreditCommandMessage } from '../src/kafka/creditCommandsHandler.js';
import { creditLog, creditOrder, creditUser, db, seedOrder, seedUser } from './helpers.js';

// Shaped like order-service's OrderMessageFactory: a flat envelope keyed by order.
function release(
  orderId: string,
  courierId: string,
  { eventId = randomUUID(), reason = 'ACKNOWLEDGED', amount = 5 } = {},
): string {
  return JSON.stringify({
    eventId,
    eventType: 'credit.reservation.release',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    orderId,
    requesterId: randomUUID(),
    courierId,
    amount,
    reason,
  });
}

function returned(orderId: string, { eventId = randomUUID(), reason = 'EXPIRED' } = {}): string {
  return JSON.stringify({
    eventId,
    eventType: 'credit.reservation.return',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    orderId,
    requesterId: randomUUID(),
    amount: 5,
    reason,
  });
}

// Silence expected warnings from the skip paths.
const silent = (): void => undefined;

async function balanceOf(userId: string): Promise<number | undefined> {
  const [row] = await db
    .select({ balance: creditUser.balance })
    .from(creditUser)
    .where(eq(creditUser.userId, userId));
  return row?.balance;
}

const logsFor = (orderId: string) =>
  db.select().from(creditLog).where(eq(creditLog.orderId, orderId));

async function isReserved(orderId: string): Promise<boolean> {
  const rows = await db.select().from(creditOrder).where(eq(creditOrder.orderId, orderId));
  return rows.length === 1;
}

// A requester who reserved 5 of their 20 credits, and an onboarded courier.
async function seedReservation(): Promise<{ requester: string; courier: string; orderId: string }> {
  const requester = await seedUser(15);
  const courier = await seedUser(20);
  const orderId = await seedOrder(requester, 5);
  return { requester, courier, orderId };
}

describe('handleCreditCommandMessage (foc.credit.commands → settlement)', () => {
  it.each(['ACKNOWLEDGED', 'UNACKNOWLEDGED'])(
    'release (%s) pays the reservation to the courier with a COMPLETION log',
    async (reason) => {
      const { requester, courier, orderId } = await seedReservation();
      const eventId = randomUUID();

      await handleCreditCommandMessage(release(orderId, courier, { eventId, reason }));

      expect(await isReserved(orderId)).toBe(false);
      expect(await balanceOf(courier)).toBe(25);
      expect(await balanceOf(requester)).toBe(15);
      const logs = await logsFor(orderId);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        operationType: 'COMPLETION',
        amount: 5,
        actorId: courier,
        balanceAfter: 25,
        eventId,
      });
    },
  );

  it('return with reason EXPIRED refunds the requester with an EXPIRY log', async () => {
    const { requester, courier, orderId } = await seedReservation();
    const eventId = randomUUID();

    await handleCreditCommandMessage(returned(orderId, { eventId }));

    expect(await isReserved(orderId)).toBe(false);
    expect(await balanceOf(requester)).toBe(20);
    expect(await balanceOf(courier)).toBe(20);
    const logs = await logsFor(orderId);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      operationType: 'EXPIRY',
      amount: 5,
      actorId: requester,
      balanceAfter: 20,
      eventId,
    });
  });

  it('return with any other reason is a CANCELLATION', async () => {
    const { requester, orderId } = await seedReservation();

    await handleCreditCommandMessage(returned(orderId, { reason: 'CANCELLED' }));

    expect(await balanceOf(requester)).toBe(20);
    expect((await logsFor(orderId))[0]?.operationType).toBe('CANCELLATION');
  });

  it('moves the reserved amount, not the amount in the message', async () => {
    const { courier, orderId } = await seedReservation();

    await handleCreditCommandMessage(release(orderId, courier, { amount: 999 }));

    expect(await balanceOf(courier)).toBe(25);
    expect((await logsFor(orderId))[0]?.amount).toBe(5);
  });

  it('is idempotent: a redelivered command settles the order once', async () => {
    const { courier, orderId } = await seedReservation();
    const message = release(orderId, courier);
    const log = vi.fn();

    await handleCreditCommandMessage(message, log); // first delivery
    await handleCreditCommandMessage(message, log); // exact redelivery
    await handleCreditCommandMessage(release(orderId, courier), log); // same order, new eventId

    expect(await balanceOf(courier)).toBe(25);
    expect(await logsFor(orderId)).toHaveLength(1);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('no active reservation'));
  });

  it('settles an order once when release and return collide: first one wins', async () => {
    const { requester, courier, orderId } = await seedReservation();

    await handleCreditCommandMessage(release(orderId, courier));
    await handleCreditCommandMessage(returned(orderId), silent);

    expect(await balanceOf(courier)).toBe(25);
    expect(await balanceOf(requester)).toBe(15);
    const logs = await logsFor(orderId);
    expect(logs.map((l) => l.operationType)).toEqual(['COMPLETION']);
  });

  it('fails without changing anything when the courier has no credit account', async () => {
    const requester = await seedUser(15);
    const orderId = await seedOrder(requester, 5);
    const unknownCourier = randomUUID();

    // Thrown so the consumer retries; the transaction rolls back, keeping the
    // reservation. No account is created for the courier.
    await expect(
      handleCreditCommandMessage(release(orderId, unknownCourier)),
    ).rejects.toMatchObject({ code: 'CREDIT_USER_NOT_FOUND' });

    expect(await isReserved(orderId)).toBe(true);
    expect(await balanceOf(requester)).toBe(15);
    expect(await balanceOf(unknownCourier)).toBeUndefined();
    expect(await logsFor(orderId)).toHaveLength(0);
  });

  it('persists a null event_id when the command omits one', async () => {
    const { courier, orderId } = await seedReservation();
    const message = JSON.parse(release(orderId, courier)) as Record<string, unknown>;
    delete message.eventId;

    await handleCreditCommandMessage(JSON.stringify(message));

    expect((await logsFor(orderId))[0]?.eventId).toBeNull();
  });

  it('skips malformed or unknown commands without writing rows or throwing', async () => {
    const { courier, orderId } = await seedReservation();
    const log = vi.fn();
    const withoutCourier = JSON.parse(release(orderId, courier)) as Record<string, unknown>;
    delete withoutCourier.courierId;

    for (const raw of [
      null,
      '',
      'not json at all',
      'null',
      '[1, 2]',
      '42',
      JSON.stringify({ eventType: 'credit.reservation.hold', orderId }),
      JSON.stringify({ eventType: 'credit.reservation.return' }),
      JSON.stringify({ eventType: 'credit.reservation.return', orderId: 'not-a-uuid' }),
      JSON.stringify(withoutCourier),
      release(orderId, 'not-a-uuid'),
    ]) {
      await handleCreditCommandMessage(raw, log);
    }

    expect(log).toHaveBeenCalledTimes(11);
    expect(await isReserved(orderId)).toBe(true);
    expect(await logsFor(orderId)).toHaveLength(0);
  });
});
