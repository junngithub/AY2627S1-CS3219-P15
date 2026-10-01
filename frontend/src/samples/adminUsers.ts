/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated sample data standing in for a service that does not exist.
 *
 * THROWAWAY. See src/samples/README.md.
 *
 * The four rows from the user management mockup. The Admin Service is
 * unwritten, so nothing here comes from anywhere.
 */

import type { AdminUser } from '../lib/adminUsers';

export const SAMPLE_ADMIN_USERS: AdminUser[] = [
  // The demo user from samples/account.ts, so their own row shows the "You"
  // tag and no Suspend button.
  {
    userId: 'demo-user',
    name: 'Priya Nair',
    email: 'e1234567@u.nus.edu',
    status: 'Verified',
    isAdmin: true,
    credits: 20,
  },
  {
    userId: 'usr-2',
    name: 'Jun Tao Lim',
    email: 'e7654321@u.nus.edu',
    status: 'Verified',
    isAdmin: false,
    credits: 31,
  },
  {
    userId: 'usr-3',
    name: 'Daniel Ong',
    email: 'e2468101@u.nus.edu',
    status: 'Suspended',
    isAdmin: false,
    credits: 7,
  },
  {
    userId: 'usr-4',
    name: 'Wei Lun Tan',
    email: 'e1357911@u.nus.edu',
    status: 'Created',
    isAdmin: false,
    credits: 20,
  },
];

/** The mockup's "1,284 users - 2 suspended". */
export const SAMPLE_USER_TOTALS = { total: 1284, suspended: 2 };
