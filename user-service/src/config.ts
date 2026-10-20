import "dotenv/config";
import { testVerificationAllowed } from "./integration-access";

function positiveInteger(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const appEnv = (process.env.APP_ENV ?? nodeEnv).toLowerCase();
const otpSecret = process.env.OTP_SECRET ?? "local-development-secret-change-me";
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
const telegramBotUsername = (process.env.TELEGRAM_BOT_USERNAME ?? "").replace(/^@/, "");
if (telegramBotToken && !/^[A-Za-z0-9_]{5,32}$/.test(telegramBotUsername)) {
  throw new Error("TELEGRAM_BOT_USERNAME must be configured when TELEGRAM_BOT_TOKEN is set");
}

if (nodeEnv === "production" && otpSecret === "local-development-secret-change-me") {
  throw new Error("OTP_SECRET must be configured in production");
}

// Kafka (foc.user.status producer). The Helm chart injects these when the
// service's `kafka.user` is set; locally/in tests they are usually absent, so
// `enabled` is false and verification events remain in the database outbox.
const kafkaBrokers = (process.env.KAFKA_BROKERS ?? "")
  .split(",")
  .map((broker) => broker.trim())
  .filter(Boolean);

export const config = {
  nodeEnv,
  appEnv,
  orderUserLookupToken: process.env.ORDER_USER_LOOKUP_TOKEN ?? "",
  testVerificationEnabled: testVerificationAllowed(process.env.ENABLE_TEST_VERIFICATION, appEnv),
  deletionSweepIntervalSeconds: positiveInteger("USER_DELETION_SWEEP_INTERVAL_SECONDS", 3600),
  port: positiveInteger("PORT", 8080),
  allowedEmailDomains: (process.env.ALLOWED_EMAIL_DOMAINS ?? "u.nus.edu,nus.edu.sg")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean),
  otpSecret,
  otpTtlMinutes: positiveInteger("OTP_TTL_MINUTES", 10),
  otpMaxAttempts: positiveInteger("OTP_MAX_ATTEMPTS", 5),
  passwordResetTtlMinutes: positiveInteger("PASSWORD_RESET_TTL_MINUTES", 30),
  frontendBaseUrl: process.env.FRONTEND_BASE_URL ?? "http://localhost:5173",
  sessionTtlHours: positiveInteger("SESSION_TTL_HOURS", 24),
  loginMaxAttempts: positiveInteger("LOGIN_MAX_ATTEMPTS", 5),
  passwordScryptCost: positiveInteger("PASSWORD_SCRYPT_COST", 16384),
  telegram: {
    botToken: telegramBotToken,
    botUsername: telegramBotUsername,
    development: nodeEnv === "development" && !telegramBotToken,
    resendCooldownSeconds: positiveInteger("TELEGRAM_RESEND_COOLDOWN_SECONDS", 60),
  },
  kafka: {
    enabled: kafkaBrokers.length > 0,
    brokers: kafkaBrokers,
    username: process.env.KAFKA_USERNAME ?? "",
    password: process.env.KAFKA_PASSWORD ?? "",
    saslMechanism: process.env.KAFKA_SASL_MECHANISM ?? "SCRAM-SHA-512",
    caCertPath: process.env.KAFKA_CA_CERT ?? "",
    topic: process.env.KAFKA_USER_STATUS_TOPIC ?? "foc.user.status",
    clientId: process.env.KAFKA_CLIENT_ID ?? "user-service",
  },
};
