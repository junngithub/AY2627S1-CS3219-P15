import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateOtp,
  generateSessionToken,
  hashOtp,
  hashPassword,
  hashSessionToken,
  isAllowedEmail,
  isValidTelegramHandle,
  normalizeEmail,
  normalizeTelegramHandle,
  passwordValidationErrors,
  safeHashEqual,
  verifyPassword,
} from "./security";

describe("email validation", () => {
  const domains = ["u.nus.edu", "nus.edu.sg"];

  it("normalizes email casing and whitespace", () => {
    assert.equal(normalizeEmail("  Student@U.NUS.EDU "), "student@u.nus.edu");
  });

  it("accepts exact configured domains", () => {
    assert.equal(isAllowedEmail("student@u.nus.edu", domains), true);
    assert.equal(isAllowedEmail("staff@nus.edu.sg", domains), true);
  });

  it("rejects lookalike and subdomains", () => {
    assert.equal(isAllowedEmail("student@u.nus.edu.example.com", domains), false);
    assert.equal(isAllowedEmail("student@fake-u.nus.edu", domains), false);
    assert.equal(isAllowedEmail("student@gmail.com", domains), false);
  });
});

describe("password handling", () => {
  it("reports every unmet password requirement", () => {
    assert.deepEqual(passwordValidationErrors("short"), [
      "must contain at least 10 characters",
      "must contain an uppercase letter",
      "must contain a number",
    ]);
  });

  it("accepts a compliant password", () => {
    assert.deepEqual(passwordValidationErrors("SecurePass1"), []);
  });

  it("uses unique salts and verifies only the correct password", async () => {
    const first = await hashPassword("SecurePass1", 1024);
    const second = await hashPassword("SecurePass1", 1024);

    assert.notEqual(first, second);
    assert.equal(await verifyPassword("SecurePass1", first), true);
    assert.equal(await verifyPassword("WrongPass1", first), false);
  });
});

describe("Telegram, OTP and session helpers", () => {
  it("normalizes and validates Telegram handles", () => {
    assert.equal(normalizeTelegramHandle(" @Josh_User "), "josh_user");
    assert.equal(isValidTelegramHandle("@josh_user"), true);
    assert.equal(isValidTelegramHandle("bad!"), false);
  });

  it("generates six-digit OTPs and compares their hashes", () => {
    const otp = generateOtp();
    assert.match(otp, /^\d{6}$/);

    const hash = hashOtp("student@u.nus.edu", otp, "test-secret");
    const sameHash = hashOtp("STUDENT@U.NUS.EDU", otp, "test-secret");
    const otherHash = hashOtp("student@u.nus.edu", "000000", "test-secret");
    assert.equal(safeHashEqual(hash, sameHash), true);
    assert.equal(safeHashEqual(hash, otherHash), false);
  });

  it("generates non-reversible session tokens", () => {
    const token = generateSessionToken();
    assert.ok(token.length > 30);
    assert.notEqual(hashSessionToken(token), token);
  });
});
