import { sql } from 'drizzle-orm';
import { afterAll, beforeEach } from 'vitest';
import { config } from '../src/config.js';
import { db, queryClient } from '../src/database/index.js';

// Safety net: never truncate a non-test database.
if (!config.databaseUrl.includes('rating_test')) {
  throw new Error(`Refusing to run tests against non-test database: ${config.databaseUrl}`);
}

// Clean slate before every test; RESTART IDENTITY keeps ids deterministic.
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE rating_grant, rating, user_rating, outbox RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await queryClient.end({ timeout: 5 });
});
