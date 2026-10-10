/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the session context: who is signed in, signing in, and
 *        signing out.
 * Reviewed by Ngooi Jun Sen.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, UNAUTHORIZED_EVENT } from '../lib/api';
import { AUTH_ENABLED, clearToken, setToken } from '../lib/session';
import { DEMO_USER } from '../samples/account';

/** The signed-in user, as the pages see it. */
export interface CurrentUser {
  userId: string;
  name: string;
  email: string;
  status: 'Created' | 'Verified' | 'Suspended';
  isAdmin: boolean;
}

/** User F3: `GET /api/v1/user/me` as the service returns it. */
interface MeResponse {
  id: string;
  name: string;
  email: string;
  telegramHandle: string;
  status: CurrentUser['status'];
  isAdmin: boolean;
}

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: AuthStatus;
  user: CurrentUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(AUTH_ENABLED ? 'loading' : 'authenticated');
  const [user, setUser] = useState<CurrentUser | null>(AUTH_ENABLED ? null : DEMO_USER);

  const refresh = useCallback(async () => {
    if (!AUTH_ENABLED) return;
    try {
      const me = await api.get<MeResponse>('/user/me');
      // The service calls it id; every page, and the admin user rows, call it
      // userId. Without this, "is this row me?" checks never match.
      setUser({
        userId: me.id,
        name: me.name,
        email: me.email,
        status: me.status,
        isAdmin: me.isAdmin,
      });
      setStatus('authenticated');
    } catch {
      // Any failure here means "not signed in". The reason is deliberately not
      // shown anywhere: UI FR3.2.1 keeps sign-in failures indistinguishable.
      clearToken();
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  // Restore the session on a hard refresh.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Any 401 from any service ends the session, so RequireAuth sends the user
  // to login instead of leaving them on a page whose calls all fail.
  useEffect(() => {
    if (!AUTH_ENABLED) return undefined;
    function onUnauthorized() {
      setUser(null);
      setStatus('anonymous');
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!AUTH_ENABLED) {
        setUser(DEMO_USER);
        setStatus('authenticated');
        return;
      }

      // TODO(user-service): the contract does not say what login returns. This
      // assumes { token }. If it sets an HttpOnly cookie instead, drop the
      // setToken call and nothing else changes - see src/lib/session.ts.
      const result = await api.post<{ token?: string }>('/user/login', { email, password });
      if (result?.token) {
        setToken(result.token);
      }
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    // TODO(user-service): the contract has no logout endpoint. If one appears,
    // call it here so the server can invalidate the session too.
    clearToken();
    setUser(null);
    setStatus(AUTH_ENABLED ? 'anonymous' : 'authenticated');
  }, []);

  const value = useMemo(
    () => ({ status, user, signIn, signOut, refresh }),
    [status, user, signIn, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}
