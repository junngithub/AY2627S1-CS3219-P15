/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the signed-in page shell: top nav with mode tabs,
 *        notifications and profile; hamburger menu below 768px.
 * Reviewed by Ngooi Jun Sen.
 */

import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { Icon } from '../ui/Icon';
import styles from './AppShell.module.css';

// D2 scope: suppliers only. UI FR5.2's three mode tabs (browse, my requests,
// my deliveries) come back with the Order Service.
const MODE_TABS = [{ to: '/suppliers', label: 'Suppliers' }];

const MENU_LINKS = [
  ...MODE_TABS,
  { to: '/profile', label: 'Profile' },
  { to: '/account-status', label: 'Account status' },
];

/**
 * TODO(user-service): the contract's GET /api/v1/user/me returns a name, but
 * sign-up never collects one, so initials fall back to the email address.
 * Recorded in docs/open-items.md.
 */
function initialsFor(email: string | undefined): string {
  if (!email) return '?';
  return email.slice(0, 2).toUpperCase();
}

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const { user } = useAuth();

  // Close the mobile menu whenever the route changes.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  // TODO(team): nothing delivers live updates yet, so this is only a sample.
  const hasUnreadNotifications = true;

  return (
    <div className={styles.shell}>
      <header className={styles.nav}>
        <button
          type="button"
          className={styles.hamburger}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Icon name={menuOpen ? 'close' : 'menu'} />
        </button>

        <Link to="/suppliers" className={styles.logo}>
          FoC
        </Link>

        <nav className={styles.tabs} aria-label="Mode">
          {MODE_TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) => (isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab)}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <div className={styles.actions}>
          <button type="button" className={styles.iconButton} aria-label="Notifications">
            <Icon name="bell" />
            {hasUnreadNotifications ? <span className={styles.unreadDot} /> : null}
          </button>
          <Link to="/profile" className={styles.profile} aria-label="Profile">
            <span className={styles.avatar} aria-hidden="true">
              {initialsFor(user?.email)}
            </span>
            <span className={styles.chevron} aria-hidden="true">
              <Icon name="chevronDown" size={16} />
            </span>
          </Link>
        </div>
      </header>

      {menuOpen ? (
        <nav id="mobile-menu" className={styles.mobileMenu} aria-label="Main">
          {MENU_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                isActive ? `${styles.menuLink} ${styles.menuLinkActive}` : styles.menuLink
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      ) : null}

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
