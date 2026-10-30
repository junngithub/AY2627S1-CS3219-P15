import { AppError } from "./errors";

export function supportText(value: unknown, field: "comment" | "message"): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 4000) throw new AppError(400, "INVALID_SUPPORT_TEXT", `${field} must contain 1 to 4000 characters`);
  return text;
}

// Best-effort single-process guard for the public credential-checking route.
// All supplied emails share the same rules, including unknown ones. Entries
// are bounded and expire; distributed ingress throttling is still required.
export class AppealAttemptLimiter {
  private readonly attempts = new Map<string, { count: number; expires: number }>();
  constructor(private readonly now = Date.now, private readonly maxAttempts = 10,
    private readonly windowMs = 15 * 60_000, private readonly maxEntries = 10_000) {}

  check(key: string): void {
    const time = this.now();
    let entry = this.attempts.get(key);
    if (entry && entry.expires <= time) { this.attempts.delete(key); entry = undefined; }
    if (entry && entry.count >= this.maxAttempts) throw new AppError(429, "TOO_MANY_APPEAL_ATTEMPTS", "Too many appeal attempts. Please try again later");
    if (!entry) {
      for (const [existingKey, existing] of this.attempts) if (existing.expires <= time) this.attempts.delete(existingKey);
      if (this.attempts.size >= this.maxEntries) {
        // Fail closed instead of evicting live entries and allowing targeted
        // guesses to bypass the limit by cycling through other addresses.
        throw new AppError(429, "TOO_MANY_APPEAL_ATTEMPTS", "Too many appeal attempts. Please try again later");
      }
      entry = { count: 0, expires: time + this.windowMs };
      this.attempts.set(key, entry);
    }
    entry.count++;
  }
}
