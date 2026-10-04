import { type Static, Type } from '@sinclair/typebox';

// Each schema is both the runtime JSON Schema and, via Static<>, the TS type.

const Uuid = Type.String({
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
});

export const ReserveBody = Type.Object(
  {
    orderId: Uuid,
    requesterId: Uuid,
    amount: Type.Integer(),
  },
  { additionalProperties: false },
);
export type ReserveBody = Static<typeof ReserveBody>;

export const ReleaseBody = Type.Object(
  { orderId: Uuid },
  { additionalProperties: false },
);
export type ReleaseBody = Static<typeof ReleaseBody>;

// Permissive so other request headers pass; only x-user-id is required.
export const MeHeaders = Type.Object({
  'x-user-id': Uuid,
});
export type MeHeaders = Static<typeof MeHeaders>;

export const BalanceResponse = Type.Object({
  userId: Uuid,
  balance: Type.Integer(),
});
export type BalanceResponse = Static<typeof BalanceResponse>;

export const ReserveResponse = Type.Object({
  orderId: Uuid,
  requesterId: Uuid,
  reserved: Type.Integer(),
  balance: Type.Integer(),
});
export type ReserveResponse = Static<typeof ReserveResponse>;

export const ReleaseResponse = Type.Object({
  orderId: Uuid,
  requesterId: Uuid,
  refunded: Type.Integer(),
  balance: Type.Integer(),
});
export type ReleaseResponse = Static<typeof ReleaseResponse>;
