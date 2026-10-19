/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5), date: 2026-09-28; wired to order-service
 *       with Claude Code (Claude Opus 5.5) on 2026-10-10
 * Scope: Generated the courier's view of an order, from the Accepted,
 *        Collected and Delivered mockups.
 * Reviewed by Ngooi Jun Sen.
 *
 * Covers UI FR7 from the courier's side (FR7.2.1: the page changes with the
 * viewer's role), loaded from GET /api/v1/orders/{orderId}. Three states are
 * drawn; Acknowledged and the branch states render the frame with no actions.
 *
 * Decisions from 28 September applied here rather than the mockups: there is
 * no "report a problem" link, because escalation is requester-only from
 * COLLECTED or DELIVERED.
 */

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { StatusStepper } from '../components/order/StatusStepper';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/Dialog';
import { Icon } from '../components/ui/Icon';
import { StatusBadge } from '../components/ui/StatusBadge';
import { errorMessage } from '../lib/api';
import { refreshCreditBalance } from '../lib/credit';
import { formatWhen } from '../lib/format';
import {
  PHOTO_ACCEPT,
  PHOTO_MAX_BYTES,
  cancelOrder,
  collectOrder,
  deliverOrder,
  type Order,
} from '../lib/orders';
import { useLiveOrder } from '../lib/useLiveOrder';
import { formatDeadline, useCountdown } from '../lib/useCountdown';
import styles from './CourierTaskPage.module.css';

/** Order F2.2.6, and the loudest thing on the Accepted screen. */
function CollectionWindow({ task }: { task: Order }) {
  const secondsLeft = useCountdown(task.collectionDeadline?.getTime() ?? null);
  if (task.collectionDeadline === null) return null;

  return (
    <section className={styles.urgent} role="status">
      <p className={styles.urgentClock}>{formatDeadline(secondsLeft)}</p>
      <div className={styles.urgentText}>
        <p className={styles.urgentLead}>Collect within 5 minutes of accepting.</p>
        <p className={styles.urgentBody}>
          If the timer runs out the task returns to the pool.
        </p>
      </div>
    </section>
  );
}

function DeliveryWindow({ task }: { task: Order }) {
  const secondsLeft = useCountdown(task.deliveryDeadline.getTime());

  return (
    <section className={styles.deadline}>
      <div>
        <h2 className={styles.deadlineLabel}>Delivery deadline</h2>
        <p className={styles.deadlineClock}>{formatDeadline(secondsLeft)} left</p>
        <p className={styles.deadlineWhen}>
          {formatWhen(task.deliveryDeadline)} &middot; {task.dropoff.name}
        </p>
      </div>
      <ContactButton task={task} variant="secondary" />
    </section>
  );
}

function AcknowledgementWindow({ task }: { task: Order }) {
  const secondsLeft = useCountdown(task.acknowledgementDeadline?.getTime() ?? null);
  if (task.acknowledgementDeadline === null) return null;

  return (
    <section className={styles.awaiting} role="status">
      <div>
        <h2 className={styles.awaitingLabel}>Awaiting acknowledgement</h2>
        <p className={styles.awaitingClock}>{formatDeadline(secondsLeft)} left</p>
      </div>
      {/* TODO(order-service): the requester's name - orders carry ids only. */}
      <p className={styles.awaitingBody}>
        {task.credits} credits are held until the requester confirms. If they do not respond in
        time the credits are released to you automatically.
      </p>
    </section>
  );
}

function ContactButton({ task, variant }: { task: Order; variant: 'primary' | 'secondary' }) {
  // The order contract returns Telegram handles and has no chat endpoint, so
  // the link is built here.
  if (task.requesterTelegramHandle === null) return null;
  return (
    <a
      className={styles.contactLink}
      href={`https://t.me/${task.requesterTelegramHandle}`}
      target="_blank"
      rel="noreferrer noopener"
    >
      {/* TODO(order-service): "Contact {first name}" once orders carry names. */}
      <Button variant={variant}>Contact requester</Button>
    </a>
  );
}

export function CourierTaskPage() {
  const { orderId = '' } = useParams();
  // Re-read every few seconds: the requester may acknowledge straight from
  // Collected (Order F2.6.1), and this page must not keep offering delivery.
  const { order: task, loadError, setOrder: setTask } = useLiveOrder(orderId);

  if (loadError) {
    return (
      <div className={styles.page}>
        <Alert variant="danger">{loadError}</Alert>
        <Link to="/browse">Back to browse</Link>
      </div>
    );
  }

  if (task === null) {
    return (
      <div className={styles.page}>
        <p className={styles.actionNote}>Loading the task…</p>
      </div>
    );
  }

  return <CourierTask task={task} onChange={setTask} />;
}

function CourierTask({ task, onChange }: { task: Order; onChange: (task: Order) => void }) {
  const accepted = task.status === 'Accepted';
  const collected = task.status === 'Collected';
  const delivered = task.status === 'Delivered';

  const [uploading, setUploading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // The courier is paid when the order settles: acknowledged by the requester
  // or the deadline passing. Credit applies it shortly after, from Kafka, so
  // re-read the balance now and once more a few seconds later.
  const settled = task.status === 'Acknowledged' || task.status === 'Unacknowledged';
  useEffect(() => {
    if (!settled) return undefined;
    void refreshCreditBalance();
    const again = setTimeout(() => void refreshCreditBalance(), 4_000);
    return () => clearTimeout(again);
  }, [settled]);

  // Order F2.9: the courier may release the task while Accepted and inside the
  // collection window. The server checks the window too and answers 409.
  const collectionSecondsLeft = useCountdown(task.collectionDeadline?.getTime() ?? null);
  const canRelease = accepted && collectionSecondsLeft > 0;
  const [confirmingRelease, setConfirmingRelease] = useState(false);
  const [releasing, setReleasing] = useState(false);

  async function handleRelease() {
    setReleasing(true);
    setFailure(null);
    try {
      // Same endpoint as the requester's cancel; Order tells them apart by
      // who is calling. The task goes back to Created with no courier.
      await cancelOrder(task.id);
      // No longer the assigned courier, so this order is not readable any
      // more: leave rather than poll it.
      navigate('/browse', { replace: true });
    } catch (error) {
      setFailure(errorMessage(error, 'Could not reach the Order Service. Try again in a moment.'));
      setConfirmingRelease(false);
      setReleasing(false);
    }
  }

  // Order F2.3.3 and F2.4.3: a photo is required to mark collected or
  // delivered, so the button opens the picker and the upload is the action.
  async function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const photo = event.target.files?.[0];
    event.target.value = '';
    if (!photo) return;
    if (photo.size > PHOTO_MAX_BYTES) {
      setFailure('That photo is over 10 MB. Choose a smaller one.');
      return;
    }

    setUploading(true);
    setFailure(null);
    try {
      onChange(accepted ? await collectOrder(task.id, photo) : await deliverOrder(task.id, photo));
    } catch (error) {
      setFailure(errorMessage(error, 'Could not upload the photo. Try again.'));
    } finally {
      setUploading(false);
    }
  }

  const uploadLabel = accepted
    ? 'Upload photo & mark collected'
    : 'Upload photo & mark delivered';
  const uploadButton =
    accepted || collected ? (
      <Button fullWidth loading={uploading} onClick={() => fileInput.current?.click()}>
        {uploadLabel}
      </Button>
    ) : null;
  const releaseButton = canRelease ? (
    <Button
      variant="secondary"
      fullWidth
      disabled={uploading}
      onClick={() => setConfirmingRelease(true)}
    >
      Release task
    </Button>
  ) : null;

  /*
   * TODO(order-service): the mockup subtitles give the times you accepted,
   * collected and delivered. The order carries deadlines only, not when each
   * step happened, so the subtitle says where you are instead.
   */
  const subtitle = delivered
    ? `Delivered to ${task.dropoff.name}`
    : collected
      ? `Collected · deliver to ${task.dropoff.name}`
      : `Accepted · earns ${task.credits} credits`;

  return (
    <div className={styles.page}>
      <input
        ref={fileInput}
        type="file"
        accept={PHOTO_ACCEPT}
        capture="environment"
        hidden
        onChange={handlePhoto}
      />

      <div className={styles.mobileHeader}>
        <Link to="/my-deliveries" className={styles.back} aria-label="Back to my deliveries">
          <span aria-hidden="true">&lsaquo;</span>
        </Link>
        <h1 className={styles.mobileTitle}>Task #{task.reference}</h1>
        <StatusBadge status={task.status} />
      </div>

      <div className={styles.stepperBar}>
        <StatusStepper status={task.status} />
      </div>

      <div className={styles.body}>
        <div className={styles.mainColumn}>
          <header className={styles.header}>
            <span className={styles.desktopBadge}>
              <StatusBadge status={task.status} />
            </span>
            <h1 className={styles.title}>{task.item}</h1>
            <p className={styles.subtitle}>{subtitle}</p>
          </header>

          {failure ? <Alert variant="danger">{failure}</Alert> : null}

          {accepted ? <CollectionWindow task={task} /> : null}
          {delivered ? <AcknowledgementWindow task={task} /> : null}

          {accepted ? (
            <section className={styles.detailsCard}>
              <div className={styles.detailBlock}>
                <h2 className={styles.detailLabel}>Pickup</h2>
                <p className={styles.detailValue}>{task.pickup.name}</p>
                {/* TODO(order-service): the supplier's location description and
                    a walking time are not on the order.
                <p className={styles.detailNote}>{task.pickupDetail} · {task.pickupWalkMinutes} min walk</p> */}
              </div>

              <div className={styles.detailBlock}>
                <h2 className={styles.detailLabel}>Requester</h2>
                <p className={styles.detailValue}>
                  {/* TODO(order-service): the requester's name - orders carry ids only.
                  {task.requesterName} &middot;{' '} */}
                  {task.requesterRating !== null ? (
                    <span className={styles.rating}>
                      <Icon name="star" size={13} filled />
                      {task.requesterRating.toFixed(1)}
                    </span>
                  ) : (
                    'New requester'
                  )}
                </p>
                {/* TODO(order-service): no endpoint counts a user's errands.
                <p className={styles.detailNote}>{task.requesterOrderCount} errands requested</p> */}
              </div>

              <div className={styles.detailBlockWide}>
                <h2 className={styles.detailLabel}>Collect</h2>
                <p className={styles.detailNote}>{task.item}</p>
              </div>
            </section>
          ) : null}

          {/*
            TODO(order-service): photo evidence. Uploading works (the buttons
            below), but no endpoint serves the images back, so viewing them is
            commented out.

          {collected || delivered ? (
            <section className={styles.photoCard}>
              <h2 className={styles.sectionTitle}>Photo evidence</h2>
              <div className={styles.photoGrid}>
                <PhotoSlot label="Before photo" url={beforePhotoUrl} caption="At collection" />
                <PhotoSlot label="After photo" url={afterPhotoUrl} caption="At handover" />
              </div>
            </section>
          ) : null}
          */}

          {collected ? <DeliveryWindow task={task} /> : null}

          {collected || delivered ? (
            <section className={styles.personCard}>
              {/* TODO(order-service): the requester's name and initials. */}
              <div className={styles.personText}>
                <p className={styles.personName}>Requester</p>
                <p className={styles.personNote}>
                  {delivered
                    ? 'Settle the item cost directly if not already done'
                    : `Meet at ${task.dropoff.name}`}
                </p>
              </div>
              <ContactButton task={task} variant="secondary" />
            </section>
          ) : null}
        </div>

        <aside className={styles.statusPanel}>
          <h2 className={styles.sectionTitle}>Status</h2>

          <StatusStepper status={task.status} />

          <p className={styles.earnings}>
            <span>You&apos;ll earn</span>
            <strong>
              +{task.credits} <span className={styles.earningsUnit}>credits</span>
            </strong>
          </p>

          <div className={styles.actions}>
            {uploadButton}
            {releaseButton}
            {delivered ? (
              <>
                {/* TODO(rating): the courier may rate the requester from
                    Delivered, but the Rating Service does not exist yet.
                <Button fullWidth>Rate {requesterName}</Button> */}
                <ContactButton task={task} variant="secondary" />
              </>
            ) : null}
            {!accepted && !collected && !delivered ? (
              <p className={styles.actionNote}>
                No action is available in the {task.status} state.
              </p>
            ) : null}
          </div>
        </aside>
      </div>

      {uploadButton ? (
        <div className={styles.mobileActions}>
          {uploadButton}
          {releaseButton}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmingRelease}
        title="Release this task?"
        consequence={
          <>
            It goes back to the pool for another courier to accept, and you will not earn the{' '}
            {task.credits} credits. Only do this before you have collected the item.
          </>
        }
        confirmLabel="Release task"
        cancelLabel="Keep task"
        destructive
        busy={releasing}
        onConfirm={() => void handleRelease()}
        onCancel={() => setConfirmingRelease(false)}
      />
    </div>
  );
}
