import createError from '@fastify/error';

// Domain errors (@fastify/error): stable code + message template + HTTP status.
// The error handler in app.ts sends them as { error: message, code }.

export const RatingNotPermittedError = createError(
  'RATING_NOT_PERMITTED',
  'You have no rating to give for order %s',
  403,
);

export const RatingAlreadySubmittedError = createError(
  'RATING_ALREADY_SUBMITTED',
  'You have already rated order %s',
  409,
);
