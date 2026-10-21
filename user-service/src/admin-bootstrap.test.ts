import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdminBootstrapError, parseBootstrapAdminArguments, validateBootstrapCandidate } from "./admin-bootstrap";

const userId = "5999fc1e-1496-45a0-af8e-53ebf70669ba";
const verified = {
  role: "USER" as const, accessStatus: "ACTIVE" as const,
  emailVerifiedAt: new Date(), telegramVerifiedAt: new Date(),
  lockedAt: null, deletionRequestedAt: null, scheduledDeletionAt: null,
};
const failsWith = (code: string) => (error: unknown) => error instanceof AdminBootstrapError && error.code === code;

describe("first-admin command arguments", () => {
  it("supports help without confirmation or a target", () => {
    assert.deepEqual(parseBootstrapAdminArguments(["--help"]), { help: true });
    assert.deepEqual(parseBootstrapAdminArguments(["-h"]), { help: true });
  });
  it("requires an explicit target UUID and confirmation", () => {
    assert.throws(() => parseBootstrapAdminArguments([]), failsWith("INVALID_USER_ID"));
    assert.throws(() => parseBootstrapAdminArguments(["--confirm"]), failsWith("INVALID_USER_ID"));
    assert.throws(() => parseBootstrapAdminArguments(["--user-id", userId]), failsWith("CONFIRMATION_REQUIRED"));
  });
  it("normalizes UUID case and accepts either flag order", () => {
    assert.deepEqual(parseBootstrapAdminArguments(["--user-id", userId.toUpperCase(), "--confirm"]), { help: false, userId });
    assert.deepEqual(parseBootstrapAdminArguments(["--confirm", "--user-id", userId]), { help: false, userId });
  });
  it("rejects missing, malformed or email-address targets", () => {
    for (const value of [undefined, "", "not-a-uuid", "operator@u.nus.edu", "--confirm", " " + userId]) {
      const args = value === undefined ? ["--user-id"] : ["--user-id", value, "--confirm"];
      assert.throws(() => parseBootstrapAdminArguments(args), failsWith("INVALID_USER_ID"));
    }
  });
  it("rejects unknown, duplicate and mixed-help arguments", () => {
    for (const extra of [["--force"], ["--confirm"], ["--user-id", userId], ["--help"], ["--reason", "setup"]]) {
      assert.throws(() => parseBootstrapAdminArguments(["--user-id", userId, "--confirm", ...extra]), failsWith("INVALID_ARGUMENTS"));
    }
  });
});

describe("first-admin candidate eligibility", () => {
  it("accepts an active, unlocked, fully verified ordinary user", () => {
    assert.doesNotThrow(() => validateBootstrapCandidate(verified));
  });
  it("requires both email and Telegram verification", () => {
    for (const changes of [{ emailVerifiedAt: null }, { telegramVerifiedAt: null }, { emailVerifiedAt: null, telegramVerifiedAt: null }]) {
      assert.throws(() => validateBootstrapCandidate({ ...verified, ...changes }), failsWith("USER_NOT_VERIFIED"));
    }
  });
  it("rejects admins, suspended, locked and deletion-pending accounts", () => {
    for (const changes of [
      { role: "ADMIN" as const }, { accessStatus: "SUSPENDED" as const }, { lockedAt: new Date() },
      { deletionRequestedAt: new Date() }, { scheduledDeletionAt: new Date() },
    ]) {
      assert.throws(() => validateBootstrapCandidate({ ...verified, ...changes }), failsWith("USER_NOT_ELIGIBLE"));
    }
  });
});
