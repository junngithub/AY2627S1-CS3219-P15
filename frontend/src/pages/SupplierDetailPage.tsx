/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the single-supplier view, which D2 Part 2 point 5 asks
 *        for ("viewing supplier details"). No mockup exists.
 * Reviewed by Ngooi Jun Sen, changed status to uppercase.
 *
 * Reads GET /api/v1/supplier/{id}, the same endpoint Order uses to validate
 * a pickup or drop-off location (Supplier F1.5.1, Order F1.5.1/F1.6.1).
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert } from '../components/ui/Alert';
import { ApiError } from '../lib/api';
import { Button } from '../components/ui/Button';
import { fetchSupplier, formatHours, isOpenAt, type Supplier } from '../lib/suppliers';
import styles from './SupplierDetailPage.module.css';

type State =
  | { kind: 'loading' }
  | { kind: 'found'; supplier: Supplier }
  | { kind: 'missing' }
  | { kind: 'failed' };

export function SupplierDetailPage() {
  const { supplierId } = useParams();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const id = Number(supplierId);

    if (!Number.isInteger(id)) {
      setState({ kind: 'missing' });
      return undefined;
    }

    fetchSupplier(id)
      .then((supplier) => {
        if (!cancelled) setState({ kind: 'found', supplier });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // A 404 means no such supplier; anything else means the service is
        // unreachable, and the two deserve different words.
        setState(
          error instanceof ApiError && error.status === 404
            ? { kind: 'missing' }
            : { kind: 'failed' },
        );
      });

    return () => {
      cancelled = true;
    };
  }, [supplierId]);

  if (state.kind === 'loading') {
    return (
      <div className={styles.page}>
        <p className={styles.loading}>Loading supplier…</p>
      </div>
    );
  }

  if (state.kind === 'failed') {
    return (
      <div className={styles.page}>
        <Alert variant="danger">
          Cannot reach the Supplier Service. Check that it is running and reload.
        </Alert>
        <div className={styles.backRow}>
          <Link to="/suppliers">
            <Button variant="secondary">Back to suppliers</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (state.kind === 'missing') {
    return (
      <div className={styles.page}>
        <Alert variant="danger">
          No supplier with that id. It may have been rejected, or never existed.
        </Alert>
        <div className={styles.backRow}>
          <Link to="/suppliers">
            <Button variant="secondary">Back to suppliers</Button>
          </Link>
        </div>
      </div>
    );
  }

  const { supplier } = state;
  const open = isOpenAt(supplier);

  return (
    <div className={styles.page}>
      <nav className={styles.trail} aria-label="Breadcrumb">
        <Link to="/suppliers">Suppliers</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{supplier.name}</span>
      </nav>

      <header className={styles.header}>
        <h1 className={styles.title}>{supplier.name}</h1>
        {open === null ? null : (
          <span className={open ? styles.open : styles.closed}>{open ? 'Open now' : 'Closed'}</span>
        )}
      </header>

      <ul className={styles.tags}>
        {supplier.categories.map((category) => (
          <li key={category.id} className={styles.tag}>
            {category.name}
          </li>
        ))}
      </ul>

      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>Building</dt>
          <dd>{supplier.building ?? '—'}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Floor</dt>
          <dd>{supplier.floor ?? '—'}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Finding it</dt>
          <dd>{supplier.locationDescription ?? '—'}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Hours</dt>
          <dd>{formatHours(supplier)}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Coordinates</dt>
          <dd className={styles.mono}>
            {supplier.latitude.toFixed(6)}, {supplier.longitude.toFixed(6)}
          </dd>
        </div>
        <div className={styles.fact}>
          <dt>Status</dt>
          <dd>{supplier.status.toUpperCase()}</dd>
        </div>
      </dl>

      <div className={styles.actions}>
        <Link to="/suppliers">
          <Button variant="secondary">Back to suppliers</Button>
        </Link>
      </div>

      {/*
        D2 Part 2 point 5 asks the UI to demonstrate editing and deleting a
        supplier. The service has neither endpoint - only POST, the GETs and
        PATCH /:id/status - so those actions cannot be built yet. This note is
        scaffolding and should go once they exist.
      */}
      <p className={styles.blocked}>
        Editing and deleting are not available: the Supplier Service has no endpoint for either.
      </p>
    </div>
  );
}
