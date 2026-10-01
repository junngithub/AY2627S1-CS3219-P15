/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5), date: 2026-09-23
 * Scope: Generated the centered-card layout shared by the auth pages.
 * Reviewed by Ngooi Jun Sen.
 */

import { Link, Outlet, useLocation } from 'react-router-dom';
import styles from './AuthLayout.module.css';

/** Routes whose form needs the wider card seen in the sign-up mockup. */
const WIDE_ROUTES = ['/signup'];

/**
 * Routes that drop the wordmark on mobile. The verification mockup starts
 * straight at the icon, while sign-up shows "FoC" above the heading.
 */
const NO_MOBILE_BRAND_ROUTES = ['/verify-email', '/verify-email/confirm'];

/** UI FR1.4, FR2.3, FR3.3, FR4.3: centered card on desktop, full width on mobile. */
export function AuthLayout() {
  const { pathname } = useLocation();
  const wide = WIDE_ROUTES.includes(pathname);
  const showMobileBrand = !NO_MOBILE_BRAND_ROUTES.includes(pathname);

  return (
    <div className={styles.page}>
      {/* Desktop: the wordmark sits in the page corner, outside the card. */}
      <Link to="/login" className={styles.pageBrand}>
        FoC
      </Link>

      <div className={[styles.card, wide ? styles.cardWide : ''].filter(Boolean).join(' ')}>
        {showMobileBrand ? <div className={styles.brand}>FoC</div> : null}
        <Outlet />
      </div>
    </div>
  );
}
