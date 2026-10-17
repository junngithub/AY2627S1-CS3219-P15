import { hashSessionToken, safeHashEqual } from "./security";

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function serviceTokenMatches(provided: string | undefined, expected: string): boolean {
  return Boolean(provided && expected) && safeHashEqual(hashSessionToken(provided!), hashSessionToken(expected));
}

export function testVerificationAllowed(enabled: string | undefined, environment: string): boolean {
  return enabled === "true" && ["local", "development", "dev", "test", "staging", "stg"].includes(environment);
}
