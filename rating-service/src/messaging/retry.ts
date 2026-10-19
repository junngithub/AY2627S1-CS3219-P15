export type RetryResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

// Runs fn up to maxAttempts times, waiting a little longer after each failure.
// Never throws: the caller decides what to do with a message that kept failing.
export async function withRetries<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  onFailure: (error: unknown, attempt: number) => void,
  baseDelayMs = 200,
): Promise<RetryResult<T>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return { ok: true, value: await fn() };
    } catch (error) {
      lastError = error;
      onFailure(error, attempt);
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
      }
    }
  }
  return { ok: false, error: lastError };
}
