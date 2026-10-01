import { sql } from 'drizzle-orm';
import { afterAll, beforeEach } from 'vitest';
import { config } from '../src/config.js';
import { db, queryClient } from '../src/database/index.js';

// Safety net: never truncate a non-test database.
if (!config.databaseUrl.includes('credit_test')) {
  throw new Error(`Refusing to run tests against non-test database: ${config.databaseUrl}`);
}

// Clean slate before every test; RESTART IDENTITY keeps log_id deterministic.
beforeEach(async () => {
  await db.execute(sql`TRUNCATE credit_log, credit_order, credit_user RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await queryClient.end({ timeout: 5 });
});
