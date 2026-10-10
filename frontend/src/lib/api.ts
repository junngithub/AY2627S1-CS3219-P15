/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the HTTP client every page calls the backend through.
 * Reviewed by Ngooi Jun Sen.
 *
 * Paths follow the API contract: /api/v1/{service}/... . They are relative on
 * purpose - the dev server and the nginx container both proxy that prefix to
 * the right service, so the browser only ever talks to its own origin and no
 * service needs CORS.
 */

import { clearToken, getToken } from './session';

const DEFAULT_TIMEOUT_MS = 10_000;

/** Fired on any 401, so the session can end without every page checking. */
export const UNAUTHORIZED_EVENT = 'foc:unauthorized';

/** The contract fixes the error body as { error, code }. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export class NetworkError extends Error {
  constructor(message = 'Could not reach the server') {
    super(message);
    this.name = 'NetworkError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Serialised as JSON. Omit for multipart; pass a FormData body instead. */
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * One place where every outgoing call is shaped: the bearer token, the JSON
 * headers, the timeout, and turning a failure into an ApiError the pages can
 * read. `credentials: 'include'` is set so that if the team moves the token
 * into an HttpOnly cookie, requests already carry it (see src/lib/session.ts).
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token !== null) {
    headers.authorization = `Bearer ${token}`;
  }

  const isFormData = body instanceof FormData;
  if (body !== undefined && !isFormData) {
    headers['content-type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new NetworkError('The server took too long to respond');
    }
    throw new NetworkError();
  }

  if (response.status === 401) {
    // The token is gone or expired. Drop it, and tell AuthProvider so the
    // route guard sends the user back to login rather than retrying with
    // something already rejected.
    clearToken();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  let payload: unknown = null;
  const text = await response.text();
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const shape = payload as { error?: string; code?: string } | null;
    throw new ApiError(
      response.status,
      shape?.code ?? 'UNKNOWN',
      shape?.error ?? `Request failed with status ${response.status}`,
    );
  }

  return payload as T;
}

/**
 * What to tell the user when a call fails. A denied request is named as such
 * rather than reported as an outage, so a user without the right role sees
 * why (D2 Part 2 point 2: "respond to denied requests").
 *
 * 404 is not translated: Admin F2.2.1 answers non-admins with 404 on purpose,
 * so the caller decides what a 404 means on its own page.
 */
export function errorMessage(error: unknown, unreachable: string): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Your session has ended. Log in again.';
    if (error.status === 403) return 'You do not have permission to do that.';
    return error.message;
  }
  return unreachable;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'DELETE', body }),
};
