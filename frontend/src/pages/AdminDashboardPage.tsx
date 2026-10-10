/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the admin dashboard from the mockup.
 * Author review: Ngooi Jun Sen to validate before merge.
 *
 * Covers UI FR15.1.1 (summary cards for pending supplier approvals, pending
 * escalations and suspended users) and FR15.1.2 (links into each section,
 * which the rail provides).
 *
 * Only the supplier card has a service behind it. Escalations and suspended
 * users need the Admin Service, and the recent activity feed has no source
 * anywhere, so all three say so rather than showing invented figures.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchSuppliersForAdmin, type Supplier } from '../lib/suppliers';
import styles from './AdminDashboardPage.module.css';

type PendingState =
  | { kind: 'loading' }
  | { kind: 'ready'; count: number; oldest: Date | null }
  | { kind: 'failed' };

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

export function AdminDashboardPage() {
  const [pending, setPending] = useState<PendingState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    fetchSuppliersForAdmin('pending')
      .then((rows: Supplier[]) => {
        if (cancelled) return;
        // createdAt comes back as a string over the wire.
        const dates = rows
          .map((row) => new Date((row as Supplier & { createdAt?: string }).createdAt ?? ''))
          .filter((date) => !Number.isNaN(date.getTime()));
        setPending({
          kind: 'ready',
          count: rows.length,
          oldest: dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null,
        });
      })
      .catch(() => {
        if (!cancelled) setPending({ kind: 'failed' });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Dashboard</h1>
        <p className={styles.date}>{today}</p>
      </header>

      <div className={styles.cards}>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Pending supplier approvals</h2>
          {pending.kind === 'loading' ? (
            <p className={styles.metricMuted}>&mdash;</p>
          ) : pending.kind === 'failed' ? (
            <>
              <p className={styles.metricMuted}>&mdash;</p>
              <p className={styles.cardNote}>Supplier Service unreachable</p>
            </>
          ) : (
            <>
              <p className={styles.metric}>{pending.count}</p>
              <p className={styles.cardNote}>
                {pending.count === 0
                  ? 'Nothing waiting'
                  : pending.oldest === null
                    ? 'Waiting for review'
                    : `Oldest waiting ${daysSince(pending.oldest)} days`}
              </p>
            </>
          )}
          <Link to="/admin/suppliers" className={styles.primaryAction}>
            Review queue
          </Link>
        </section>

        <section className={styles.card}>
          <div className={styles.soonHead}>
            <h2 className={styles.cardTitle}>Pending escalations</h2>
            <span className={styles.soonTag}>No service</span>
          </div>
          <p className={styles.metricMuted}>&mdash;</p>
          <p className={styles.cardNote}>
            The Admin Service has no endpoint to create or list a case, so nothing can be counted
            yet.
          </p>
          <Link to="/admin/escalations" className={styles.secondaryAction}>
            Review queue
          </Link>
        </section>

        <section className={styles.card}>
          <div className={styles.soonHead}>
            <h2 className={styles.cardTitle}>Suspended users</h2>
            <span className={styles.soonTag}>No service</span>
          </div>
          <p className={styles.metricMuted}>&mdash;</p>
          <p className={styles.cardNote}>
            Needs the Admin Service user list, which the User Service does not back yet.
          </p>
          <Link to="/admin/users" className={styles.secondaryAction}>
            User management
          </Link>
        </section>
      </div>

      <section className={styles.activity}>
        <div className={styles.soonHead}>
          <h2 className={styles.cardTitle}>Recent activity</h2>
          <span className={styles.soonTag}>No source</span>
        </div>
        {/*
          The mockup lists escalations submitted, suppliers submitted, credit
          adjustments and suspensions in one feed. Nothing publishes such a
          feed: Admin NFR2.1 logs privileged actions, but that is an audit log
          nobody exposes, and it would not carry submissions by other people.
          Recorded in docs/open-items.md.
        */}
        <p className={styles.activityBody}>
          A single feed of submissions, escalations, credit adjustments and suspensions. No
          service publishes one. The closest thing that exists is the audit log Admin NFR2.1
          requires, which is not exposed and would not cover activity by other users.
        </p>
      </section>
    </div>
  );
}
