/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Generated configuration loading for the Fastify port, modelled on rating-service.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

// Load a local .env if present (dev); a missing file is fine in production.
try {
  process.loadEnvFile();
} catch {
  // no .env — use process.env / defaults
}

const DEFAULT_DATABASE_URL = 'postgres://badges:badges@localhost:5434/badges_db';

function toInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer environment value: "${value}"`);
  }
  return parsed;
}

// TLS is required for every database except one on this machine (the dev/test
// Postgres from docker-compose has no TLS). DB_SSL=false is an explicit opt-out.
export function sslRequired(databaseUrl: string, override = process.env.DB_SSL): boolean {
  if (override !== undefined && override !== '') return override !== 'false';
  const { hostname } = new URL(databaseUrl);
  return !['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
}

// Comma-separated. Empty means run without Kafka: HTTP and the daily run only.
export function brokerList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((b) => b.trim())
    .filter((b) => b !== '');
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '0.0.0.0',
  port: toInt(process.env.BADGES_SERVICE_PORT ?? process.env.PORT, 8086),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  dbSsl: sslRequired(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL),
  dbPoolMax: toInt(process.env.DB_POOL_MAX, 10),
  // Peers the daily run pulls from (short names resolve within the env's namespace).
  userServiceUrl: process.env.USER_SERVICE_URL ?? 'http://localhost:8080',
  orderServiceUrl: process.env.ORDER_SERVICE_URL ?? 'http://localhost:8083',
  httpTimeoutMs: toInt(process.env.HTTP_TIMEOUT_MS, 10_000),
  // NFR1.1.1: the daily run works in batches of at most 1,000 users.
  batchSize: Math.min(toInt(process.env.BADGES_BATCH_SIZE, 1000), 1000),
  schedule: {
    // F2.1: daily at 22:00 UTC.
    cron: process.env.BADGES_CRON ?? '0 22 * * *',
    timezone: process.env.BADGES_CRON_TZ ?? 'UTC',
    enabled: process.env.BADGES_SCHEDULE_ENABLED !== 'false',
  },
  kafka: {
    // Names match what deploy/charts/foc-service injects (see deploy/README.md).
    brokers: brokerList(process.env.KAFKA_BROKERS),
    username: process.env.KAFKA_USERNAME ?? '',
    password: process.env.KAFKA_PASSWORD ?? '',
    caCert: process.env.KAFKA_CA_CERT ?? '',
    clientId: process.env.SERVICE_NAME ?? 'badges-service',
    // The badges KafkaUser may read consumer groups prefixed "badges" (ADR-0004).
    groupId: process.env.KAFKA_GROUP_ID ?? 'badges-service',
    orderTopic: 'foc.order.status',
    ratingTopic: 'foc.user.rating',
    // NFR3.1.1: a message that fails more than 3 times is logged and skipped.
    maxAttempts: toInt(process.env.KAFKA_MAX_ATTEMPTS, 4),
  },
} as const;

export type AppConfig = typeof config;
