/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the supplier approval queue against UI FR16, with no
 *        mockup to work from.
 * Reviewed by Ngooi Jun Sen.
 *
 * Covers FR16.1.1 (a table of pending listings) and FR16.1.2 (Approve and
 * Reject on each row), and NFR11.1.2 (the table scrolls horizontally on a
 * narrow screen rather than bursting the viewport).
 *
 * Calls GET /api/v1/supplier/admin and PATCH /api/v1/supplier/{id}/status,
 * which Supplier F1.3.1 restricts to admins and logs with a timestamp. The
 * service does not yet check who is calling; see docs/open-items.md.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/Dialog';
import { formatHours, fetchSuppliersForAdmin, setSupplierStatus, type Supplier } from '../lib/suppliers';
import styles from './AdminSuppliersPage.module.css';

type Filter = 'pending' | 'approved' | 'rejected' | 'all';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

export function AdminSuppliersPage() {
  const [filter, setFilter] = useState<Filter>('pending');
  const [rows, setRows] = useState<Supplier[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<number | null>(null);
  // NFR9.1.1: a decision on someone's submission asks first.
  const [pendingDecision, setPendingDecision] = useState<
    { supplier: Supplier; status: Supplier['status'] } | null
  >(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await fetchSuppliersForAdmin(filter === 'all' ? undefined : filter);
      setRows(result);
    } catch {
      setRows([]);
      setError('Could not reach the Supplier Service. Start it and reload.');
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide() {
    if (pendingDecision === null) return;
    const { supplier, status } = pendingDecision;

    setWorking(supplier.id);
    setError(null);
    try {
      await setSupplierStatus(supplier.id, status);
      // Re-read rather than patching locally, so the list reflects what the
      // service actually stored.
      await load();
      setPendingDecision(null);
    } catch {
      setError(`Could not set ${supplier.name} to ${status}.`);
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          Supplier approvals
          <span className={styles.subtitle}>
            {rows === null ? 'Loading' : `${rows.length} ${filter === 'all' ? 'total' : filter}`}
          </span>
        </h1>

        <div className={styles.filters} role="tablist" aria-label="Status">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={filter === option.value}
              className={filter === option.value ? `${styles.filter} ${styles.filterActive}` : styles.filter}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {error ? <Alert variant="danger">{error}</Alert> : null}

      {rows !== null && rows.length === 0 && error === null ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Nothing {filter === 'all' ? 'here' : filter}</p>
          <p className={styles.emptyBody}>
            {filter === 'pending'
              ? 'Every submitted listing has been reviewed.'
              : 'No listings in this state.'}
          </p>
        </div>
      ) : null}

      {rows !== null && rows.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Categories</th>
                <th scope="col">Location</th>
                <th scope="col">Hours</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((supplier) => (
                <tr key={supplier.id}>
                  <td className={styles.name}>{supplier.name}</td>
                  <td>{supplier.categories.map((category) => category.name).join(', ') || '—'}</td>
                  <td>
                    {[supplier.building, supplier.floor ? `Level ${supplier.floor}` : null]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                    {supplier.locationDescription ? (
                      <span className={styles.sub}>{supplier.locationDescription}</span>
                    ) : null}
                  </td>
                  <td className={styles.mono}>{formatHours(supplier)}</td>
                  <td>
                    <span className={styles[supplier.status]}>{supplier.status}</span>
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      {supplier.status !== 'approved' ? (
                        <Button
                          variant="secondary"
                          onClick={() => setPendingDecision({ supplier, status: 'approved' })}
                        >
                          Approve
                        </Button>
                      ) : null}
                      {supplier.status !== 'rejected' ? (
                        <Button
                          variant="danger"
                          onClick={() => setPendingDecision({ supplier, status: 'rejected' })}
                        >
                          Reject
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingDecision !== null}
        title={
          pendingDecision?.status === 'rejected' ? 'Reject this listing?' : 'Approve this listing?'
        }
        consequence={
          pendingDecision === null ? null : pendingDecision.status === 'rejected' ? (
            <>
              {pendingDecision.supplier.name} stays out of the catalogue and cannot be chosen as a
              pickup or delivery point. The person who submitted it is not told, and no reason is
              recorded, because the service has no field for either.
            </>
          ) : (
            <>
              {pendingDecision.supplier.name} becomes visible in the catalogue straight away and
              can be chosen as a pickup or delivery point.
            </>
          )
        }
        confirmLabel={pendingDecision?.status === 'rejected' ? 'Reject' : 'Approve'}
        destructive={pendingDecision?.status === 'rejected'}
        busy={working !== null}
        onConfirm={decide}
        onCancel={() => setPendingDecision(null)}
      />

      {/*
        Supplier NFR2.2.1 requires the submitter to be told the outcome, with
        a reason when rejected. Neither the service nor this screen does that,
        and there is no field to type a reason into.
      */}
      <p className={styles.gap}>
        Rejecting does not notify the submitter or record a reason, which Supplier NFR2.2.1
        requires. The service has no field for either.
      </p>
    </div>
  );
}
