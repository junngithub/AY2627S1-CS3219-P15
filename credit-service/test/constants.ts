// Test database connection strings. No app imports here so this module is safe
// to load from vitest.config.ts.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://credit:credit@localhost:5432/credit_test';

// Maintenance DB used only to CREATE the test database.
export const ADMIN_DATABASE_URL =
  process.env.ADMIN_DATABASE_URL ?? 'postgres://credit:credit@localhost:5432/postgres';
