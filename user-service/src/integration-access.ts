export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function testVerificationAllowed(enabled: string | undefined, environment: string): boolean {
  return enabled === "true" && ["local", "development", "dev", "test", "staging", "stg"].includes(environment);
}
