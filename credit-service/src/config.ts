// Load a local .env if present (dev); a missing file is fine in production.
try {
  process.loadEnvFile();
} catch {
  // no .env — use process.env / defaults
}

const DEFAULT_DATABASE_URL = 'postgres://credit:credit@localhost:5432/credit_db';

function toInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer environment value: "${value}"`);
  }
  return parsed;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '0.0.0.0',
  port: toInt(process.env.CREDIT_SERVICE_PORT ?? process.env.PORT, 3000),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  dbPoolMax: toInt(process.env.DB_POOL_MAX, 10),
} as const;

export type AppConfig = typeof config;
