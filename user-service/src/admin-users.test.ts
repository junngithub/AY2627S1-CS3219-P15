import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { eligibleAdministrator, parseAdminChange, parseAdminSearch } from "./admin-users";

describe("admin user input and eligibility", () => {
  it("defaults to page one, trims q and bounds pagination/search", () => {
    assert.deepEqual(parseAdminSearch(undefined, undefined), { q: "", page: 1 });
    assert.deepEqual(parseAdminSearch(" Example ", "2"), { q: "Example", page: 2 });
    assert.deepEqual(parseAdminSearch("a".repeat(100), "100000"), { q: "a".repeat(100), page: 100000 });
    for (const page of ["0", "-1", "1.5", "01", "1e2", "100001", "99999999999999", ["1"], {}]) {
      assert.throws(() => parseAdminSearch("", page));
    }
    for (const q of ["a".repeat(101), ["a"], {}]) assert.throws(() => parseAdminSearch(q, "1"));
  });
  it("accepts only the agreed lowercase role/status commands", () => {
    for (const value of ["user", "admin"]) assert.deepEqual(parseAdminChange("role", { role: value }), { kind: "role", value });
    for (const value of ["verified", "suspended"]) assert.deepEqual(parseAdminChange("status", { status: value }), { kind: "status", value });
    for (const value of [undefined, null, "ADMIN", "root", true, ["admin"]]) assert.throws(() => parseAdminChange("role", { role: value }));
    for (const body of [undefined, null, "verified", { status: "Created" }, { status: "active" }]) assert.throws(() => parseAdminChange("status", body));
  });
  it("requires a fully verified, active, unlocked admin without pending deletion", () => {
    const eligible = { role: "ADMIN" as const, accessStatus: "ACTIVE" as const,
      emailVerifiedAt: new Date(), telegramVerifiedAt: new Date(), lockedAt: null,
      deletionRequestedAt: null, scheduledDeletionAt: null };
    assert.equal(eligibleAdministrator(eligible), true);
    for (const invalid of [{ role: "USER" as const }, { accessStatus: "SUSPENDED" as const },
      { emailVerifiedAt: null }, { telegramVerifiedAt: null }, { lockedAt: new Date() },
      { deletionRequestedAt: new Date() }, { scheduledDeletionAt: new Date() }]) {
      assert.equal(eligibleAdministrator({ ...eligible, ...invalid }), false);
    }
  });
});
