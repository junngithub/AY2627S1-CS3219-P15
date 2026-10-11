import { onboardUser } from '../services/credit.service.js';
import { asUuid, parseObject } from './messages.js';

// The foc.user.status envelope, as published by the user service:
// { eventId, type, occurredAt, data: { userId, email } }. Declared independently
// here (no shared package across the service boundary) and parsed defensively —
// anything unexpected is skipped, not trusted.
interface UserVerifiedData {
  userId?: unknown;
  email?: unknown;
}

/**
 * Parse and apply one `foc.user.status` message.
 *
 * Malformed or unknown messages are logged and skipped (we return normally so
 * the consumer commits the offset — a poison message must not wedge the
 * partition). A DB error, by contrast, propagates so the caller leaves the
 * offset uncommitted and the message is retried (at-least-once delivery).
 */
export async function handleUserStatusMessage(
  rawValue: string | null,
  log: (message: string) => void = console.warn,
): Promise<void> {
  const envelope = parseObject(rawValue);
  if (!envelope) {
    log('user.status: empty, non-JSON or non-object message, skipping');
    return;
  }

  if (envelope.type !== 'UserVerified') {
    log(`user.status: ignoring event type ${String(envelope.type)}`);
    return;
  }

  const data = (envelope.data ?? {}) as UserVerifiedData;
  const userId = asUuid(data.userId);
  if (!userId) {
    log('user.status: UserVerified with missing/invalid userId, skipping');
    return;
  }

  await onboardUser(userId, asUuid(envelope.eventId));
}
