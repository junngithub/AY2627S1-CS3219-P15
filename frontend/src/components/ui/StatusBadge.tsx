/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the order status badge used by My requests, and later by
 *        My deliveries and the order detail page.
 * Reviewed by Ngooi Jun Sen.
 */

import styles from './StatusBadge.module.css';

/**
 * The eleven order-service states, as displayed. Accepted, Collected,
 * Unacknowledged, Under review, Completed and Cancelled appear in no mockup.
 */
export type OrderStatus =
  | 'Created'
  | 'Accepted'
  | 'Collected'
  | 'Delivered'
  | 'Acknowledged'
  | 'Unacknowledged'
  | 'Escalated'
  | 'Under review'
  | 'Completed'
  | 'Expired'
  | 'Cancelled';

/**
 * Colour carries meaning here, so it is never the only signal: the word is
 * always present (UI NFR8).
 */
const TONES: Record<OrderStatus, string> = {
  Created: 'accent',
  Accepted: 'accent',
  Collected: 'accent',
  Delivered: 'success',
  Acknowledged: 'success',
  Completed: 'success',
  Unacknowledged: 'warning',
  Escalated: 'danger',
  'Under review': 'warning',
  Expired: 'neutral',
  Cancelled: 'neutral',
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={[styles.badge, styles[TONES[status]]].join(' ')}>{status}</span>;
}
