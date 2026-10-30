/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Tests for the user.rating.updated handler.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import { describe, expect, it } from 'vitest';
import { handleRatingEvent } from '../src/messaging/ratingEvents.js';
import { badgeState, metricsOf, ratingMessage } from './helpers.js';

const send = (message: Record<string, unknown>) => handleRatingEvent(JSON.stringify(message));

describe('handleRatingEvent', () => {
  it('stores the average and count and awards the rating badge', async () => {
    const message = ratingMessage({ newAverage: 4.7, totalRatings: 12 });
    expect(await send(message)).toBe('updated');
    expect(await metricsOf(message.userId as string)).toMatchObject({ averageRating: 4.7, ratingCount: 12 });
    expect(await badgeState(message.userId as string, 'trusted_user')).toBe('earned');
  });

  it('revokes the rating badge when a newer message drops the average', async () => {
    const userId = '22222222-2222-4222-8222-222222222222';
    await send(ratingMessage({ userId, newAverage: 4.6, totalRatings: 10 }));
    expect(await send(ratingMessage({ userId, newAverage: 4.2, totalRatings: 11 }))).toBe('updated');
    expect(await badgeState(userId, 'trusted_user')).toBe('revoked');
  });

  it('ignores an older or redelivered message, whatever order they arrive in', async () => {
    const userId = '33333333-3333-4333-8333-333333333333';
    await send(ratingMessage({ userId, newAverage: 4.0, totalRatings: 5 }));
    expect(await send(ratingMessage({ userId, newAverage: 5, totalRatings: 4 }))).toBe('stale');
    expect(await send(ratingMessage({ userId, newAverage: 5, totalRatings: 5 }))).toBe('stale');
    expect(await metricsOf(userId)).toMatchObject({ averageRating: 4.0, ratingCount: 5 });
  });

  it('keeps the order counts already stored for the user', async () => {
    const userId = '44444444-4444-4444-8444-444444444444';
    await send(ratingMessage({ userId, totalRatings: 1 }));
    expect(await metricsOf(userId)).toMatchObject({ completedDeliveries: 0, completedOrders: 0 });
  });

  it('ignores other event types and JSON that is not an object', async () => {
    expect(await send(ratingMessage({ eventType: 'rating.permission.granted' }))).toBe('ignored');
    expect(await handleRatingEvent('null')).toBe('ignored');
  });

  it.each([
    ['non-JSON', 'not json'],
    ['a non-UUID userId', JSON.stringify(ratingMessage({ userId: 'bob' }))],
    ['an average above 5', JSON.stringify(ratingMessage({ newAverage: 6 }))],
    ['a fractional count', JSON.stringify(ratingMessage({ totalRatings: 1.5 }))],
  ])('rejects %s as invalid', async (_label, raw) => {
    expect(await handleRatingEvent(raw)).toBe('invalid');
  });
});
