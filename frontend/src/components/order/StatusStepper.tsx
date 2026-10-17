/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5), date: 2026-09-28
 * Scope: Generated the order progress stepper: a tab strip on mobile, a
 *        vertical list in the desktop status panel.
 * Reviewed by Ngooi Jun Sen.
 */

import type { OrderStatus } from '../ui/StatusBadge';
import styles from './StatusStepper.module.css';

/**
 * UI FR7.1.1's happy path. Order F2 also has Under Review, Completed,
 * Cancelled and Expired, which are not points on this line - the mockup calls
 * them branch states and shows them separately.
 */
const STEPS: { status: OrderStatus; long: string; short: string }[] = [
  { status: 'Created', long: 'Created', short: 'Created' },
  { status: 'Accepted', long: 'Accepted', short: 'Accepted' },
  { status: 'Collected', long: 'Collected', short: 'Collected' },
  { status: 'Delivered', long: 'Delivered', short: 'Delivered' },
  { status: 'Acknowledged', long: 'Acknowledged', short: "Ack'd" },
];

const BRANCH_STATES: OrderStatus[] = [
  'Escalated',
  'Under review',
  'Expired',
  'Cancelled',
  'Unacknowledged',
];

interface StatusStepperProps {
  status: OrderStatus;
  /** Sub-line under the current step, e.g. "14:02 - 4 credits reserved". */
  currentDetail?: string;
}

export function StatusStepper({ status, currentDetail }: StatusStepperProps) {
  // A branch state leaves the line, so nothing after the last reached step
  // should look complete.
  const onBranch = BRANCH_STATES.includes(status);
  const activeIndex = onBranch ? -1 : STEPS.findIndex((step) => step.status === status);

  return (
    <ol className={styles.stepper}>
      {STEPS.map((step, index) => {
        const reached = activeIndex >= 0 && index <= activeIndex;
        const current = index === activeIndex;

        return (
          <li
            key={step.status}
            className={[styles.step, reached ? styles.reached : '', current ? styles.current : '']
              .filter(Boolean)
              .join(' ')}
            aria-current={current ? 'step' : undefined}
          >
            <span className={styles.marker} aria-hidden="true" />
            <span className={styles.labelLong}>{step.long}</span>
            <span className={styles.labelShort}>{step.short}</span>
            {current && currentDetail ? <span className={styles.detail}>{currentDetail}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
