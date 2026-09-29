/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the admin user type and the calls the page would make.
 * Reviewed by Ngooi Jun Sen, removed unnecessary code that described user roles.
 */

/**
 * A row of UI FR17's user table.
 *
 * TODO(admin): `GET /api/v1/admin/users?search=&page=` in the contract. 
 */
export interface AdminUser {
  userId: string;
  name: string;
  email: string;
  status: 'Created' | 'Verified' | 'Suspended';
  isAdmin: boolean;
  /**
   * TODO(credit): the mockup shows a balance per user. Credit exposes
   * `/credit/me/balance` for the signed-in person only; nothing lets an
   * admin read someone else's.
   */
  credits: number;
}

