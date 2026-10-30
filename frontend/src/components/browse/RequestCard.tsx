/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5), date: 2026-09-27
 * Scope: Generated the task pool card from the desktop and mobile home
 *        mockups.
 * Reviewed by Ngooi Jun Sen.
 *
 * The two viewports order the same facts differently: desktop leads with the
 * route, mobile leads with the item. Rather than render two components, the
 * pieces are laid out with grid areas that the breakpoint redefines, and the
 * two facts that move between lines (distance, elapsed time) are written twice
 * and shown one at a time.
 */

import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { formatDistance, formatElapsed, formatRating } from '../../lib/format';
import { formatDeadline, useCountdown } from '../../lib/useCountdown';
import type { Order } from '../../lib/orders';
import styles from './RequestCard.module.css';

interface RequestCardProps {
  request: Order;
  /** Metres from the courier to the pickup, or null with no location. */
  distanceMetres: number | null;
  accepting: boolean;
  onAccept: (orderId: string) => void;
}

export function RequestCard({ request, distanceMetres, accepting, onAccept }: RequestCardProps) {
  const distance = distanceMetres === null ? null : formatDistance(distanceMetres);
  const elapsed = formatElapsed(request.requestedAt);

  // UI FR5.5.2: the acceptance expiry belongs on the card. Under five minutes
  // it turns urgent, the same idea as FR7.3.2 on the order page.
  const secondsLeft = useCountdown(request.acceptanceExpiry.getTime());
  const urgent = secondsLeft > 0 && secondsLeft <= 300;

  return (
    <article className={styles.card}>
      <p className={styles.route}>
        {request.pickup.name}
        <Icon name="arrowRight" size={14} />
        {request.dropoff.name}
        {distance ? <span className={styles.routeSuffix}> &middot; {distance}</span> : null}
      </p>

      <p className={styles.meta}>
        {distance ? <>{distance} &middot; </> : null}posted {elapsed}
      </p>

      <h3 className={styles.item}>{request.item}</h3>

      <p className={[styles.expiry, urgent ? styles.expiryUrgent : ''].filter(Boolean).join(' ')}>
        {secondsLeft > 0 ? `Expires in ${formatDeadline(secondsLeft)}` : 'Expired'}
      </p>

      <p className={styles.reward}>
        <span className={styles.amount}>{request.credits}</span>
        <span className={styles.unit}>cr</span>
        <span className="visually-hidden">credits</span>
      </p>

      <div className={styles.footer}>
        <span className={styles.requester}>
          {/* TODO(order-service): the requester's name - orders carry ids only.
          {request.requesterName} &middot;{' '} */}
          {request.requesterRating !== null ? (
            <span className={styles.rating}>
              <Icon name="star" size={13} filled />
              {formatRating(request.requesterRating)}
            </span>
          ) : (
            'New requester'
          )}
          <span className={styles.footerElapsed}> &middot; {elapsed}</span>
        </span>

        {/*
          The pool only returns other users' orders (Order F4), so there is no
          "your request" state to show here.
        */}
        <Button
          onClick={() => onAccept(request.id)}
          loading={accepting}
          className={styles.accept}
        >
          {accepting ? 'Accepting...' : 'Accept'}
        </Button>
      </div>
    </article>
  );
}
