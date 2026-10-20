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

// TLS is required for every database except one on this machine (the dev/test
// Postgres from docker-compose has no TLS). DB_SSL=false is an explicit opt-out.
export function sslRequired(databaseUrl: string, override = process.env.DB_SSL): boolean {
  if (override !== undefined && override !== '') return override !== 'false';
  const { hostname } = new URL(databaseUrl);
  return !['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
}

// Kafka: consumes foc.user.status (`UserVerified` → onboarding) and order's
// foc.credit.commands (settlements). The Helm chart injects these when the
// service's `kafka.user` is set; locally/in tests they are usually absent, so
// `enabled` is false and the consumers are not started.
const kafkaBrokers = (process.env.KAFKA_BROKERS ?? '')
  .split(',')
  .map((broker) => broker.trim())
  .filter(Boolean);

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '0.0.0.0',
  port: toInt(process.env.CREDIT_SERVICE_PORT ?? process.env.PORT, 3000),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  dbSsl: sslRequired(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL),
  dbPoolMax: toInt(process.env.DB_POOL_MAX, 10),
  kafka: {
    enabled: kafkaBrokers.length > 0,
    brokers: kafkaBrokers,
    username: process.env.KAFKA_USERNAME ?? '',
    password: process.env.KAFKA_PASSWORD ?? '',
    saslMechanism: process.env.KAFKA_SASL_MECHANISM ?? 'SCRAM-SHA-512',
    caCertPath: process.env.KAFKA_CA_CERT ?? '',
    userStatusTopic: process.env.KAFKA_USER_STATUS_TOPIC ?? 'foc.user.status',
    creditCommandsTopic: process.env.KAFKA_CREDIT_COMMANDS_TOPIC ?? 'foc.credit.commands',
    // One consumer group per topic (see src/kafka/consumer.ts). Both must be
    // prefixed `credit` — the KafkaUser ACL grants Read only on consumer
    // groups with that prefix (ADR-0004).
    userStatusGroupId: process.env.KAFKA_USER_STATUS_GROUP_ID ?? 'credit-user-status',
    creditCommandsGroupId: process.env.KAFKA_CREDIT_COMMANDS_GROUP_ID ?? 'credit-commands',
    clientId: process.env.KAFKA_CLIENT_ID ?? 'credit-service',
  },
} as const;

export type AppConfig = typeof config;
