import "dotenv/config";

function positiveInteger(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const otpSecret = process.env.OTP_SECRET ?? "local-development-secret-change-me";

if (nodeEnv === "production" && otpSecret === "local-development-secret-change-me") {
  throw new Error("OTP_SECRET must be configured in production");
}

export const config = {
  nodeEnv,
  port: positiveInteger("PORT", 8080),
  allowedEmailDomains: (process.env.ALLOWED_EMAIL_DOMAINS ?? "u.nus.edu,nus.edu.sg")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean),
  otpSecret,
  otpTtlMinutes: positiveInteger("OTP_TTL_MINUTES", 10),
  otpMaxAttempts: positiveInteger("OTP_MAX_ATTEMPTS", 5),
  sessionTtlHours: positiveInteger("SESSION_TTL_HOURS", 24),
  loginMaxAttempts: positiveInteger("LOGIN_MAX_ATTEMPTS", 5),
  passwordScryptCost: positiveInteger("PASSWORD_SCRYPT_COST", 16384),
};
