/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5), date: 2026-09-28; wired to
 *       GET /api/v1/orders/deliveries/active and /past with Claude Code
 *       (Claude Opus 5.5) on 2026-10-21
 * Scope: Generated the My deliveries list. No mockup exists, so it follows
 *        UI FR9, which writes one set of rules for both order lists.
 * Reviewed by Ngooi Jun Sen.
 *
 * FR9.1.1 Active and History tabs, each from its own endpoint; FR9.1.2
 * newest request first (both endpoints sort that way); FR9.2.1 a desktop
 * table, FR9.2.2 mobile cards with prominent status pills.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '../components/ui/Alert';
import { StatusBadge } from '../components/ui/StatusBadge';
import { errorMessage } from '../lib/api';
import { formatWhen } from '../lib/format';
import { fetchActiveDeliveries, fetchPastDeliveries, type Order } from '../lib/orders';
import { formatDeadline, useCountdown } from '../lib/useCountdown';
import styles from '../components/order/orderList.module.css';

/** The clock a row waits on, and what to call it. */
function deadlineFor(row: Order): { at: Date; label: string; overdue: string } | null {
  if (row.status === 'Accepted' && row.collectionDeadline) {
    return { at: row.collectionDeadline, label: 'Collect within', overdue: 'Collection window closed' };
  }
  if (row.status === 'Collected') {
    return { at: row.deliveryDeadline, label: 'Deliver within', overdue: 'Delivery deadline passed' };
  }
  if (row.status === 'Delivered' && row.acknowledgementDeadline) {
    // After this the credits are released to the courier anyway.
    return { at: row.acknowledgementDeadline, label: 'Credits release in', overdue: 'Credits releasing' };
  }
  return null;
}

/** Its own component because each row runs its own clock. */
function StatusCell({ row }: { row: Order }) {
  const deadline = deadlineFor(row);
  const secondsLeft = useCountdown(deadline ? deadline.at.getTime() : null);

  let detail: string | null = null;
  if (deadline) {
    detail = secondsLeft > 0 ? `${deadline.label} ${formatDeadline(secondsLeft)}` : deadline.overdue;
  }

  return (
    <div className={styles.status}>
      <StatusBadge status={row.status} />
      {detail ? <span className={styles.statusDetail}>{detail}</span> : null}
    </div>
  );
}

type Tab = 'active' | 'history';

export function MyDeliveriesPage() {
  const [active, setActive] = useState<Order[]>([]);
  const [history, setHistory] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('active');

  useEffect(() => {
    let cancelled = false;
    // Both up front, so each tab shows its count before it is opened.
    Promise.all([fetchActiveDeliveries(), fetchPastDeliveries()])
      .then(([activePage, pastPage]) => {
        if (cancelled) return;
        setActive(activePage.orders);
        setHistory(pastPage.orders);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(errorMessage(error, 'Could not reach the Order Service. Try again in a moment.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = tab === 'active' ? active : history;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          My deliveries
          <span className={styles.subtitle}>
            newest first &middot; {active.length + history.length} total
          </span>
        </h1>

        <Link to="/browse" className={styles.newButton}>
          Browse requests
        </Link>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Delivery status">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'active'}
          className={tab === 'active' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => setTab('active')}
        >
          Active <span className={styles.tabCount}>{active.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'history'}
          className={tab === 'history' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => setTab('history')}
        >
          History <span className={styles.tabCount}>{history.length}</span>
        </button>
      </div>

      {loadError ? (
        <Alert variant="danger">{loadError}</Alert>
      ) : loading ? (
        <p className={styles.emptyBody}>Loading your deliveries…</p>
      ) : rows.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>
            {tab === 'active' ? 'Nothing in progress' : 'No past deliveries'}
          </p>
          <p className={styles.emptyBody}>
            {tab === 'active'
              ? 'Tasks you accept show here until you deliver them.'
              : 'Deliveries move here once you mark them delivered.'}
          </p>
          <Link to="/browse" className={styles.newButton}>
            Browse requests
          </Link>
        </div>
      ) : (
        <div className={styles.table} role="table" aria-label="My deliveries">
          <div className={styles.headRow} role="row">
            <span role="columnheader">Item</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Requester</span>
            <span role="columnheader" className={styles.rewardHead}>
              Earn
            </span>
          </div>

          {rows.map((row) => (
            <Link key={row.id} to={`/deliveries/${row.id}`} className={styles.row} role="row">
              <div className={styles.itemCell} role="cell">
                <span className={styles.item}>{row.item}</span>
                <span className={styles.route}>
                  {row.pickup.name} &rarr; {row.dropoff.name} &middot; {formatWhen(row.requestedAt)}
                </span>
              </div>

              <div role="cell">
                <StatusCell row={row} />
              </div>

              <div className={styles.courier} role="cell">
                <span className={styles.cellLabel}>Requester</span>
                {/* TODO(order-service): the requester's name - orders carry ids
                    and Telegram handles only. */}
                {row.requesterTelegramHandle !== null ? `@${row.requesterTelegramHandle}` : '—'}
              </div>

              <div className={styles.reward} role="cell">
                <span className={styles.cellLabel}>Earn</span>
                {row.credits}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
