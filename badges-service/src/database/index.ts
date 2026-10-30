/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Generated the Drizzle client, copied from rating-service.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config.js';
import * as schema from './schema.js';

// postgres.js connects lazily, so importing this module never blocks on the DB.
export const queryClient = postgres(config.databaseUrl, {
  max: config.dbPoolMax,
  ssl: config.dbSsl,
});

export const db = drizzle(queryClient, { schema, casing: 'snake_case' });

export type Database = typeof db;
// The database or an open transaction: services take either, so one can join the other's transaction.
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];
export { schema };
