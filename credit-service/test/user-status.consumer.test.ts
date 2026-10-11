import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { handleUserStatusMessage } from '../src/kafka/userStatusHandler.js';
import { creditLog, creditUser, db } from './helpers.js';

function userVerified(userId: string, eventId: string = randomUUID()): string {
  return JSON.stringify({
    eventId,
    type: 'UserVerified',
    occurredAt: new Date().toISOString(),
    data: { userId, email: 'student@u.nus.edu' },
  });
}

// Silence expected warnings from the skip paths.
const silent = (): void => undefined;

describe('handleUserStatusMessage (UserVerified → onboarding)', () => {
  it('creates a credit_user with balance 20 and an ONBOARDING log', async () => {
    const userId = randomUUID();
    const eventId = randomUUID();

    await handleUserStatusMessage(userVerified(userId, eventId));

    const [user] = await db.select().from(creditUser).where(eq(creditUser.userId, userId));
    expect(user?.balance).toBe(20);

    const [log] = await db.select().from(creditLog).where(eq(creditLog.actorId, userId));
    expect(log?.operationType).toBe('ONBOARDING');
    expect(log?.amount).toBe(20);
    expect(log?.balanceAfter).toBe(20);
    expect(log?.eventId).toBe(eventId);
  });

  it('is idempotent: redelivery does not duplicate the account or the log', async () => {
    const userId = randomUUID();
    const message = userVerified(userId);

    await handleUserStatusMessage(message); // first delivery
    await handleUserStatusMessage(message); // exact redelivery
    await handleUserStatusMessage(userVerified(userId)); // same user, new eventId

    expect(await db.select().from(creditUser).where(eq(creditUser.userId, userId))).toHaveLength(1);
    expect(await db.select().from(creditLog).where(eq(creditLog.actorId, userId))).toHaveLength(1);
  });

  it('persists a null event_id when the envelope omits one', async () => {
    const userId = randomUUID();
    await handleUserStatusMessage(
      JSON.stringify({ type: 'UserVerified', data: { userId } }),
    );

    const [log] = await db.select().from(creditLog).where(eq(creditLog.actorId, userId));
    expect(log?.operationType).toBe('ONBOARDING');
    expect(log?.eventId).toBeNull();
  });

  it('ignores unknown event types without writing rows or throwing', async () => {
    const userId = randomUUID();
    await handleUserStatusMessage(
      JSON.stringify({ eventId: randomUUID(), type: 'UserSuspended', data: { userId } }),
      silent,
    );
    expect(await db.select().from(creditUser)).toHaveLength(0);
  });

  it('skips a non-JSON message without throwing', async () => {
    await handleUserStatusMessage('not json at all', silent);
    expect(await db.select().from(creditUser)).toHaveLength(0);
  });

  it('skips an empty message without throwing', async () => {
    await handleUserStatusMessage(null, silent);
    expect(await db.select().from(creditUser)).toHaveLength(0);
  });

  it('skips a UserVerified with a missing or malformed userId', async () => {
    await handleUserStatusMessage(
      JSON.stringify({ eventId: randomUUID(), type: 'UserVerified', data: {} }),
      silent,
    );
    await handleUserStatusMessage(
      JSON.stringify({ eventId: randomUUID(), type: 'UserVerified', data: { userId: 'nope' } }),
      silent,
    );
    expect(await db.select().from(creditUser)).toHaveLength(0);
  });
});
