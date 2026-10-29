import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "./app";
import { prisma } from "./db";

let server: Server;
let baseUrl: string;

before(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await prisma.$disconnect();
});

describe("HTTP foundation", () => {
  it("reports service health", async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { service: "user-service", status: "ok" });
  });

  it("serves the OpenAPI document", async () => {
    const response = await fetch(`${baseUrl}/api-docs.json`);
    assert.equal(response.status, 200);

    const document = await response.json() as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { securitySchemes: Record<string, unknown> };
    };
    assert.equal(document.openapi, "3.0.3");
    assert.ok(document.paths["/api/v1/user/signup"]);
    assert.ok(document.paths["/api/v1/user/forgot-password"]);
    assert.ok(document.paths["/api/v1/user/reset-password"]);
    assert.ok(document.paths["/api/v1/user/verify-telegram"]);
    assert.ok(document.paths["/api/v1/user/request-telegram-verification"]);
    assert.ok(document.paths["/api/v1/user/internal/users/{userId}/telegram"]);
    assert.ok(document.paths["/api/v1/user/admin/users/{userId}/verify"]);
    assert.ok(document.paths["/api/v1/user/internal/authorize"]);
    assert.ok(document.paths["/api/v1/user/search"]);
    assert.ok(document.paths["/api/v1/user/{userId}/role"]);
    assert.ok(document.paths["/api/v1/user/{userId}/status"]);
    const appeals = document.paths["/api/v1/user/appeals"] as { post: { security: unknown } };
    const reports = document.paths["/api/v1/user/reports"] as { post: { security: unknown } };
    assert.deepEqual(appeals.post.security, []);
    assert.deepEqual(reports.post.security, [{ bearerAuth: [] }]);
    for (const path of ["friends", "friends/request", "friends/requests", "friends/{requestId}/accept", "friends/{requestId}/reject", "friends/{friendUserId}"]) {
      const operations = document.paths[`/api/v1/user/${path}`] as Record<string, { security: unknown }>;
      assert.ok(operations);
      assert.deepEqual(Object.values(operations)[0].security, [{ bearerAuth: [] }]);
    }
    assert.equal(document.paths["/api/v1/user/authorize"], undefined);
    assert.deepEqual(Object.keys(document.components.securitySchemes), ["bearerAuth"]);
    const lookup = document.paths["/api/v1/user/internal/users/{userId}/telegram"] as { get: { security: unknown } };
    assert.deepEqual(lookup.get.security, []);
    for (const endpoint of ["search", "{userId}/role", "{userId}/status", "admin/users/{userId}/verify"]) {
      const operation = document.paths[`/api/v1/user/${endpoint}`] as Record<string, { security: unknown }>;
      assert.deepEqual(Object.values(operation)[0].security, [{ bearerAuth: [] }]);
    }
  });

  it("answers authorize checks for any method, as the API gateway sends them", async () => {
    for (const endpoint of ["internal/authorize", "authorize"]) {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
        const response = await fetch(`${baseUrl}/api/v1/user/${endpoint}`, { method });
        assert.equal(response.status, 401, `${method} /${endpoint} without a token`);
      }
    }
  });

  it("does not accept identity or arbitrary service headers as authorize credentials", async () => {
    for (const endpoint of ["internal/authorize", "authorize"]) {
      const response = await fetch(`${baseUrl}/api/v1/user/${endpoint}`, {
        headers: {
          "x-user-id": "5999fc1e-1496-45a0-af8e-53ebf70669ba", "x-is-admin": "true",
          "x-permitted-action": "true", "x-service-token": "not-a-user-session",
        },
      });
      assert.equal(response.status, 401);
    }
  });

  it("uses the standard error shape for unknown endpoints", async () => {
    const response = await fetch(`${baseUrl}/missing`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: "Endpoint not found",
      code: "NOT_FOUND",
    });
  });
});

describe("request validation before database access", () => {
  it("rejects malformed and oversized credential JSON without logging its contents", async () => {
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...values: unknown[]) => { logged.push(values); };
    try {
      const invalid = await fetch(`${baseUrl}/api/v1/user/appeals`, { method: "POST", headers: { "content-type": "application/json" },
        body: '{"password":"NeverLogThisPassword",' });
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json() as { code: string }).code, "INVALID_JSON");
      const oversized = await fetch(`${baseUrl}/api/v1/user/appeals`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "NeverLogThisPassword", message: "x".repeat(33000) }) });
      assert.equal(oversized.status, 413);
      assert.equal((await oversized.json() as { code: string }).code, "REQUEST_TOO_LARGE");
      assert.equal(logged.length, 0);
    } finally { console.error = original; }
  });
  it("requires a real session for reports but not for appeal validation", async () => {
    const report = await fetch(`${baseUrl}/api/v1/user/reports`, { method: "POST", headers: { "x-is-admin": "true", "x-user-id": "spoofed" } });
    assert.equal(report.status, 401);
    const appeal = await fetch(`${baseUrl}/api/v1/user/appeals`, { method: "POST" });
    assert.equal(appeal.status, 401);
    assert.equal((await appeal.json() as { code: string }).code, "INVALID_CREDENTIALS");
    assert.equal(appeal.headers.get("cache-control"), "no-store");
  });
  it("requires bearer authentication for every friendship operation, ignoring spoofed identity", async () => {
    for (const [endpoint, method] of [["friends", "GET"], ["friends/requests", "GET"], ["friends/request", "POST"],
      ["friends/not-a-uuid/accept", "POST"], ["friends/not-a-uuid/reject", "POST"], ["friends/not-a-uuid", "DELETE"]]) {
      const response = await fetch(`${baseUrl}/api/v1/user/${endpoint}`, { method, headers: {
        "x-user-id": "5999fc1e-1496-45a0-af8e-53ebf70669ba", "x-is-admin": "true", "x-permitted-action": "true",
      } });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  });
  it("hides admin search and mutations from missing credentials and spoofed headers", async () => {
    for (const [endpoint, method] of [["search", "GET"], ["not-a-uuid/role", "POST"], ["not-a-uuid/status", "POST"]]) {
      const response = await fetch(`${baseUrl}/api/v1/user/${endpoint}`, { method,
        headers: { "x-user-id": "5999fc1e-1496-45a0-af8e-53ebf70669ba", "x-is-admin": "true", "x-permitted-action": "true" } });
      assert.equal(response.status, 404);
    }
  });
  it("requires authentication for Telegram verification and profile password changes", async () => {
    for (const [endpoint, method] of [
      ["request-telegram-verification", "POST"], ["verify-telegram", "POST"], ["me/password", "PATCH"], ["me", "DELETE"],
    ]) {
      const response = await fetch(`${baseUrl}/api/v1/user/${endpoint}`, { method });
      assert.equal(response.status, 401);
    }
  });

  it("does not accept spoofed identity headers for admin test verification", async () => {
    const response = await fetch(`${baseUrl}/api/v1/user/admin/users/5999fc1e-1496-45a0-af8e-53ebf70669ba/verify`, {
      method: "POST",
      headers: { "x-is-admin": "true", "x-user-id": "5999fc1e-1496-45a0-af8e-53ebf70669ba", "x-permitted-action": "true" },
    });
    assert.equal(response.status, 404);
  });
  it("validates internal lookup UUIDs without requiring an application token", async () => {
    const response = await fetch(`${baseUrl}/api/v1/user/internal/users/not-a-uuid/telegram`);
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, "INVALID_USER_ID");
  });
  it("requires an email to request a password reset", async () => {
    const response = await fetch(`${baseUrl}/api/v1/user/forgot-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, "MISSING_EMAIL");
  });

  it("rejects malformed and weak password reset requests", async () => {
    for (const [body, code] of [
      [{ newPassword: "SecurePass1" }, "MISSING_FIELDS"],
      [{ token: "invalid", newPassword: "short" }, "INVALID_PASSWORD"],
      [{ token: "invalid", newPassword: "SecurePass1" }, "INVALID_RESET_TOKEN"],
    ] as const) {
      const response = await fetch(`${baseUrl}/api/v1/user/reset-password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json() as { code: string }).code, code);
    }
  });

  it("rejects signup when required fields are absent", async () => {
    const response = await fetch(`${baseUrl}/api/v1/user/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "student@u.nus.edu" }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, "MISSING_FIELDS");
  });

  it("requires a real name instead of deriving one from the NUS email", async () => {
    const response = await fetch(`${baseUrl}/api/v1/user/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "e1234567@u.nus.edu",
        password: "SecurePass1",
        telegramHandle: "student_handle",
      }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, "MISSING_FIELDS");
  });

  it("rejects names shorter than two characters", async () => {
    const response = await fetch(`${baseUrl}/api/v1/user/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "A",
        email: "e1234567@u.nus.edu",
        password: "SecurePass1",
        telegramHandle: "student_handle",
      }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, "INVALID_NAME");
  });

  it("rejects names longer than 100 characters", async () => {
    const response = await fetch(`${baseUrl}/api/v1/user/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "A".repeat(101),
        email: "e1234567@u.nus.edu",
        password: "SecurePass1",
        telegramHandle: "student_handle",
      }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, "INVALID_NAME");
  });

  it("accepts a 100-character name at the validation boundary", async () => {
    const response = await fetch(`${baseUrl}/api/v1/user/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "A".repeat(100),
        email: "student@gmail.com",
        password: "SecurePass1",
        telegramHandle: "student_handle",
      }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, "INVALID_EMAIL_DOMAIN");
  });

  it("rejects non-NUS domains", async () => {
    const response = await fetch(`${baseUrl}/api/v1/user/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Student User",
        email: "student@gmail.com",
        password: "SecurePass1",
        telegramHandle: "student_handle",
      }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, "INVALID_EMAIL_DOMAIN");
  });

  it("returns the same generic login failure for missing credentials", async () => {
    const response = await fetch(`${baseUrl}/api/v1/user/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "student@u.nus.edu" }),
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: "Wrong password or user not found",
      code: "INVALID_CREDENTIALS",
    });
  });
});
