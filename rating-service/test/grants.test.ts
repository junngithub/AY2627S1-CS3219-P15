import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { handleRatingCommand } from '../src/messaging/grants.js';
import { db, grantMessage, ratingGrant } from './helpers.js';

describe('handleRatingCommand', () => {
  it('stores a grant from a valid rating.permission.granted message', async () => {
    const message = grantMessage();
    expect(await handleRatingCommand(JSON.stringify(message))).toBe('granted');

    const [row] = await db
      .select()
      .from(ratingGrant)
      .where(eq(ratingGrant.orderId, message.orderId as string));
    expect(row).toMatchObject({
      raterId: message.raterId,
      raterRole: 'COURIER',
      rateeId: message.rateeId,
      rateeRole: 'REQUESTER',
      eventId: message.eventId,
    });
  });

  it('treats a redelivered message as a duplicate', async () => {
    const raw = JSON.stringify(grantMessage());
    expect(await handleRatingCommand(raw)).toBe('granted');
    expect(await handleRatingCommand(raw)).toBe('duplicate');
    expect(await db.select().from(ratingGrant)).toHaveLength(1);
  });

  it('accepts and ignores extra fields', async () => {
    const raw = JSON.stringify(grantMessage({ somethingNew: true }));
    expect(await handleRatingCommand(raw)).toBe('granted');
  });

  it('ignores other event types on the topic', async () => {
    const raw = JSON.stringify(grantMessage({ eventType: 'rating.something.else' }));
    expect(await handleRatingCommand(raw)).toBe('ignored');
  });

  it.each([
    ['non-JSON', 'not json'],
    ['a wrong role', JSON.stringify(grantMessage({ raterRole: 'ADMIN' }))],
    ['a missing rateeId', JSON.stringify(grantMessage({ rateeId: undefined }))],
    ['a non-UUID orderId', JSON.stringify(grantMessage({ orderId: '42' }))],
    ['schemaVersion 2', JSON.stringify(grantMessage({ schemaVersion: 2 }))],
  ])('rejects %s as invalid', async (_label, raw) => {
    expect(await handleRatingCommand(raw)).toBe('invalid');
    expect(await db.select().from(ratingGrant)).toHaveLength(0);
  });

  it('ignores JSON that is not an object', async () => {
    expect(await handleRatingCommand('null')).toBe('ignored');
  });
});
