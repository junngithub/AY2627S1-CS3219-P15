import { type Static, Type } from '@sinclair/typebox';

// Each schema is both the runtime JSON Schema and, via Static<>, the TS type.

export const Uuid = Type.String({
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
});

export const Role = Type.Union([Type.Literal('COURIER'), Type.Literal('REQUESTER')]);
export type Role = Static<typeof Role>;

// Permissive so other request headers pass; only x-user-id is required.
export const MeHeaders = Type.Object({
  'x-user-id': Uuid,
});
export type MeHeaders = Static<typeof MeHeaders>;

export const UserParams = Type.Object({ userId: Uuid });
export type UserParams = Static<typeof UserParams>;

export const OrderParams = Type.Object({ orderId: Uuid });
export type OrderParams = Static<typeof OrderParams>;

// GET /:userId. average is null until the user has at least one rating, so a
// caller never mistakes "no ratings" for a 0-star average (F3.1.1).
export const UserRatingResponse = Type.Object({
  userId: Uuid,
  average: Type.Union([Type.Number(), Type.Null()]),
  count: Type.Integer(),
});
export type UserRatingResponse = Static<typeof UserRatingResponse>;

export const SubmitRatingBody = Type.Object(
  {
    score: Type.Integer({ minimum: 1, maximum: 5 }),
    comment: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);
export type SubmitRatingBody = Static<typeof SubmitRatingBody>;

export const SubmitRatingResponse = Type.Object({
  orderId: Uuid,
  rateeId: Uuid,
  rateeRole: Role,
  score: Type.Integer(),
  comment: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
});
export type SubmitRatingResponse = Static<typeof SubmitRatingResponse>;

// Grants the caller has not used yet, so the rating modal (UI FR14) knows what to ask.
export const PendingRatingsResponse = Type.Object({
  pending: Type.Array(
    Type.Object({
      orderId: Uuid,
      rateeId: Uuid,
      rateeRole: Role,
      grantedAt: Type.String({ format: 'date-time' }),
    }),
  ),
});
export type PendingRatingsResponse = Static<typeof PendingRatingsResponse>;
