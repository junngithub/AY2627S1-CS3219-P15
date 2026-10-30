/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Per-test database reset, adapted from rating-service; also seeds the catalog.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeEach } from 'vitest';
import catalogSeed from '../src/catalog/badges.json' with { type: 'json' };
import { config } from '../src/config.js';
import { db, queryClient } from '../src/database/index.js';
import { seedCatalog } from '../src/services/catalog.service.js';
import type { BadgeDefinition } from '../src/types.js';

// Safety net: never truncate a non-test database.
if (!config.databaseUrl.includes('badges_test')) {
  throw new Error(`Refusing to run tests against non-test database: ${config.databaseUrl}`);
}

// Clean slate before every test, with the real catalog in place (user_badge needs it).
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE badge_catalog, counted_order, disputed_order, user_metrics, user_badge, job_run RESTART IDENTITY CASCADE`,
  );
  await seedCatalog(catalogSeed as BadgeDefinition[]);
});

afterAll(async () => {
  await queryClient.end({ timeout: 5 });
});
