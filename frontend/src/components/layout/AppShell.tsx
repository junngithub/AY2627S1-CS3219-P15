/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the signed-in page shell: top nav with mode tabs, credit
 *        balance, notifications and profile; hamburger menu below 768px.
 * Reviewed by Ngooi Jun Sen.
 */

import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { Icon } from '../ui/Icon';
import { useCreditBalance } from '../../lib/credit';
import { orderReference } from '../../lib/orders';
import styles from './AppShell.module.css';

// UI FR5.2: the three mode tabs.
const MODE_TABS = [
  { to: '/browse', label: 'Browse requests' },
  { to: '/my-requests', label: 'My requests' },
  { to: '/my-deliveries', label: 'My deliveries' },
];

/*
 * Admins also get a way into the admin area (UI FR15). Shown only to them:
 * Admin F2.2.1 keeps the admin pages unknown to everyone else, and the routes
 * are registered for admins only (App.tsx), so the link would 404 anyway.
 */
const ADMIN_TAB = { to: '/admin', label: 'Admin' };

const MENU_LINKS = [
  ...MODE_TABS,
  { to: '/requests/new', label: 'New request' },
  { to: '/suppliers', label: 'Suppliers' },
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

/**
 * Routes whose mockups replace the app nav with a back-and-title bar on
 * mobile. Same idea as AuthLayout's per-route lists: the mockups are not
 * uniform, so the exceptions are named in one place.
 */
const OWN_MOBILE_HEADER_ROUTES = ['/requests/new'];

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const { user } = useAuth();
  const isAdmin = user?.isAdmin === true;
  const tabs = isAdmin ? [...MODE_TABS, ADMIN_TAB] : MODE_TABS;
  const menuLinks = isAdmin ? [...MENU_LINKS, ADMIN_TAB] : MENU_LINKS;

  // Close the mobile menu whenever the route changes.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  const creditBalance = useCreditBalance();
  /*
   * TODO(order-service): GET /api/v1/orders/alerts lists status changes, but
   * nothing records which ones were read, so there is no unread state to show.
   */
  const hasUnreadNotifications = false;

  const orderMatch = location.pathname.match(/^\/orders\/(.+)$/)?.[1];
  const requestReference = orderMatch === undefined ? undefined : orderReference(orderMatch);
  const taskMatch = location.pathname.match(/^\/deliveries\/(.+)$/)?.[1];
  const taskReference = taskMatch === undefined ? undefined : orderReference(taskMatch);
  const hidesNavOnMobile =
    OWN_MOBILE_HEADER_ROUTES.includes(location.pathname) ||
    requestReference !== undefined ||
    taskReference !== undefined;

  return (
    <div className={styles.shell}>
      <header className={hidesNavOnMobile ? `${styles.nav} ${styles.navDesktopOnly}` : styles.nav}>
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

        <Link to="/browse" className={styles.logo}>
          FoC
        </Link>

        {/*
          On an order page the mockup replaces the mode tabs with a trail.
          TODO(ui): it reads "My requests / Request #1042" even when the order
          is one you are delivering, where it should lead back to My
          deliveries. Nothing identifies which side you are on yet.
        */}
        {requestReference !== undefined ? (
          <nav className={styles.trail} aria-label="Breadcrumb">
            <Link to="/my-requests">My requests</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Request #{requestReference}</span>
          </nav>
        ) : taskReference !== undefined ? (
          <nav className={styles.trail} aria-label="Breadcrumb">
            <Link to="/my-deliveries">My deliveries</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Task #{taskReference}</span>
          </nav>
        ) : (
          <nav className={styles.tabs} aria-label="Mode">
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) => (isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab)}
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className={styles.actions}>
          <span className={styles.credits} title="Available credits">
            {creditBalance === null ? (
              '--'
            ) : (
              <>
                {creditBalance}
                <span className={styles.creditsLong}>
                  &nbsp;available
                  {/* TODO(credit): "· N reserved" - the balance endpoint
                      returns the available figure only. */}
                </span>
                <span className={styles.creditsShort}>&nbsp;cr</span>
              </>
            )}
          </span>
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
          {menuLinks.map((link) => (
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
