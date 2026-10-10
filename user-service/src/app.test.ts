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
    };
    assert.equal(document.openapi, "3.0.3");
    assert.ok(document.paths["/api/v1/user/signup"]);
    assert.ok(document.paths["/api/v1/user/authorize"]);
  });

  it("answers authorize checks for any method, as the API gateway sends them", async () => {
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      const response = await fetch(`${baseUrl}/api/v1/user/authorize`, { method });
      assert.equal(response.status, 401, `${method} /authorize without a token`);
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
