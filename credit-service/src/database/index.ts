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
export { schema };
