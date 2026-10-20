/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the route guard for signed-in pages.
 * Reviewed by Ngooi Jun Sen.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';

/**
 * Wraps every signed-in route. While the session is being restored it renders
 * nothing rather than flashing the login page at someone who is signed in.
 *
 * The attempted URL is carried along so login can return the user to it. Note
 * this is the client-side half only: the server still has to reject the calls,
 * because anything enforced in the browser can be turned off in the browser.
 */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return null;
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  }

  return <Outlet />;
}
