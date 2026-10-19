/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5), date: 2026-09-28; wired to
 *       GET /api/v1/orders/deliveries with Claude Code (Claude Opus 5.5) on
 *       2026-10-20
 * Scope: Generated the My deliveries list. No mockup exists, so it follows
 *        UI FR9, which writes one set of rules for both order lists.
 * Reviewed by Ngooi Jun Sen.
 *
 * FR9.1.1 Active and History tabs, FR9.2.1 a desktop table, FR9.2.2 mobile
 * cards with prominent status pills. FR9.1.2 asks for newest request first;
 * the endpoint orders by last update instead, which for finished deliveries
 * is close enough.
 *
 * TODO(order-service): the endpoint lists only Delivered, Acknowledged,
 * Unacknowledged and Completed orders. Active therefore shows deliveries
 * awaiting the requester's acknowledgement, not tasks still being collected
 * or carried; those stay reachable from the link on Browse.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '../components/ui/Alert';
import { StatusBadge } from '../components/ui/StatusBadge';
import { errorMessage } from '../lib/api';
import { formatWhen } from '../lib/format';
import { fetchMyDeliveries, isActiveStatus, type Order } from '../lib/orders';
import { formatDeadline, useCountdown } from '../lib/useCountdown';
import styles from '../components/order/orderList.module.css';

/**
 * Its own component because each row runs its own clock. Only Delivered rows
 * have one: the requester's acknowledgement deadline, after which the credits
 * are released to the courier anyway.
 */
function StatusCell({ row }: { row: Order }) {
  const deadline = row.status === 'Delivered' ? row.acknowledgementDeadline : null;
  const secondsLeft = useCountdown(deadline ? deadline.getTime() : null);

  let detail: string | null = null;
  if (deadline) {
    detail =
      secondsLeft > 0
        ? `Credits release in ${formatDeadline(secondsLeft)}`
        : 'Credits releasing';
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
  const [allRows, setAllRows] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('history');

  useEffect(() => {
    let cancelled = false;
    fetchMyDeliveries()
      .then((page) => {
        if (cancelled) return;
        setAllRows(page.orders);
        setTotal(page.total);
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

  // UI FR9.1.1: ongoing and settled orders are separated.
  const { active, history } = useMemo(
    () => ({
      active: allRows.filter((row) => isActiveStatus(row.status)),
      history: allRows.filter((row) => !isActiveStatus(row.status)),
    }),
    [allRows],
  );

  const rows = tab === 'active' ? active : history;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          My deliveries
          <span className={styles.subtitle}>recently updated first &middot; {total} total</span>
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
          Awaiting acknowledgement <span className={styles.tabCount}>{active.length}</span>
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
            {tab === 'active' ? 'Nothing awaiting acknowledgement' : 'No past deliveries'}
          </p>
          <p className={styles.emptyBody}>
            {tab === 'active'
              ? 'Deliveries show here once you mark them delivered. Tasks you are still collecting or carrying are not listed yet; open them from Browse.'
              : 'Deliveries appear here once the requester acknowledges them, or the acknowledgement window closes.'}
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
