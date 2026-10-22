/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5), date: 2026-09-28; wired to order-service
 *       with Claude Code (Claude Opus 5.5) on 2026-10-10
 * Scope: Generated the order detail page from the "request created" desktop
 *        and mobile mockups, requester side.
 * Reviewed by Ngooi Jun Sen.
 *
 * Covers UI FR7 from GET /api/v1/orders/{orderId}. Created (cancel) and
 * Collected/Delivered (acknowledge) have actions; every other state renders
 * the same frame and says no action is available.
 */

import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { StatusStepper } from '../components/order/StatusStepper';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/Dialog';
import { StatusBadge } from '../components/ui/StatusBadge';
import { errorMessage } from '../lib/api';
import { refreshCreditBalance } from '../lib/credit';
import { formatWhen } from '../lib/format';
import { acknowledgeOrder, cancelOrder, type Order } from '../lib/orders';
import { expectNewRating } from '../lib/rating';
import { useLiveOrder } from '../lib/useLiveOrder';
import { formatDeadline, useCountdown } from '../lib/useCountdown';
import styles from './OrderDetailPage.module.css';

function clockTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function OrderDetailPage() {
  const { orderId = '' } = useParams();
  // Re-read every few seconds, so the courier's progress shows up here.
  const { order, loadError, setOrder } = useLiveOrder(orderId);

  if (loadError) {
    return (
      <div className={styles.page}>
        <Alert variant="danger">{loadError}</Alert>
        <Link to="/my-requests">Back to my requests</Link>
      </div>
    );
  }

  if (order === null) {
    return (
      <div className={styles.page}>
        <p className={styles.actionNote}>Loading the request…</p>
      </div>
    );
  }

  return <OrderDetail order={order} onChange={setOrder} />;
}

function OrderDetail({ order, onChange }: { order: Order; onChange: (order: Order) => void }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const secondsLeft = useCountdown(order.acceptanceExpiry.getTime());
  const showExpiry = order.status === 'Created' && secondsLeft > 0;
  const canCancel = order.status === 'Created';
  // Order F2.6: the requester acknowledges from Collected or Delivered.
  const canAcknowledge = order.status === 'Collected' || order.status === 'Delivered';

  const postedTime = clockTime(order.requestedAt);

  const run = useCallback(
    async (action: (orderId: string) => Promise<Order>) => {
      setBusy(true);
      setFailure(null);
      try {
        onChange(await action(order.id));
      } catch (error) {
        setFailure(errorMessage(error, 'Could not reach the Order Service. Try again in a moment.'));
      } finally {
        setBusy(false);
        // Cancelling returns the reserved credits; acknowledging settles them.
        void refreshCreditBalance();
      }
    },
    [order.id, onChange],
  );

  async function acknowledge() {
    await run(acknowledgeOrder);
    // Acknowledging lets the requester rate the courier (Order F2.6.3).
    expectNewRating();
  }

  async function confirmCancel() {
    await run(cancelOrder);
    setConfirmingCancel(false);
  }

  const actions = canCancel ? (
    // Order F2.8: the requester may cancel only while Created, and F2.8.3
    // releases the reservation synchronously. NFR9.1.1: confirm first.
    <Button variant="secondary" fullWidth loading={busy} onClick={() => setConfirmingCancel(true)}>
      Cancel request
    </Button>
  ) : canAcknowledge ? (
    <Button fullWidth loading={busy} onClick={acknowledge}>
      Acknowledge receipt
    </Button>
  ) : null;

  return (
    <div className={styles.page}>
      {/* Mobile header; the app nav is hidden on this route. */}
      <div className={styles.mobileHeader}>
        <Link to="/my-requests" className={styles.back} aria-label="Back to my requests">
          <span aria-hidden="true">&lsaquo;</span>
        </Link>
        <h1 className={styles.mobileTitle}>Request #{order.reference}</h1>
        <StatusBadge status={order.status} />
      </div>

      <div className={styles.stepperBar}>
        <StatusStepper status={order.status} />
      </div>

      <div className={styles.body}>
        <div className={styles.mainColumn}>
          <header className={styles.header}>
            <span className={styles.desktopBadge}>
              <StatusBadge status={order.status} />
            </span>
            <h1 className={styles.title}>{order.item}</h1>
            <p className={styles.posted}>
              Posted {postedTime} &middot; reward <strong>{order.credits} credits</strong>
            </p>
          </header>

          {failure ? <Alert variant="danger">{failure}</Alert> : null}

          {/* Mobile puts the expiry warning above the details; desktop keeps
              it in the status panel, next to the action it relates to. */}
          {showExpiry ? (
            <p className={styles.expiryMobile} role="status">
              Expires in {formatDeadline(secondsLeft)} if nobody accepts
            </p>
          ) : null}

          <section className={styles.detailsCard}>
            <div className={styles.detailBlock}>
              <h2 className={styles.detailLabel}>Pickup</h2>
              <p className={styles.detailValue}>{order.pickup.name}</p>
              {/* TODO(order-service): the supplier's location description is
                  not on the order; it would need a Supplier lookup by id.
              {order.pickupDetail ? <p className={styles.detailNote}>{order.pickupDetail}</p> : null} */}
            </div>

            <div className={styles.detailBlock}>
              <h2 className={styles.detailLabel}>Delivery</h2>
              <p className={styles.detailValue}>{order.dropoff.name}</p>
            </div>

            <div className={styles.detailBlock}>
              <h2 className={styles.detailLabel}>Delivery deadline</h2>
              <p className={styles.detailValue}>{formatWhen(order.deliveryDeadline)}</p>
            </div>

            <div className={styles.detailBlock}>
              <h2 className={styles.detailLabel}>Courier</h2>
              {/* TODO(order-service): the courier's name - orders carry ids only. */}
              {order.courierTelegramHandle ? (
                <a
                  className={styles.detailValue}
                  href={`https://t.me/${order.courierTelegramHandle}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Contact on Telegram
                </a>
              ) : (
                <p className={styles.detailValue}>
                  {order.courierId !== null ? 'Assigned' : 'Not accepted yet'}
                </p>
              )}
            </div>
          </section>

          {/*
            TODO(order-service): Order F2.3.3 and F2.4.3 photos. The order
            records whether each was uploaded, but no endpoint serves the
            image, so this section is commented out.

          <section className={styles.photoCard}>
            <h2 className={styles.sectionTitle}>Photo evidence</h2>
            <div className={styles.photoGrid}>
              <div className={styles.photoSlot}>
                {beforePhotoUrl ? <img src={beforePhotoUrl} alt="Taken at collection" />
                  : <span>Before &mdash; pending collection</span>}
              </div>
              <div className={styles.photoSlot}>
                {afterPhotoUrl ? <img src={afterPhotoUrl} alt="Taken at delivery" />
                  : <span>After &mdash; pending delivery</span>}
              </div>
            </div>
          </section>
          */}
        </div>

        <aside className={styles.statusPanel}>
          <h2 className={styles.sectionTitle}>Status</h2>

          <StatusStepper
            status={order.status}
            currentDetail={
              order.status === 'Created'
                ? `${postedTime} · ${order.credits} credits reserved`
                : undefined
            }
          />

          {showExpiry ? (
            <p className={styles.expiryPanel} role="status">
              Expires in {formatDeadline(secondsLeft)} if unaccepted
            </p>
          ) : null}

          {actions ? (
            <div className={styles.actions}>
              {actions}
              <p className={styles.actionNote}>
                {canCancel
                  ? `Cancelling releases your ${order.credits} credits immediately.`
                  : `Acknowledging releases the ${order.credits} credits to the courier.`}
              </p>
            </div>
          ) : (
            <p className={styles.actionNote}>
              No action is available in the {order.status} state.
            </p>
          )}
        </aside>
      </div>

      {actions ? <div className={styles.mobileActions}>{actions}</div> : null}

      <ConfirmDialog
        open={confirmingCancel}
        title="Cancel this request?"
        consequence={
          <>
            Couriers will no longer see it, and your {order.credits} credits go back to your
            balance straight away. This cannot be undone; post a new request if you change your
            mind.
          </>
        }
        confirmLabel="Cancel request"
        cancelLabel="Keep request"
        destructive
        busy={busy}
        onConfirm={() => void confirmCancel()}
        onCancel={() => setConfirmingCancel(false)}
      />
    </div>
  );
}
