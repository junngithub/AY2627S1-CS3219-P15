/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5), date: 2026-09-28
 * Scope: Generated the My requests list from the desktop mockup, with the
 *        mobile layout inferred.
 * Reviewed by Ngooi Jun Sen.
 *
 * Covers UI FR9 from GET /api/v1/orders/mine (Order F5), newest first.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '../components/ui/Alert';
import { StatusBadge } from '../components/ui/StatusBadge';
import { errorMessage } from '../lib/api';
import { formatWhen } from '../lib/format';
import { fetchMyRequests, isActiveStatus, type Order } from '../lib/orders';
import { formatDeadline, useCountdown } from '../lib/useCountdown';
import styles from '../components/order/orderList.module.css';

/** The clock a row waits on: acceptance while Created, acknowledgement after. */
function deadlineFor(order: Order): Date | null {
  if (order.status === 'Created') return order.acceptanceExpiry;
  if (order.status === 'Collected' || order.status === 'Delivered') {
    return order.acknowledgementDeadline;
  }
  return null;
}

/**
 * Its own component because each row runs its own clock, and a hook cannot be
 * called inside a loop in the page.
 */
function StatusCell({ row }: { row: Order }) {
  const deadline = deadlineFor(row);
  const secondsLeft = useCountdown(deadline ? deadline.getTime() : null);

  let detail: string | null = null;
  if (deadline) {
    if (secondsLeft <= 0) {
      // The list is a snapshot; the service decides what the state becomes.
      detail = row.status === 'Created' ? 'Expired' : 'Deadline passed';
    } else {
      const verb = row.status === 'Created' ? 'Expires in' : 'Acknowledge in';
      detail = `${verb} ${formatDeadline(secondsLeft)}`;
    }
  }

  return (
    <div className={styles.status}>
      <StatusBadge status={row.status} />
      {detail ? <span className={styles.statusDetail}>{detail}</span> : null}
    </div>
  );
}

type Tab = 'active' | 'history';

export function MyRequestsPage() {
  const [allRows, setAllRows] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('active');

  useEffect(() => {
    let cancelled = false;
    fetchMyRequests()
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
          My requests
          <span className={styles.subtitle}>newest first &middot; {total} total</span>
        </h1>

        {/* The mockup puts the only route to UI FR6 here. */}
        <Link to="/requests/new" className={styles.newButton}>
          + New request
        </Link>
      </header>

      {/*
        UI FR9.1.1. Not in the mockup, which shows one undivided list; the
        requirement is explicit, so the tabs are here and the mockup needs
        updating or the requirement dropping.
      */}
      <div className={styles.tabs} role="tablist" aria-label="Request status">
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
        <p className={styles.emptyBody}>Loading your requests…</p>
      ) : rows.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>
            {tab === 'active' ? 'Nothing in progress' : 'No past requests'}
          </p>
          <p className={styles.emptyBody}>
            {tab === 'active'
              ? 'Post an errand and a courier nearby can pick it up.'
              : 'Requests appear here once they are acknowledged, expired or cancelled.'}
          </p>
          {tab === 'active' ? (
            <Link to="/requests/new" className={styles.newButton}>
              + New request
            </Link>
          ) : null}
        </div>
      ) : (
        <div className={styles.table} role="table" aria-label="My requests">
          <div className={styles.headRow} role="row">
            <span role="columnheader">Item</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Courier</span>
            <span role="columnheader" className={styles.rewardHead}>
              Reward
            </span>
          </div>

          {rows.map((row) => (
            <Link key={row.id} to={`/orders/${row.id}`} className={styles.row} role="row">
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
                <span className={styles.cellLabel}>Courier</span>
                {/* TODO(order-service): the courier's name - orders carry ids only.
                {row.courierName ?? '—'} */}
                {row.courierId !== null ? 'Assigned' : '—'}
              </div>

              <div className={styles.reward} role="cell">
                <span className={styles.cellLabel}>Reward</span>
                {row.credits}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
