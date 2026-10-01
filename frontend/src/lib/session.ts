/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the session token store and the single switch that decides
 *        where the token lives.
 * Reviewed by Ngooi Jun Sen.
 */

/**
 * Off until the User Service exists. While off the app treats every visitor
 * as the demo user in src/samples/account.ts, and every User and Admin call
 * is stubbed, so the auth pages and the signed-in shell stay walkable.
 *
 * Turn it on with VITE_AUTH_ENABLED=true (in frontend/.env.local, or on the
 * command line) the day login returns a real token. Supplier calls are real
 * either way.
 */
export const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED === 'true';

/**
 * WHERE THE TOKEN LIVES - the decision to make before the codebase grows.
 *
 * Today the token is held in this module and mirrored into sessionStorage so a
 * page refresh does not sign the user out. That is the ordinary single-page-app
 * arrangement, and it means any script running in the page can read the token.
 *
 * The alternative is an HttpOnly cookie set by the User Service. It cannot be
 * read by script, and the browser attaches it to ordinary page navigations,
 * which is what nginx would need in order to refuse to serve /admin at all to a
 * non-admin (see "rung four" in docs/open-items.md, and Admin F2.2.1).
 *
 * If the team takes the cookie route, the changes are: this file becomes a
 * no-op, `src/lib/api.ts` stops setting the Authorization header, and the User
 * Service sets and clears the cookie on login and logout. Everything else in
 * the frontend is unaffected, because nothing outside these two files touches
 * the token. Keep it that way.
 */
const STORAGE_KEY = 'foc.token';

let inMemoryToken: string | null = null;

function readMirror(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Private windows and blocked site data both throw here.
    return null;
  }
}

function writeMirror(token: string | null): void {
  try {
    if (token === null) {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(STORAGE_KEY, token);
    }
  } catch {
    // Non-fatal: the in-memory copy still carries this tab's session.
  }
}

export function getToken(): string | null {
  if (inMemoryToken === null) {
    inMemoryToken = readMirror();
  }
  return inMemoryToken;
}

export function setToken(token: string): void {
  inMemoryToken = token;
  writeMirror(token);
}

export function clearToken(): void {
  inMemoryToken = null;
  writeMirror(null);
}
