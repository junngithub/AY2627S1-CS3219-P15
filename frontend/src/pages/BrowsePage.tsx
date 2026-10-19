/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5), date: 2026-09-27
 * Scope: Generated the courier task pool from the desktop and mobile home
 *        mockups.
 * Reviewed by Ngooi Jun Sen.
 *
 * Covers UI FR5, against order-service's open pool (GET /api/v1/orders).
 * The service ranks by distance then reward when given a location, and by
 * reward otherwise; the filters and the sort menu then work on that page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilterPanel, type SortValue } from '../components/browse/FilterPanel';
import { RequestCard } from '../components/browse/RequestCard';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { Sheet } from '../components/ui/Sheet';
import { errorMessage } from '../lib/api';
import { formatElapsed } from '../lib/format';
import { useGeolocation } from '../lib/useGeolocation';
import {
  AlreadyAcceptedError,
  acceptOrder,
  distanceMetres,
  fetchPool,
  type Order,
} from '../lib/orders';
import styles from './BrowsePage.module.css';

type Banner = { kind: 'accepted'; orderId: string } | { kind: 'conflict' } | null;

export function BrowsePage() {
  const [requests, setRequests] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState(() => new Date());

  const [selectedPickups, setSelectedPickups] = useState<string[]>([]);
  const [minReward, setMinReward] = useState(0);
  const [destinationQuery, setDestinationQuery] = useState('');
  // UI FR5.3.1: sent to the pool as latitude and longitude when known.
  const geolocation = useGeolocation();
  const location = geolocation.status === 'granted' ? geolocation.coordinates : null;
  const located = location !== null;

  // Order F4.3.1: with no location the list is ordered by reward instead.
  const [sort, setSort] = useState<SortValue>('reward');
  const [sortTouched, setSortTouched] = useState(false);

  // Switch to proximity once a location arrives, unless the courier has
  // already chosen an order for themselves.
  useEffect(() => {
    if (located && !sortTouched) setSort('nearest');
  }, [located, sortTouched]);

  function chooseSort(value: SortValue) {
    setSortTouched(true);
    setSort(value);
  }

  // Order F4.2.1: ranked once at search time; it reloads when the location
  // changes, not as other couriers act.
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const page = await fetchPool(location);
      setRequests(page.orders);
      setLoadedAt(new Date());
    } catch (error) {
      setLoadError(errorMessage(error, 'Could not reach the Order Service. Try again in a moment.'));
    } finally {
      setLoading(false);
    }
  }, [location]);

  useEffect(() => {
    void load();
  }, [load]);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  /*
   * TODO(supplier-service): the pickup points should come from the Supplier
   * Service so the list is stable. Derived from the current pool for now,
   * which means the options shift as errands come and go.
   */
  const pickupPoints = useMemo(
    () => [...new Set(requests.map((request) => request.pickup.name))].sort(),
    [requests],
  );

  const distances = useMemo(() => {
    const byId = new Map<string, number>();
    if (location !== null) {
      for (const request of requests) byId.set(request.id, distanceMetres(location, request.pickup));
    }
    return byId;
  }, [requests, location]);

  const visible = useMemo(() => {
    const query = destinationQuery.trim().toLowerCase();

    const filtered = requests.filter((request) => {
      if (selectedPickups.length > 0 && !selectedPickups.includes(request.pickup.name)) return false;
      if (request.credits < minReward) return false;
      /*
       * FR5.4.1 filters by delivery location and FR5.4.2 by supplier or
       * pickup point, and both say "the search bar" - one control matching
       * either.
       */
      if (
        query.length > 0 &&
        !`${request.pickup.name} ${request.dropoff.name}`.toLowerCase().includes(query)
      ) {
        return false;
      }
      return true;
    });

    return filtered.sort((a, b) => {
      if (sort === 'reward') return b.credits - a.credits;
      if (sort === 'newest') return b.requestedAt.getTime() - a.requestedAt.getTime();
      // Nearest keeps the service's order when there is no location.
      const da = distances.get(a.id);
      const db = distances.get(b.id);
      if (da === undefined || db === undefined) return 0;
      return da - db || b.credits - a.credits;
    });
  }, [requests, selectedPickups, minReward, destinationQuery, sort, distances]);

  const activeFilterCount =
    (selectedPickups.length > 0 ? 1 : 0) +
    (minReward > 0 ? 1 : 0) +
    (destinationQuery.trim().length > 0 ? 1 : 0);

  function togglePickup(point: string) {
    setSelectedPickups((current) =>
      current.includes(point) ? current.filter((value) => value !== point) : [...current, point],
    );
  }

  function resetFilters() {
    setSelectedPickups([]);
    setMinReward(0);
    setDestinationQuery('');
  }

  async function handleAccept(orderId: string) {
    if (acceptingId !== null) return;
    setAcceptingId(orderId);
    setBanner(null);
    setAcceptError(null);
    try {
      await acceptOrder(orderId);
      setRequests((current) => current.filter((request) => request.id !== orderId));
      setBanner({ kind: 'accepted', orderId });
    } catch (error) {
      if (error instanceof AlreadyAcceptedError) {
        // Order F2.2/F3.3.1: the losing side of the race is told plainly, and
        // the row leaves the pool rather than sitting there un-acceptable.
        setRequests((current) => current.filter((request) => request.id !== orderId));
        setBanner({ kind: 'conflict' });
      } else {
        setAcceptError(errorMessage(error, 'Could not reach the Order Service. Try again.'));
      }
    } finally {
      setAcceptingId(null);
    }
  }

  const countLabel = `${visible.length} open request${visible.length === 1 ? '' : 's'}`;

  return (
    <div className={styles.page}>
      {/* UI FR5.1: where the courier is, and how to change it. */}
      <div className={styles.locationBar}>
        <p className={styles.location}>
          <Icon name="pin" size={16} />
          <span className={styles.locationLong}>
            {located
              ? 'Using your location'
              : geolocation.status === 'locating'
                ? 'Finding your location…'
                : geolocation.status === 'denied'
                  ? 'Location blocked — ordering by reward'
                  : geolocation.status === 'unavailable'
                    ? 'Location unavailable — ordering by reward'
                    : 'No location set — ordering by reward'}
          </span>
          <span className={styles.locationShort}>
            {located ? 'Your location' : 'No location'}
          </span>
          {/*
            TODO(ui): FR5.3.2's manual override. Nothing turns typed text into
            coordinates - there is no geocoding endpoint and the pool takes
            latitude and longitude only - so the workable answer is a pick
            from the supplier catalogue, which carries coordinates on every
            row. Recorded in section 3a of docs/open-items.md.
          */}
          <button
            type="button"
            className={styles.locationChange}
            disabled={geolocation.status === 'locating'}
            onClick={geolocation.request}
          >
            <span className={styles.locationLong}>
              {located ? 'Update location' : 'Use my location'}
            </span>
            <span className={styles.locationShort}>{located ? 'Update' : 'Use mine'}</span>
          </button>
        </p>

        <div className={styles.locationTools}>
          <label className={styles.search}>
            <Icon name="search" size={16} />
            <span className="visually-hidden">Search pickup or delivery location</span>
            <input
              type="search"
              placeholder="Search pickup or delivery location"
              value={destinationQuery}
              onChange={(event) => setDestinationQuery(event.target.value)}
            />
          </label>

          {/* The catalogue, next to the box that searches it. */}
          <Link to="/suppliers" className={styles.allSuppliers}>
            See all
          </Link>

          <button
            type="button"
            className={styles.filterButton}
            onClick={() => setFiltersOpen(true)}
            aria-haspopup="dialog"
          >
            Filter{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <FilterPanel
            variant="sidebar"
            pickupPoints={pickupPoints}
            selectedPickups={selectedPickups}
            onTogglePickup={togglePickup}
            minReward={minReward}
            onMinReward={setMinReward}
            sort={sort}
            onSort={chooseSort}
          />

          {/*
            The pool returns other users' orders only (Order F4), so your own
            never appear here; they are under My requests.
          */}
          <p className={styles.ownNote}>
            Your own requests are not listed here &mdash; find them under My requests.
          </p>
        </aside>

        <section className={styles.results}>
          <div className={styles.resultsHead}>
            <h1 className={styles.count}>
              {countLabel}
              <span className={styles.countMeta}>
                {sort === 'nearest' ? 'nearest first' : sort === 'reward' ? 'highest reward first' : 'most recent first'}
                {' · refreshed '}
                {formatElapsed(loadedAt)}
              </span>
            </h1>

            {banner?.kind === 'accepted' ? (
              <p className={styles.accepted} role="status">
                <Icon name="check" size={16} />
                {/* My deliveries has no endpoint yet, so link to the task itself. */}
                Task accepted &mdash;{' '}
                <Link to={`/deliveries/${banner.orderId}`}>open it now</Link>
              </p>
            ) : null}
          </div>

          {acceptError ? <Alert variant="danger">{acceptError}</Alert> : null}

          {loadError ? (
            <Alert variant="danger">{loadError}</Alert>
          ) : loading && requests.length === 0 ? (
            <p className={styles.empty}>Loading open requests…</p>
          ) : requests.length === 0 ? (
            <p className={styles.empty}>No open requests right now. Check back soon.</p>
          ) : visible.length === 0 ? (
            <p className={styles.empty}>
              No open requests match these filters. Try clearing the minimum reward or picking more
              pickup points.
            </p>
          ) : (
            <div className={styles.grid}>
              {visible.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  distanceMetres={distances.get(request.id) ?? null}
                  accepting={acceptingId === request.id}
                  onAccept={handleAccept}
                />
              ))}
            </div>
          )}

          {banner?.kind === 'conflict' ? (
            <Alert variant="danger">
              Someone already accepted this task &mdash; it&apos;s been removed from the pool.
            </Alert>
          ) : null}
        </section>
      </div>

      <Sheet
        open={filtersOpen}
        title="Filter"
        onClose={() => setFiltersOpen(false)}
        headerAction={
          <button type="button" className={styles.reset} onClick={resetFilters}>
            Reset
          </button>
        }
        footer={
          <Button fullWidth onClick={() => setFiltersOpen(false)}>
            Show {countLabel.replace('open ', '')}
          </Button>
        }
      >
        <FilterPanel
          variant="sheet"
          pickupPoints={pickupPoints}
          selectedPickups={selectedPickups}
          onTogglePickup={togglePickup}
          minReward={minReward}
          onMinReward={setMinReward}
          query={destinationQuery}
          onQuery={setDestinationQuery}
        />
      </Sheet>
    </div>
  );
}
