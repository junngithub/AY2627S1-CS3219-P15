/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Generated TypeBox schemas for the two consumed messages.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import { type Static, Type } from '@sinclair/typebox';
import { Uuid } from '../schemas/badges.js';

// Messages use the flat catalog format from the API contract:
// { eventId, eventType, schemaVersion, occurredAt, ...fields }. Extra fields are
// allowed and ignored, so publishers can add fields without breaking Badges.

export const ORDER_STATUS_CHANGED = 'order.status.changed';
export const USER_RATING_UPDATED = 'user.rating.updated';

export const OrderStatus = Type.Union(
  [
    'CREATED',
    'ACCEPTED',
    'COLLECTED',
    'DELIVERED',
    'ACKNOWLEDGED',
    'UNACKNOWLEDGED',
    'ESCALATED',
    'UNDER_REVIEW',
    'EXPIRED',
    'CANCELLED',
    'COMPLETED',
  ].map((status) => Type.Literal(status)),
);

// From foc.order.status. Order Service builds it in OrderMessageFactory.statusChanged.
export const OrderStatusChanged = Type.Object({
  eventId: Type.String(),
  eventType: Type.Literal(ORDER_STATUS_CHANGED),
  schemaVersion: Type.Literal(1),
  occurredAt: Type.String(),
  orderId: Uuid,
  requesterId: Uuid,
  courierId: Type.Union([Uuid, Type.Null()]),
  fromStatus: Type.Union([OrderStatus, Type.Null()]),
  toStatus: OrderStatus,
});
export type OrderStatusChanged = Static<typeof OrderStatusChanged>;

// From foc.user.rating. Rating Service builds it in ratingUpdatedMessage: the
// user's whole current average and count, not a delta.
export const UserRatingUpdated = Type.Object({
  eventId: Type.String(),
  eventType: Type.Literal(USER_RATING_UPDATED),
  schemaVersion: Type.Literal(1),
  occurredAt: Type.String(),
  userId: Uuid,
  newAverage: Type.Union([Type.Number({ minimum: 0, maximum: 5 }), Type.Null()]),
  totalRatings: Type.Integer({ minimum: 0 }),
});
export type UserRatingUpdated = Static<typeof UserRatingUpdated>;
