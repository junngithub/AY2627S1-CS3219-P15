/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated sample data standing in for a service that does not exist.
 *
 * THROWAWAY. See src/samples/README.md.
 */

import type { CurrentUser } from '../auth/AuthProvider';

/**
 * Stands in while AUTH_ENABLED is false, so the signed-in screens can be
 * demonstrated before the User Service exists.
 */
export const DEMO_USER: CurrentUser = {
  userId: 'demo-user',
  name: 'Priya Nair',
  email: 'e1234567@u.nus.edu',
  status: 'Verified',
  /**
   * Set this to true to reach the admin screens, including the supplier
   * approval queue that D2 asks to be demonstrated. App.tsx registers the
   * admin routes only for admins, so with this false /admin/suppliers is a
   * not-found page. Real role information comes from the User Service.
   */
  isAdmin: true,
};

/**
 * One figure for the whole app so the nav bar and the new-request form cannot
 * disagree. The mockups show 20, 18 and 16 on different screens.
 *
 * Real source: GET /api/v1/credit/me/balance.
 */
export const SAMPLE_CREDIT_BALANCE = 18;

/**
 * The My requests mockup reads "16 available - 4 reserved", so the balance
 * endpoint has to return both figures. The contract does not say what it
 * returns at all.
 */
export const SAMPLE_CREDIT_RESERVED = 4;

/**
 * The profile's breakdown line. Credit F1.3 keeps an immutable ledger and
 * `GET /api/v1/credit/me/ledger` returns it, but nothing aggregates it into
 * earned, spent and granted - the profile would have to page the whole
 * ledger and add it up. Recorded in docs/open-items.md.
 */
export const SAMPLE_CREDIT_BREAKDOWN = {
  earnedAsCourier: 14,
  spentAsRequester: 14,
  grantedAtSignup: 20,
};
