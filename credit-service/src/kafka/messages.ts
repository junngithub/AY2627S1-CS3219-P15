// Parsing shared by the Kafka handlers. Messages come from other services, so
// nothing is trusted: a value that isn't the expected shape is skipped.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The message value as a JSON object, or null if it is empty, not JSON, or JSON
// that isn't an object — e.g. `null`, which would otherwise make the handler
// throw and the consumer retry the message forever.
export function parseObject(rawValue: string | null): Record<string, unknown> | null {
  if (!rawValue) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return null;
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

export function asUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value) ? value : null;
}
