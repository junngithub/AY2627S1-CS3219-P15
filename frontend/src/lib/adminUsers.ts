/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the admin user type and the calls the page makes.
 * Reviewed by Ngooi Jun Sen, removed unnecessary code that described user roles.
 *
 * The Admin Service endpoints from the API contract. Each one is validated
 * through the User Service on every request (Admin F2.1.1), and a non-admin
 * gets 404 rather than 403 (F2.2.1).
 *
 * While AUTH_ENABLED is off these read and change the sample rows in
 * src/samples/adminUsers.ts instead, so the page can be walked before the
 * Admin Service exists.
 */

import { api } from './api';
import { AUTH_ENABLED } from './session';
import { SAMPLE_ADMIN_USERS } from '../samples/adminUsers';

/** A row of UI FR17's user table. */
export interface AdminUser {
  userId: string;
  name: string;
  email: string;
  status: 'Created' | 'Verified' | 'Suspended';
  isAdmin: boolean;
  /**
   * TODO(credit): the mockup shows a balance per user. Credit exposes
   * `/credit/me/balance` for the signed-in person only; nothing lets an
   * admin read someone else's, so this is absent from real responses.
   */
  credits?: number;
}

/** Contract's page size is unstated; this matches the supplier default. */
export const ADMIN_USERS_PAGE_SIZE = 20;

export interface AdminUserPage {
  items: AdminUser[];
  page: number;
  hasMore: boolean;
}

/**
 * `GET /api/v1/admin/users?search=&page=` (Admin F1, NFR1.1).
 *
 * TODO(admin): the contract gives the parameters but not the response. This
 * accepts either a bare array, as the Supplier Service returns, or
 * `{ content }`, as the Order Service returns, until the Admin Service says.
 */
export async function fetchAdminUsers(search: string, page: number): Promise<AdminUserPage> {
  if (!AUTH_ENABLED) {
    const needle = search.trim().toLowerCase();
    const items = SAMPLE_ADMIN_USERS.filter((user) =>
      `${user.name} ${user.email}`.toLowerCase().includes(needle),
    );
    return { items, page, hasMore: false };
  }

  const params = new URLSearchParams({ page: String(page) });
  if (search.trim() !== '') params.set('search', search.trim());

  const result = await api.get<AdminUser[] | { content: AdminUser[] }>(
    `/admin/users?${params.toString()}`,
  );
  const items = Array.isArray(result) ? result : result.content;
  return { items, page, hasMore: items.length >= ADMIN_USERS_PAGE_SIZE };
}

/** Changes a sample row in demo mode, the way the service would. */
function updateSample(userId: string, change: Partial<AdminUser>): void {
  const row = SAMPLE_ADMIN_USERS.find((user) => user.userId === userId);
  if (row) Object.assign(row, change);
}

/** Admin F1.1. Admin calls the User Service to apply the role change. */
export async function promoteUser(userId: string): Promise<void> {
  if (!AUTH_ENABLED) return updateSample(userId, { isAdmin: true });
  await api.post(`/admin/users/${encodeURIComponent(userId)}/promote`);
}

/** Admin F1.2. Takes effect within 60 seconds (F1.2.1). */
export async function suspendUser(userId: string): Promise<void> {
  if (!AUTH_ENABLED) return updateSample(userId, { status: 'Suspended' });
  await api.post(`/admin/users/${encodeURIComponent(userId)}/suspend`);
}

/**
 * Admin F1.3. Logged (F1.3.2).
 *
 * TODO(admin): the contract does not say what status a reinstated account
 * returns to. Demo mode assumes Verified.
 */
export async function reinstateUser(userId: string): Promise<void> {
  if (!AUTH_ENABLED) return updateSample(userId, { status: 'Verified' });
  await api.post(`/admin/users/${encodeURIComponent(userId)}/reinstate`);
}
