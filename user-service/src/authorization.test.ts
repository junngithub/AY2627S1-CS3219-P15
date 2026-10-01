import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorizationResult, identityHeaders } from "./authorization";

const baseUser = {
  id: "7f3c2a1e-0b4d-4c8a-9e21-5d6f7a8b9c0d",
  role: "USER" as const,
  accessStatus: "ACTIVE" as const,
  emailVerifiedAt: null,
  telegramVerifiedAt: null,
};

describe("authorization result", () => {
  it("does not permit actions until email and Telegram are verified", () => {
    assert.deepEqual(authorizationResult(baseUser), {
      authenticated: true,
      userId: baseUser.id,
      isAdmin: false,
      permittedAction: false,
    });
  });

  it("permits actions for a verified, active user and flags admins", () => {
    const result = authorizationResult({
      ...baseUser,
      role: "ADMIN",
      emailVerifiedAt: new Date(),
      telegramVerifiedAt: new Date(),
    });
    assert.equal(result.isAdmin, true);
    assert.equal(result.permittedAction, true);
  });
});

describe("identity headers for the API gateway", () => {
  it("carries the same identity as the JSON body", () => {
    const result = authorizationResult({
      ...baseUser,
      emailVerifiedAt: new Date(),
      telegramVerifiedAt: new Date(),
    });
    assert.deepEqual(identityHeaders(result), {
      "x-user-id": baseUser.id,
      "x-is-admin": "false",
      "x-permitted-action": "true",
    });
  });
});
