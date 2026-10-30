/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5)
 * Scope: Generated the guard that sends unverified accounts to the Telegram
 *        verification step.
 * Reviewed by Ngooi Jun Sen.
 */

import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthProvider';

/**
 * Sits inside RequireAuth around the app pages. A Created account can log in
 * (User F2) but cannot use the app yet: it has no credits until Credit sees
 * UserVerified, and Order rejects unverified users. So rather than open pages
 * whose every call fails, send it to finish verification (User F1.5).
 *
 * Like RequireAuth this is the client-side half only; the services enforce it.
 */
export function RequireVerified() {
  const { user } = useAuth();

  if (user?.status === 'Created') {
    return <Navigate to="/verify-telegram" replace />;
  }

  return <Outlet />;
}
