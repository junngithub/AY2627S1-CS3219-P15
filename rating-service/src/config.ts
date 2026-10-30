// Load a local .env if present (dev); a missing file is fine in production.
try {
  process.loadEnvFile();
} catch {
  // no .env — use process.env / defaults
}

const DEFAULT_DATABASE_URL = 'postgres://rating:rating@localhost:5433/rating_db';

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

// Comma-separated. Empty means run without Kafka: HTTP only, outbox rows queue up.
export function brokerList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((b) => b.trim())
    .filter((b) => b !== '');
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '0.0.0.0',
  port: toInt(process.env.RATING_SERVICE_PORT ?? process.env.PORT, 8085),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  dbSsl: sslRequired(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL),
  dbPoolMax: toInt(process.env.DB_POOL_MAX, 10),
  kafka: {
    // Names match what deploy/charts/foc-service injects (see deploy/README.md).
    brokers: brokerList(process.env.KAFKA_BROKERS),
    username: process.env.KAFKA_USERNAME ?? '',
    password: process.env.KAFKA_PASSWORD ?? '',
    caCert: process.env.KAFKA_CA_CERT ?? '',
    clientId: process.env.SERVICE_NAME ?? 'rating-service',
    // The rating KafkaUser may read consumer groups prefixed "rating" (ADR-0004).
    groupId: process.env.KAFKA_GROUP_ID ?? 'rating-service',
    commandsTopic: 'foc.rating.commands',
    ratingTopic: 'foc.user.rating',
    // NFR3.1.1: a message that fails more than 3 times is logged and skipped.
    maxAttempts: toInt(process.env.KAFKA_MAX_ATTEMPTS, 4),
    outboxPollMs: toInt(process.env.OUTBOX_POLL_MS, 1000),
  },
} as const;

export type AppConfig = typeof config;
