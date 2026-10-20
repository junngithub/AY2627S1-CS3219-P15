/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the admin shell from the dashboard mockup.
 * Reviewed by Ngooi Jun Sen.
 *
 * The admin area has its own chrome: a left rail instead of the top nav,
 * which is FR15.1.2's "navigation links to all specialized admin management
 * sections". NFR11.1.1 keeps it readable below 768px rather than collapsing,
 * so the rail stacks above the content there instead of disappearing.
 */

import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { fetchSuppliersForAdmin } from '../../lib/suppliers';
import styles from './AdminLayout.module.css';

const SECTIONS = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/suppliers', label: 'Supplier approvals' },
  { to: '/admin/escalations', label: 'Escalations' },
  { to: '/admin/users', label: 'User management' },
  { to: '/admin/ratings', label: 'Rating lookup' },
];

export function AdminLayout() {
  const { user } = useAuth();
  const [pendingSuppliers, setPendingSuppliers] = useState<number | null>(null);

  // The one count that has a service behind it.
  useEffect(() => {
    let cancelled = false;
    fetchSuppliersForAdmin('pending')
      .then((rows) => {
        if (!cancelled) setPendingSuppliers(rows.length);
      })
      .catch(() => {
        if (!cancelled) setPendingSuppliers(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.shell}>
      <nav className={styles.rail} aria-label="Admin sections">
        <div className={styles.brand}>
          <span className={styles.logo}>FoC</span>
          <span className={styles.adminTag}>Admin</span>
        </div>

        <ul className={styles.sections}>
          {SECTIONS.map((section) => (
            <li key={section.to}>
              <NavLink
                to={section.to}
                end={section.end}
                className={({ isActive }) =>
                  isActive ? `${styles.section} ${styles.sectionActive}` : styles.section
                }
              >
                {section.label}
                {/*
                  TODO(admin): only the supplier count has a source. The
                  escalation count needs the Admin Service, which does not
                  exist; a badge is left off rather than shown as zero, which
                  would read as "nothing waiting".
                */}
                {section.to === '/admin/suppliers' && pendingSuppliers !== null ? (
                  <span className={styles.count}>{pendingSuppliers}</span>
                ) : null}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className={styles.signedIn}>
          <p className={styles.signedInLabel}>Signed in as</p>
          <p className={styles.signedInEmail}>{user?.email ?? 'unknown'}</p>
        </div>
      </nav>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
