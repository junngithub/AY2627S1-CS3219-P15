/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the distance and elapsed-time formatters used by the task
 *        pool cards.
 * Reviewed by Ngooi Jun Sen.
 */

// "280 m" below a kilometre, "1.1 km" above it, as the mockups show.
export function formatDistance(metres: number): string {
  if (metres < 1000) {
    return `${Math.round(metres)} m`;
  }
  return `${(metres / 1000).toFixed(1)} km`;
}

/**
 * Derived from the clock on every call rather than counted down, so a tab left
 * open in the background shows the right elapsed time when it comes back
 */
export function formatElapsed(since: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 1000));

  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  return `${Math.floor(hours / 24)} d ago`;
}

export function formatRating(rating: number): string {
  return rating.toFixed(1);
}

// Value shape a datetime-local input expects: "2026-09-27T15:30".
export function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

// Null rather than an Invalid Date, so callers have one thing to check.
export function parseLocalInput(value: string): Date | null {
  if (value === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}


export function formatWhen(date: Date, now: Date = new Date()): string {
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  const midnightToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.floor((date.getTime() - midnightToday.getTime()) / 86_400_000);

  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`;
}


export function formatUntil(date: Date, now: Date = new Date()): string {
  const minutes = Math.round((date.getTime() - now.getTime()) / 60_000);
  if (minutes < 1) return 'in the past';
  if (minutes < 60) return `${minutes} min from now`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h from now`;
  return `${Math.round(hours / 24)} d from now`;
}
