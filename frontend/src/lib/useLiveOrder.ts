/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-11
 * Scope: Generated the hook both order pages use to load an order and keep it
 *        current while the other party acts on it.
 * Reviewed by Ngooi Jun Sen.
 *
 * Refresh on returning to the tab, and the 5-second interval, added with
 * Claude Code (Claude Opus 5.5) on 2026-10-22.
 */

import { useEffect, useState } from 'react';
import { errorMessage } from './api';
import { fetchOrder, isActiveStatus, type Order } from './orders';

/**
 * How often an open order page re-reads the order. The requester and the
 * courier act on the same order from different screens, and nothing pushes
 * changes, so without this one side keeps showing a state that has moved on
 * (an order acknowledged from Collected still offering "mark delivered").
 * Order F2.13 promises status alerts within a minute; this is well inside it.
 */
const REFRESH_MS = 5_000;

interface LiveOrder {
  order: Order | null;
  loadError: string | null;
  /** Replace the order after an action, so the page does not wait a cycle. */
  setOrder: (order: Order) => void;
}

export function useLiveOrder(orderId: string): LiveOrder {
  const [order, setOrder] = useState<Order | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // First load, and reset when the route moves to another order.
  useEffect(() => {
    let cancelled = false;
    setOrder(null);
    setLoadError(null);
    fetchOrder(orderId)
      .then((result) => {
        if (!cancelled) setOrder(result);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Order answers 404 for an order that is missing or not yours.
        setLoadError(errorMessage(error, 'Could not reach the Order Service. Try again in a moment.'));
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  // Keep it current while it can still change. A settled order (acknowledged,
  // completed, expired, cancelled) stops polling.
  const active = order !== null && isActiveStatus(order.status);
  useEffect(() => {
    if (!active) return undefined;
    const refresh = () => {
      fetchOrder(orderId)
        .then(setOrder)
        .catch(() => {
          // Keep showing the last good copy; a real failure surfaces on the
          // next action the user takes.
        });
    };
    const timer = window.setInterval(() => {
      // Skip hidden tabs; they catch up the moment they are shown again.
      if (document.visibilityState === 'visible') refresh();
    }, REFRESH_MS);
    // Coming back to the tab (e.g. after acting as the other party in another
    // tab) refreshes at once instead of showing a stale timeline until the
    // next tick.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [orderId, active]);

  return { order, loadError, setOrder };
}
