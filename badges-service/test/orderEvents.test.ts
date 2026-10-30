/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Tests for the order.status.changed handler.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import { describe, expect, it } from 'vitest';
import { handleOrderEvent } from '../src/messaging/orderEvents.js';
import { badgeState, countedOrder, db, disputedOrder, metricsOf, orderMessage } from './helpers.js';

const send = (message: Record<string, unknown>) => handleOrderEvent(JSON.stringify(message));

describe('handleOrderEvent', () => {
  it('counts a delivered order for the courier and the requester, and awards their first badges', async () => {
    const message = orderMessage();
    expect(await send(message)).toBe('counted');

    expect(await metricsOf(message.courierId as string)).toMatchObject({ completedDeliveries: 1, completedOrders: 0 });
    expect(await metricsOf(message.requesterId as string)).toMatchObject({ completedDeliveries: 0, completedOrders: 1 });
    expect(await badgeState(message.courierId as string, 'first_delivery')).toBe('earned');
    expect(await badgeState(message.requesterId as string, 'first_order')).toBe('earned');
  });

  it('counts an order only once as it moves through later counted statuses', async () => {
    const message = orderMessage();
    expect(await send(message)).toBe('counted');
    expect(await send({ ...message, eventId: 'later', fromStatus: 'DELIVERED', toStatus: 'ACKNOWLEDGED' })).toBe(
      'duplicate',
    );
    expect(await send({ ...message, eventId: 'last', fromStatus: 'ACKNOWLEDGED', toStatus: 'COMPLETED' })).toBe(
      'duplicate',
    );
    expect(await metricsOf(message.courierId as string)).toMatchObject({ completedDeliveries: 1 });
  });

  it('treats a redelivered message as a duplicate', async () => {
    const raw = JSON.stringify(orderMessage());
    expect(await handleOrderEvent(raw)).toBe('counted');
    expect(await handleOrderEvent(raw)).toBe('duplicate');
    expect(await db.select().from(countedOrder)).toHaveLength(2);
  });

  it('counts the same user in both roles when they accepted their own order', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    expect(await send(orderMessage({ requesterId: userId, courierId: userId }))).toBe('counted');
    expect(await metricsOf(userId)).toMatchObject({ completedDeliveries: 1, completedOrders: 1 });
  });

  it('counts only the requester when no courier is on the message', async () => {
    const message = orderMessage({ courierId: null, toStatus: 'COMPLETED' });
    expect(await send(message)).toBe('counted');
    expect(await db.select().from(countedOrder)).toHaveLength(1);
  });

  it('takes back a counted order when it is escalated, and revokes the badge it earned', async () => {
    const message = orderMessage();
    await send(message);
    expect(await badgeState(message.courierId as string, 'first_delivery')).toBe('earned');

    expect(await send({ ...message, eventId: 'esc', fromStatus: 'DELIVERED', toStatus: 'ESCALATED' })).toBe(
      'uncounted',
    );
    expect(await metricsOf(message.courierId as string)).toMatchObject({ completedDeliveries: 0 });
    expect(await metricsOf(message.requesterId as string)).toMatchObject({ completedOrders: 0 });
    expect(await badgeState(message.courierId as string, 'first_delivery')).toBe('revoked');
    expect(await db.select().from(countedOrder)).toHaveLength(0);
  });

  it('never counts a disputed order, even once it is resolved to COMPLETED', async () => {
    const message = orderMessage({ fromStatus: 'COLLECTED', toStatus: 'ESCALATED' });
    expect(await send(message)).toBe('disputed');
    expect(await db.select().from(disputedOrder)).toHaveLength(1);

    expect(await send({ ...message, eventId: 'done', fromStatus: 'UNDER_REVIEW', toStatus: 'COMPLETED' })).toBe(
      'disputed',
    );
    expect(await db.select().from(countedOrder)).toHaveLength(0);
  });

  it('records a repeated escalation once', async () => {
    const message = orderMessage({ toStatus: 'ESCALATED' });
    await send(message);
    expect(await send(message)).toBe('disputed');
    expect(await db.select().from(disputedOrder)).toHaveLength(1);
  });

  it.each(['CREATED', 'ACCEPTED', 'COLLECTED', 'UNDER_REVIEW', 'EXPIRED', 'CANCELLED'])(
    'ignores %s',
    async (toStatus) => {
      expect(await send(orderMessage({ toStatus }))).toBe('ignored');
      expect(await db.select().from(countedOrder)).toHaveLength(0);
    },
  );

  it('ignores other event types and JSON that is not an object', async () => {
    expect(await send(orderMessage({ eventType: 'order.something.else' }))).toBe('ignored');
    expect(await handleOrderEvent('null')).toBe('ignored');
  });

  it.each([
    ['non-JSON', 'not json'],
    ['a non-UUID requesterId', JSON.stringify(orderMessage({ requesterId: 'alice@u.nus.edu' }))],
    ['an unknown status', JSON.stringify(orderMessage({ toStatus: 'LOST' }))],
    ['a missing orderId', JSON.stringify(orderMessage({ orderId: undefined }))],
    ['schemaVersion 2', JSON.stringify(orderMessage({ schemaVersion: 2 }))],
  ])('rejects %s as invalid', async (_label, raw) => {
    expect(await handleOrderEvent(raw)).toBe('invalid');
    expect(await db.select().from(countedOrder)).toHaveLength(0);
  });

  it('accepts and ignores extra fields', async () => {
    expect(await send(orderMessage({ somethingNew: true }))).toBe('counted');
  });
});
