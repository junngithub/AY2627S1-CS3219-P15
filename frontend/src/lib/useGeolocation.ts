/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5), date: 2026-09-28
 * Scope: Generated the browser geolocation hook used by the task pool.
 * Reviewed by Ngooi Jun Sen.
 *
 * Order F4.2 ranks the pool by pickup proximity to the courier, and F4.3
 * falls back to reward-only ordering when location is denied or unavailable.
 * No service stores a location: `GET /api/v1/orders` takes latitude and
 * longitude as query parameters, so obtaining them is the frontend's job.
 */

import { useCallback, useEffect, useState } from 'react';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export type GeolocationStatus =
  /** Not asked yet: the user has to press something first. */
  | 'idle'
  | 'locating'
  | 'granted'
  /** Refused, either now or previously. */
  | 'denied'
  /** No geolocation in this browser, or the attempt failed or timed out. */
  | 'unavailable';

interface GeolocationState {
  status: GeolocationStatus;
  coordinates: Coordinates | null;
  /** Ask the browser. Safe to call again after a denial. */
  request: () => void;
}

export function useGeolocation(): GeolocationState {
  const [status, setStatus] = useState<GeolocationStatus>('idle');
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);

  const request = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unavailable');
      return;
    }

    setStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setStatus('granted');
      },
      (error) => {
        setStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  /*
   * Only ask on load if permission was already given. A permission prompt on
   * first visit, before the person has done anything, is the kind of thing
   * people refuse out of hand - and a refusal is sticky. The Permissions API
   * lets us check without prompting; where it is missing (Safari), the page
   * simply waits for the button.
   */
  useEffect(() => {
    let cancelled = false;

    if (!('permissions' in navigator)) return undefined;

    navigator.permissions
      .query({ name: 'geolocation' })
      .then((permission) => {
        if (cancelled) return;
        if (permission.state === 'granted') request();
        if (permission.state === 'denied') setStatus('denied');
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [request]);

  return { status, coordinates, request };
}
