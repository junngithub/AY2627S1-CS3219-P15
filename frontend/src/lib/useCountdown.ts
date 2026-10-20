/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated a countdown hook shared by the resend cooldown and, later,
 *        the order deadlines (UI FR7.3, NFR5.1.1).
 * Reviewed by Ngooi Jun Sen.
 */

import { useEffect, useState } from 'react';

/**
 * Seconds remaining until `deadline`, recomputed from the clock on every tick
 * rather than by subtracting 1. A tab that is backgrounded and throttled
 * therefore shows the correct value as soon as it is visible again, instead of
 * drifting behind (UI NFR5.1.1).
 *
 * Pass null to stop the timer.
 */
export function useCountdown(deadline: number | null): number {
  const [secondsLeft, setSecondsLeft] = useState(() => remaining(deadline));

  useEffect(() => {
    if (deadline === null) {
      setSecondsLeft(0);
      return;
    }

    setSecondsLeft(remaining(deadline));
    const id = window.setInterval(() => {
      const left = remaining(deadline);
      setSecondsLeft(left);
      if (left <= 0) window.clearInterval(id);
    }, 1000);

    return () => window.clearInterval(id);
  }, [deadline]);

  return secondsLeft;
}

function remaining(deadline: number | null): number {
  if (deadline === null) return 0;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

/** Formats seconds as m:ss, as the mockup shows ("Resend email in 0:52"). */
export function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Same clock, longer horizon: "23:58" once an hour or more is left, "18:24"
 * below that. The mockups use both on the My requests page - an
 * acknowledgement deadline a day out, and an acceptance window minutes away -
 * and the unit is read from the scale, as it is on a kitchen timer.
 */
export function formatDeadline(totalSeconds: number): string {
  if (totalSeconds >= 3600) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${hours}:${minutes.toString().padStart(2, '0')}`;
  }
  return formatCountdown(totalSeconds);
}
