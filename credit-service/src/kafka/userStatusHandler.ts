import { onboardUser } from '../services/credit.service.js';

// The foc.user.status envelope, as published by the user service. Declared
// independently here (no shared package across the service boundary) and parsed
// defensively — anything unexpected is skipped, not trusted.
interface EventEnvelope {
  eventId?: unknown;
  type?: unknown;
  occurredAt?: unknown;
  data?: unknown;
}

interface UserVerifiedData {
  userId?: unknown;
  email?: unknown;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!rawValue) {
    log('user.status: empty message, skipping');
    return;
  }

  let envelope: EventEnvelope;
  try {
    envelope = JSON.parse(rawValue) as EventEnvelope;
  } catch {
    log('user.status: non-JSON message, skipping');
    return;
  }

  if (envelope.type !== 'UserVerified') {
    log(`user.status: ignoring event type ${String(envelope.type)}`);
    return;
  }

  const data = (envelope.data ?? {}) as UserVerifiedData;
  const userId = data.userId;
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) {
    log('user.status: UserVerified with missing/invalid userId, skipping');
    return;
  }

  const eventId =
    typeof envelope.eventId === 'string' && UUID_RE.test(envelope.eventId)
      ? envelope.eventId
      : null;

  await onboardUser(userId, eventId);
}
