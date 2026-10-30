import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deletionDeadline, deletionIsDue } from "./account-lifecycle";
import { isUuid, testVerificationAllowed } from "./integration-access";

describe("account deletion dates", () => {
  it("adds six calendar months, clamps month ends and preserves UTC time", () => {
    assert.equal(deletionDeadline(new Date("2026-01-31T12:34:56.789Z")).toISOString(), "2026-07-31T12:34:56.789Z");
    assert.equal(deletionDeadline(new Date("2026-08-31T12:34:56.789Z")).toISOString(), "2027-02-28T12:34:56.789Z");
    assert.equal(deletionDeadline(new Date("2023-08-31T12:34:56.789Z")).toISOString(), "2024-02-29T12:34:56.789Z");
  });
  it("treats the deadline itself as expired", () => {
    const now = new Date("2026-10-18T00:00:00Z");
    assert.equal(deletionIsDue({ scheduledDeletionAt: null }, now), false);
    assert.equal(deletionIsDue({ scheduledDeletionAt: now }, now), true);
    assert.equal(deletionIsDue({ scheduledDeletionAt: new Date(now.getTime() + 1) }, now), false);
  });
});

describe("integration access boundaries", () => {
  it("requires an explicit flag and a known non-production environment", () => {
    for (const environment of ["production", "prod", "unknown", ""]) {
      assert.equal(testVerificationAllowed("true", environment), false);
    }
    assert.equal(testVerificationAllowed(undefined, "local"), false);
    assert.equal(testVerificationAllowed("false", "stg"), false);
    for (const environment of ["local", "development", "dev", "test", "staging", "stg"]) {
      assert.equal(testVerificationAllowed("true", environment), true);
    }
  });
  it("rejects malformed UUIDs before a database lookup", () => {
    assert.equal(isUuid("5999fc1e-1496-45a0-af8e-53ebf70669ba"), true);
    assert.equal(isUuid("not-a-uuid"), false);
    assert.equal(isUuid(["5999fc1e-1496-45a0-af8e-53ebf70669ba"]), false);
  });
});
