import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailDomain(email: string): string | null {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf("@");

  if (atIndex <= 0 || atIndex === normalized.length - 1) return null;
  if (normalized.indexOf("@") !== atIndex) return null;

  return normalized.slice(atIndex + 1);
}

export function isAllowedEmail(email: string, allowedDomains: string[]): boolean {
  const domain = emailDomain(email);
  return domain !== null && allowedDomains.includes(domain);
}

export function passwordValidationErrors(password: string): string[] {
  const errors: string[] = [];

  if (password.length < 10) errors.push("must contain at least 10 characters");
  if (!/[A-Z]/.test(password)) errors.push("must contain an uppercase letter");
  if (!/[a-z]/.test(password)) errors.push("must contain a lowercase letter");
  if (!/\d/.test(password)) errors.push("must contain a number");

  return errors;
}

export function normalizeTelegramHandle(handle: string): string {
  return handle.trim().replace(/^@/, "").toLowerCase();
}

export function isValidTelegramHandle(handle: string): boolean {
  return /^[a-z][a-z0-9_]{4,31}$/.test(normalizeTelegramHandle(handle));
}

function derivePasswordKey(
  password: string,
  salt: Buffer,
  cost: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: cost, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(password: string, cost: number): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await derivePasswordKey(password, salt, cost);
  return `scrypt$${cost}$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const [algorithm, costText, saltHex, expectedHex] = encodedHash.split("$");
  const cost = Number.parseInt(costText, 10);

  if (algorithm !== "scrypt" || !cost || !saltHex || !expectedHex) return false;

  const expected = Buffer.from(expectedHex, "hex");
  const actual = await derivePasswordKey(password, Buffer.from(saltHex, "hex"), cost);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashOtp(email: string, otp: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${normalizeEmail(email)}:${otp}`)
    .digest("hex");
}

export function safeHashEqual(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
