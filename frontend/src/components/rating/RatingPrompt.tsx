/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-21
 * Scope: Generated the app-wide prompt that opens the rating dialog.
 * Reviewed by Ngooi Jun Sen.
 *
 * UI FR14.1.1: the dialog appears by itself once a rating is owed. Order
 * Service grants it when an order is delivered (the courier rates the
 * requester) and when it is acknowledged or unacknowledged (the requester
 * rates the courier). Unacknowledged happens on a timer, possibly while the
 * requester is elsewhere in the app, so the prompt lives in the app shell
 * rather than on the order page.
 *
 * Limited to once per session with Claude Code (Claude Opus 5.5) on
 * 2026-11-03: after one prompt closes, older waiting ratings wait for the next
 * session instead of opening one after another (lib/rating.ts readPromptedAt).
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { fetchOrder } from '../../lib/orders';
import { isSkipped, markPrompted, readPromptedAt, skipRating, usePendingRatings } from '../../lib/rating';
import { RatingDialog } from './RatingDialog';

interface OrderContext {
  orderId: string;
  item: string | null;
  rateeHandle: string | null;
}

export function RatingPrompt() {
  const { user } = useAuth();
  const pending = usePendingRatings();
  // Skips made in this tab, so the next prompt shows without waiting for the Rating Service.
  const [skippedHere, setSkippedHere] = useState<string[]>([]);
  const [context, setContext] = useState<OrderContext | null>(null);

  const userId = user?.userId ?? null;
  // Once the prompt has closed this session, only ratings granted after that open it again.
  const [promptedAt, setPromptedAt] = useState<number | null>(() =>
    userId === null ? null : readPromptedAt(userId),
  );
  useEffect(() => setPromptedAt(userId === null ? null : readPromptedAt(userId)), [userId]);

  const next =
    userId === null
      ? undefined
      : pending.find(
          (p) =>
            !skippedHere.includes(p.orderId) &&
            !isSkipped(userId, p.orderId) &&
            (promptedAt === null || p.grantedAt.getTime() > promptedAt),
        );

  function closed() {
    if (userId === null) return;
    const now = Date.now();
    markPrompted(userId, now);
    setPromptedAt(now);
  }

  // Name the order and the other person in the header, when the order loads.
  useEffect(() => {
    if (!next) return undefined;
    let cancelled = false;
    fetchOrder(next.orderId)
      .then((order) => {
        if (cancelled) return;
        setContext({
          orderId: next.orderId,
          item: order.item,
          rateeHandle:
            next.rateeRole === 'COURIER' ? order.courierTelegramHandle : order.requesterTelegramHandle,
        });
      })
      .catch(() => {
        // The dialog still works without the order's details.
      });
    return () => {
      cancelled = true;
    };
  }, [next?.orderId, next?.rateeRole]);

  if (userId === null || !next) return null;
  const details = context?.orderId === next.orderId ? context : null;

  return (
    <RatingDialog
      key={next.orderId}
      open
      orderId={next.orderId}
      rateeRole={next.rateeRole}
      item={details?.item ?? null}
      rateeHandle={details?.rateeHandle ?? null}
      onDone={() => {
        setContext(null);
        closed();
      }}
      onSkip={() => {
        // Saved by the Rating Service in the background; hidden here at once.
        void skipRating(userId, next.orderId);
        setSkippedHere((current) => [...current, next.orderId]);
        closed();
      }}
    />
  );
}
