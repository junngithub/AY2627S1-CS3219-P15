/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the post-a-new-request form from the desktop and mobile
 *        mockups.
 * Reviewed by Ngooi Jun Sen.
 *
 * Covers UI FR6. The rules enforced here come from Order F1: at least one
 * credit (F1.2.1), both times in the future, and the acceptance expiry before
 * the delivery deadline (F1.4.1). The balance check mirrors Credit F3.2, which
 * rejects a reservation the requester cannot cover - checking it here only
 * saves the user a round trip; the service still decides.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { CreditStepper, DateTimeField, SelectField, TextAreaField } from '../components/ui/Inputs';
import { errorMessage } from '../lib/api';
import { useCreditBalance } from '../lib/credit';
import { formatUntil, formatWhen, parseLocalInput, toLocalInput } from '../lib/format';
import { createOrder } from '../lib/orders';
import { fetchSuppliers, type Supplier } from '../lib/suppliers';
import styles from './NewRequestPage.module.css';

function minutesFromNow(minutes: number): string {
  return toLocalInput(new Date(Date.now() + minutes * 60_000));
}

export function NewRequestPage() {
  const navigate = useNavigate();

  // Null while loading or if the Credit Service is unreachable; the balance
  // check is then skipped and the service's reservation decides (Credit F3.2).
  const balance = useCreditBalance();

  // UI FR10.1.3: the supplier catalogue is the data source for both pickers,
  // and FR6.1.1 covers pickup and delivery. Values are supplier ids, because
  // the order contract takes fromLocation and toLocation as ids.
  const [locations, setLocations] = useState<Supplier[]>([]);
  const [locationsLive, setLocationsLive] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchSuppliers({ pageSize: 100 })
      .then((result) => {
        if (cancelled) return;
        setLocations(result.items);
        setLocationsLive(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLocations([]);
        setLocationsLive(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const locationOptions = useMemo(
    () =>
      [...locations]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((supplier) => ({ value: String(supplier.id), label: supplier.name })),
    [locations],
  );

  const [pickup, setPickup] = useState('');
  const [delivery, setDelivery] = useState('');
  const [item, setItem] = useState('');
  const [credits, setCredits] = useState(3);
  // Defaults match the mockups: collection window first, delivery an hour on.
  const [expiresAt, setExpiresAt] = useState(() => minutesFromNow(30));
  const [deliverBy, setDeliverBy] = useState(() => minutesFromNow(90));
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const errors = useMemo(() => {
    const expiry = parseLocalInput(expiresAt);
    const deadline = parseLocalInput(deliverBy);
    const now = new Date();

    return {
      pickup: pickup === '' ? 'Choose a pickup location' : null,
      delivery: delivery === '' ? 'Choose a delivery location' : null,
      item: item.trim() === '' ? 'Say what the courier should get' : null,
      credits: Number.isNaN(credits)
        ? 'Enter a reward'
        : credits < 1
          ? 'At least 1 credit'
          : balance !== null && credits > balance
            ? `Exceeds your balance — you have ${balance} credits available`
            : null,
      deliverBy:
        deadline === null
          ? 'Choose a delivery deadline'
          : deadline <= now
            ? 'Must be in the future'
            : null,
      expiresAt:
        expiry === null
          ? 'Choose an acceptance expiry'
          : expiry <= now
            ? 'Must be in the future'
            : deadline !== null && expiry >= deadline
              ? 'Must be before the delivery deadline'
              : null,
    };
  }, [pickup, delivery, item, credits, balance, expiresAt, deliverBy]);

  const isValid = Object.values(errors).every((error) => error === null);
  const remaining = balance === null ? null : balance - (Number.isNaN(credits) ? 0 : credits);

  const expiryDate = parseLocalInput(expiresAt);
  const deadlineDate = parseLocalInput(deliverBy);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValid || submitting) return;

    const expiry = parseLocalInput(expiresAt);
    const deadline = parseLocalInput(deliverBy);
    if (expiry === null || deadline === null) return;

    setSubmitting(true);
    setFailure(null);
    try {
      // Order F1: the service reserves the credits before the order exists,
      // and refuses if they cannot be covered.
      const order = await createOrder({
        itemDescription: item.trim(),
        credits,
        expiryTime: expiry,
        deliveryTime: deadline,
        fromLocation: pickup,
        toLocation: delivery,
      });
      navigate(`/orders/${order.id}`);
    } catch (error) {
      setFailure(errorMessage(error, 'Could not reach the Order Service. Try again in a moment.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.page} onSubmit={handleSubmit} noValidate>
      {!locationsLive ? (
        <p className={styles.offline} role="status">
          Cannot reach the Supplier Service, so there are no locations to choose from. Start it
          and reload.
        </p>
      ) : null}

      {/* Mobile header from the mockup; the app nav is hidden on this route. */}
      <div className={styles.mobileHeader}>
        <Link to="/browse" className={styles.back} aria-label="Back">
          <span aria-hidden="true">&lsaquo;</span>
        </Link>
        <h1 className={styles.mobileTitle}>New request</h1>
        <span className={styles.mobileBalance}>{balance ?? '--'} cr available</span>
      </div>

      <div className={styles.card}>
        <header className={styles.header}>
          <h1 className={styles.title}>Post a new request</h1>
          <p className={styles.subtitle}>
            Credits are reserved when you post and transfer when you acknowledge delivery.
          </p>
        </header>

        {failure ? <Alert variant="danger">{failure}</Alert> : null}

        <div className={styles.row}>
          <SelectField
            label="Pickup location"
            options={locationOptions}
            placeholder="Choose a supplier"
            value={pickup}
            hint={
              <>
                Approved suppliers only &middot;{' '}
                <Link to="/suppliers" className={styles.browseLink}>
                  Browse suppliers
                </Link>
              </>
            }
            onChange={(event) => setPickup(event.target.value)}
          />
          {/*
            Same catalogue for the drop-off, which is what FR10.1.3 and Order
            F1.6.1 intend. It reads oddly today because the seeded rows are all
            shops: a drop-off like LT19 foyer belongs in the catalogue as
            Supplier F1.1's Type Facility, which the service does not
            implement. See docs/open-items.md.
          */}
          <SelectField
            label="Delivery location"
            options={locationOptions}
            placeholder="Choose a drop-off point"
            value={delivery}
            onChange={(event) => setDelivery(event.target.value)}
          />
        </div>

        <TextAreaField
          label="Item description"
          placeholder={'2 × iced latte (less ice), 1 almond croissant. Order under "Priya".'}
          value={item}
          onChange={(event) => setItem(event.target.value)}
        />

        {/*
          One grid for the last four blocks, because the two viewports pair
          them differently: desktop puts the deadline beside the reward and
          the summary beside the expiry, mobile puts the two times side by
          side under a full-width reward.
        */}
        <div className={styles.lower}>
          <div className={styles.areaCredits}>
          <CreditStepper
            label="Credit reward"
            value={credits}
            min={1}
            max={999}
            onChange={setCredits}
            error={errors.credits}
            success={
              errors.credits === null && remaining !== null
                ? `${remaining} credits will remain available`
                : undefined
            }
          />
          </div>

          <div className={styles.areaDeadline}>
          <DateTimeField
            label="Delivery deadline"
            value={deliverBy}
            min={toLocalInput(new Date())}
            onChange={setDeliverBy}
            error={errors.deliverBy}
            hint={deadlineDate ? formatWhen(deadlineDate) : 'Must be in the future'}
          />
          </div>

          <div className={styles.areaExpiry}>
          <DateTimeField
            label="Acceptance expiry"
            value={expiresAt}
            min={toLocalInput(new Date())}
            onChange={setExpiresAt}
            error={errors.expiresAt}
            hint={
              expiryDate
                ? `Before the delivery deadline · ${formatUntil(expiryDate)}`
                : 'Before the delivery deadline'
            }
          />
          </div>

          <div className={styles.summary}>
            <p className={styles.summaryLabel}>Balance after reserving</p>
            <p
              className={
                remaining !== null && remaining < 0 ? styles.summaryNegative : styles.summaryValue
              }
            >
              {remaining === null ? 'Balance unavailable' : `${remaining} credits`}
            </p>
            <Button type="submit" fullWidth disabled={!isValid} loading={submitting}>
              Post request
            </Button>
          </div>
        </div>
      </div>

      {/* UI FR20.2.1: the primary action is pinned on mobile. */}
      <div className={styles.mobileActions}>
        <Button type="submit" fullWidth disabled={!isValid} loading={submitting}>
          {Number.isNaN(credits) ? 'Post request' : `Post request · reserve ${credits}`}
        </Button>
      </div>
    </form>
  );
}
