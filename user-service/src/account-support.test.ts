import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { HttpAdminIntake, validateAdminBaseUrl, type ReportInput } from "./admin-intake";
import { AppealAttemptLimiter, supportText } from "./account-support";
import { AppError } from "./errors";

const input: ReportInput = { reporterUserId: randomUUID(), reportedUserId: randomUUID(), comment: "A report" };
const stored = { id: randomUUID(), reporter_user_id: input.reporterUserId, reported_user_id: input.reportedUserId,
  comment: "Original stored report", status: "open", created_at: "2026-10-30T12:00:00Z", closed_at: null, closed_by_admin_id: null };

describe("account support validation and throttling", () => {
  it("trims and bounds report/appeal text", () => {
    assert.equal(supportText("  issue  ", "comment"), "issue");
    assert.equal(supportText("x".repeat(4000), "message").length, 4000);
    for (const value of ["", "  ", undefined, 3, ["issue"], "x".repeat(4001)]) {
      assert.throws(() => supportText(value, "message"), (e: unknown) => e instanceof AppError && e.status === 400);
    }
  });
  it("limits attempts per key, expires entries and fails closed when capacity is full", () => {
    let time = 100;
    const limiter = new AppealAttemptLimiter(() => time, 2, 10, 1);
    limiter.check("a"); limiter.check("a");
    assert.throws(() => limiter.check("a"), (e: unknown) => e instanceof AppError && e.status === 429);
    assert.throws(() => limiter.check("b"));
    time = 110;
    limiter.check("b"); limiter.check("b");
    assert.throws(() => limiter.check("b"));
  });
  it("allows only configured HTTP(S) origins and never includes bad configuration in errors", () => {
    assert.equal(validateAdminBaseUrl(""), "");
    assert.equal(validateAdminBaseUrl("http://admin:8084/"), "http://admin:8084");
    for (const value of ["invalid", "file:///tmp/foo", "http://user:private@admin", "http://admin/a", "http://admin/?secret=value", "http://admin/#value"]) {
      assert.throws(() => validateAdminBaseUrl(value), (e: unknown) => e instanceof Error && !e.message.includes("private"));
    }
  });
});

describe("private Admin intake HTTP client", () => {
  it("sends only the specified report payload and returns validated stored text without unknown fields", async () => {
    let calls = 0;
    const client = new HttpAdminIntake("http://admin:8084", 5000, async (url, options) => {
      calls++;
      assert.equal(String(url), "http://admin:8084/api/v1/admin/reports");
      assert.equal(options?.method, "POST"); assert.equal(options?.redirect, "error");
      assert.deepEqual(JSON.parse(options?.body as string), input);
      assert.equal(new Headers(options?.headers).get("authorization"), null);
      return new Response(JSON.stringify({ ...stored, passwordHash: "must-not-return" }), { status: 201 });
    });
    assert.deepEqual(await client.report(input), stored);
    assert.equal(calls, 1);
  });
  it("passes the stored appeal record back without forwarding credentials", async () => {
    const appeal = { id: randomUUID(), user_id: input.reporterUserId, message: "Stored appeal", status: "open",
      created_at: stored.created_at, closed_at: null, closed_by_admin_id: null };
    const client = new HttpAdminIntake("http://admin:8084", 5000, async (url, options) => {
      assert.equal(String(url), "http://admin:8084/api/v1/admin/appeals");
      assert.deepEqual(JSON.parse(options?.body as string), { userId: input.reporterUserId, message: "New appeal" });
      return new Response(JSON.stringify(appeal), { status: 201 });
    });
    assert.deepEqual(await client.appeal({ userId: input.reporterUserId, message: "New appeal" }), appeal);
  });
  it("fails closed without configuration and maps upstream errors without returning raw details or retrying", async () => {
    await assert.rejects(() => new HttpAdminIntake("").report(input), (e: unknown) => e instanceof AppError && e.code === "ADMIN_NOT_CONFIGURED");
    for (const [status, expected] of [[409, 409], [422, 502], [401, 502], [500, 503], [429, 503]]) {
      let calls = 0;
      const client = new HttpAdminIntake("http://admin:8084", 5000, async () => {
        calls++; return new Response("private upstream details", { status });
      });
      await assert.rejects(() => client.report(input), (e: unknown) => e instanceof AppError && e.status === expected && !e.message.includes("private"));
      assert.equal(calls, 1);
    }
    const failing = new HttpAdminIntake("http://admin:8084", 5000, async () => { throw new Error("sensitive network info"); });
    await assert.rejects(() => failing.report(input), (e: unknown) => e instanceof AppError && e.code === "ADMIN_UNAVAILABLE");
  });
  it("rejects malformed, oversized and wrong-identity responses", async () => {
    for (const body of ["bad json", "x".repeat(33000), JSON.stringify([]), JSON.stringify({ ...stored, status: ["open"] }),
      JSON.stringify({ ...stored, reporter_user_id: randomUUID() }), JSON.stringify({ ...stored, created_at: "bad" }),
      JSON.stringify({ ...stored, closed_at: undefined })]) {
      const client = new HttpAdminIntake("http://admin:8084", 5000, async () => new Response(body, { status: 201 }));
      await assert.rejects(() => client.report(input), (e: unknown) => e instanceof AppError && e.code === "ADMIN_INVALID_RESPONSE");
    }
  });
});
