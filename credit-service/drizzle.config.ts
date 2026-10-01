import { defineConfig } from 'drizzle-kit';

// drizzle-kit doesn't auto-load .env — load it so db:* commands see DATABASE_URL.
try {
  process.loadEnvFile();
} catch {
  // no .env — use process.env / default below
}

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://credit:credit@localhost:5432/credit_db';

export default defineConfig({
  schema: './src/database/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: DATABASE_URL },
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
