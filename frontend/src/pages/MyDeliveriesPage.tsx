/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5), date: 2026-09-28
 * Scope: Generated the My deliveries list. No mockup exists, so it follows
 *        UI FR9, which writes one set of rules for both order lists.
 * Reviewed by Ngooi Jun Sen.
 *
 * FR9.1.1 Active and History tabs, FR9.1.2 newest request first, FR9.2.1 a
 * desktop table, FR9.2.2 mobile cards with prominent status pills.
 *
 * TODO(order-service): no endpoint lists the orders you are delivering
 * (GET /api/v1/orders/mine is requester-only), so the list below is commented
 * out and the page says so. Once an endpoint exists, load it the way
 * MyRequestsPage does and restore the table. A task you have just accepted is
 * still reachable from the link on the Browse page.
 */

import { Link } from 'react-router-dom';
import styles from '../components/order/orderList.module.css';

export function MyDeliveriesPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>My deliveries</h1>
      </header>

      <div className={styles.empty}>
        <p className={styles.emptyTitle}>Not available yet</p>
        <p className={styles.emptyBody}>
          The Order Service cannot list the errands you are delivering yet. After you accept a
          task, open it from the link on the Browse page.
        </p>
        <Link to="/browse" className={styles.newButton}>
          Browse requests
        </Link>
      </div>

      {/*
        Restore once the Order Service lists a courier's orders:

        <div className={styles.tabs} role="tablist" aria-label="Delivery status">
          ... Active / History tabs, as in MyRequestsPage ...
        </div>

        <div className={styles.table} role="table" aria-label="My deliveries">
          <div className={styles.headRow} role="row">
            <span role="columnheader">Item</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Requester</span>
            <span role="columnheader" className={styles.rewardHead}>Earn</span>
          </div>

          {rows.map((row) => (
            <Link key={row.id} to={`/deliveries/${row.id}`} className={styles.row} role="row">
              <div className={styles.itemCell} role="cell">
                <span className={styles.item}>{row.item}</span>
                <span className={styles.route}>
                  {row.pickup.name} &rarr; {row.dropoff.name} &middot; {formatWhen(row.requestedAt)}
                </span>
              </div>
              <div role="cell"><StatusCell row={row} /></div>
              <div className={styles.courier} role="cell">
                <span className={styles.cellLabel}>Requester</span>
                {row.requesterName}   (TODO(order-service): no names yet)
              </div>
              <div className={styles.reward} role="cell">
                <span className={styles.cellLabel}>Earn</span>
                {row.credits}
              </div>
            </Link>
          ))}
        </div>

        StatusCell counts down to the collection deadline while Accepted, the
        delivery deadline while Collected and the acknowledgement deadline
        while Delivered.
      */}
    </div>
  );
}
