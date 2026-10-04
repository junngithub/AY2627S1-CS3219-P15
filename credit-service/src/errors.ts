import createError from '@fastify/error';

// Domain errors (@fastify/error): stable code + message template + HTTP status.
// Fastify serialises them as { statusCode, code, error, message }.

export const UserNotFoundError = createError(
  'CREDIT_USER_NOT_FOUND',
  'User %s does not exist',
  404,
);

export const InvalidAmountError = createError(
  'CREDIT_INVALID_AMOUNT',
  'Amount must be a positive integer (received %s)',
  400,
);

export const InsufficientCreditsError = createError(
  'CREDIT_INSUFFICIENT_BALANCE',
  'Insufficient credits: requested %s, available %s',
  409,
);

export const OrderAlreadyReservedError = createError(
  'CREDIT_ORDER_ALREADY_RESERVED',
  'Order %s already has an active reservation',
  409,
);

export const OrderNotFoundError = createError(
  'CREDIT_ORDER_NOT_FOUND',
  'Order %s has no active reservation',
  404,
);
