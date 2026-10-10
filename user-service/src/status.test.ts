import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accountNextSteps, accountStatus } from "./status";

const baseUser = {
  accessStatus: "ACTIVE" as const,
  emailVerifiedAt: null,
  telegramVerifiedAt: null,
  scheduledDeletionAt: null,
};

describe("account status", () => {
  it("starts as Created and lists both verification steps", () => {
    assert.equal(accountStatus(baseUser), "Created");
    assert.deepEqual(accountNextSteps(baseUser), [
      "VERIFY_EMAIL",
      "VERIFY_TELEGRAM",
    ]);
  });

  it("becomes Verified only after email and Telegram verification", () => {
    const verifiedUser = {
      ...baseUser,
      emailVerifiedAt: new Date(),
      telegramVerifiedAt: new Date(),
    };
    assert.equal(accountStatus(verifiedUser), "Verified");
    assert.deepEqual(accountNextSteps(verifiedUser), []);
  });

  it("prioritizes a suspension over verification", () => {
    const suspendedUser = {
      ...baseUser,
      accessStatus: "SUSPENDED" as const,
      emailVerifiedAt: new Date(),
      telegramVerifiedAt: new Date(),
    };
    assert.equal(accountStatus(suspendedUser), "Suspended");
    assert.deepEqual(accountNextSteps(suspendedUser), ["CONTACT_ADMIN"]);
  });

  it("signals a pending deletion without changing verification status", () => {
    const deletingUser = {
      ...baseUser,
      emailVerifiedAt: new Date(),
      telegramVerifiedAt: new Date(),
      scheduledDeletionAt: new Date(),
    };
    assert.equal(accountStatus(deletingUser), "Verified");
    assert.deepEqual(accountNextSteps(deletingUser), ["CANCEL_PENDING_DELETION"]);
  });
});
