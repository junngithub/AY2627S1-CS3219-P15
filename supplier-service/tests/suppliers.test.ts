import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express from "express";
import { prisma } from "../src/db";
import suppliersRouter from "../src/routes/suppliers";

const USER_ID = "7f3c2a1e-0b4d-4c8a-9e21-5d6f7a8b9c0d";

const supplier = {
  id: 1,
  name: "Cool Spot",
  building: "COM2",
  floor: "1",
  locationDescription: "near the lift",
  latitude: 1.29,
  longitude: 103.77,
  startingTime: "09:00",
  closingTime: "18:00",
  status: "pending",
  categories: [{ id: 1, name: "Store" }],
};

const listing = {
  name: "Cool Spot",
  building: "COM2",
  floor: "1",
  locationDescription: "near the lift",
  latitude: 1.29,
  longitude: 103.77,
  startingTime: "09:00",
  closingTime: "18:00",
  categories: ["Store"],
};

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";

const adminRoutes: Array<{ method: string; path: string; body?: unknown }> = [
  { method: "GET", path: "/api/v1/supplier/admin" },
  { method: "GET", path: "/api/v1/supplier/admin/activity" },
  { method: "PATCH", path: "/api/v1/supplier/1", body: { name: "Renamed Spot" } },
  { method: "PATCH", path: "/api/v1/supplier/1/status", body: { status: "approved" } },
  { method: "DELETE", path: "/api/v1/supplier/1" },
];

function stub(target: object, key: string, impl: (...args: unknown[]) => unknown) {
  Object.defineProperty(target, key, {
    configurable: true,
    writable: true,
    value: async (...args: unknown[]) => impl(...args),
  });
}

describe("gateway identity on supplier routes", () => {
  const calls = { findMany: 0, findUnique: 0, create: 0, update: 0, delete: 0 };
  const actions: Array<Record<string, unknown>> = [];
  let server: Server;
  let baseUrl: string;

  before(async () => {
    process.env.DATABASE_URL ??= "postgresql://supplier:supplier@127.0.0.1:5432/supplier_test";

    stub(prisma.supplier, "findMany", async () => {
      calls.findMany += 1;
      return [supplier];
    });
    stub(prisma.supplier, "findUnique", async () => {
      calls.findUnique += 1;
      return supplier;
    });
    stub(prisma.supplier, "create", async (args: unknown) => {
      calls.create += 1;
      const data = (args as { data?: { createdByUserId?: string } }).data;
      return { ...supplier, status: "pending", createdByUserId: data?.createdByUserId ?? null };
    });
    stub(prisma.supplier, "update", async (args: unknown) => {
      calls.update += 1;
      const data = (args as { data?: Record<string, unknown> }).data ?? {};
      return { ...supplier, ...data, categories: supplier.categories };
    });
    stub(prisma.supplier, "delete", async () => {
      calls.delete += 1;
      return supplier;
    });
    stub(prisma.category, "upsert", async (args: unknown) => {
      const name = (args as { where?: { name?: string } }).where?.name ?? "Store";
      return { id: 1, name };
    });
    stub(prisma.supplierAction, "create", async (args: unknown) => {
      const data = (args as { data: Record<string, unknown> }).data;
      const row = { id: actions.length + 1, detail: null, createdAt: "2026-10-20T00:00:00.000Z", ...data };
      actions.push(row);
      return row;
    });
    stub(prisma.supplierAction, "findMany", async () => [...actions].reverse());
    stub(prisma, "$transaction", async (work: unknown) => {
      if (typeof work !== "function") throw new Error("expected a transaction callback");
      return (work as (tx: typeof prisma) => Promise<unknown>)(prisma);
    });

    const app = express();
    app.use(express.json());
    app.use("/api/v1/supplier", suppliersRouter);
    server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  async function send(method: string, path: string, headers: Record<string, string> = {}, body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text.length === 0 ? null : JSON.parse(text) };
  }

  it("requires an admin for edit, approval, delete, and the admin list", async () => {
    for (const route of adminRoutes) {
      const missing = await send(route.method, route.path, {}, route.body);
      assert.equal(missing.status, 401, `${route.method} ${route.path} without identity`);
      assert.deepEqual(missing.body, { error: "Sign in is required" });

      const member = await send(route.method, route.path, {
        "x-user-id": USER_ID,
        "x-is-admin": "false",
        "x-permitted-action": "true",
      }, route.body);
      assert.equal(member.status, 403, `${route.method} ${route.path} as a permitted user`);
      assert.deepEqual(member.body, { error: "Admin access is required" });

      const unverifiedAdmin = await send(route.method, route.path, {
        "x-user-id": USER_ID,
        "x-is-admin": "true",
        "x-permitted-action": "false",
      }, route.body);
      assert.equal(unverifiedAdmin.status, 403, `${route.method} ${route.path} as an unverified admin`);
      assert.deepEqual(unverifiedAdmin.body, { error: "This account is not permitted to manage suppliers" });

      const blankAdmin = await send(route.method, route.path, {
        "x-user-id": "   ",
        "x-is-admin": "true",
        "x-permitted-action": "true",
      }, route.body);
      assert.equal(blankAdmin.status, 401, `${route.method} ${route.path} with a blank user id`);
    }
  });

  it("accepts an admin header from the gateway, ignoring letter case and surrounding spaces", async () => {
    const beforeCounts = { ...calls };
    const actionStart = actions.length;
    for (const route of adminRoutes) {
      const response = await send(route.method, route.path, {
        "X-User-Id": ` ${USER_ID} `,
        "X-Is-Admin": " TRUE ",
        "X-Permitted-Action": " TRUE ",
      }, route.body);
      assert.equal(response.status, 200, `${route.method} ${route.path} as an admin`);
    }
    assert.ok(calls.findMany > beforeCounts.findMany);
    assert.ok(calls.update > beforeCounts.update);
    assert.ok(calls.delete > beforeCounts.delete);
    assert.deepEqual(
      actions.slice(actionStart).map((entry) => entry.action),
      ["edited", "approved", "deleted"],
    );
    assert.ok(actions.slice(actionStart).every((entry) => entry.actorUserId === USER_ID));
  });

  it("requires a permitted account to create a supplier, and does not treat admin as enough", async () => {
    const beforeCreates = calls.create;

    const missing = await send("POST", "/api/v1/supplier", {}, listing);
    assert.equal(missing.status, 401);

    const blocked = await send("POST", "/api/v1/supplier", {
      "x-user-id": USER_ID,
      "x-is-admin": "true",
      "x-permitted-action": "false",
    }, listing);
    assert.equal(blocked.status, 403);
    assert.deepEqual(blocked.body, { error: "This account is not permitted to manage suppliers" });
    assert.equal(calls.create, beforeCreates);

    const actionStart = actions.length;
    const created = await send("POST", "/api/v1/supplier", {
      "x-user-id": USER_ID,
      "x-is-admin": "false",
      "x-permitted-action": "true",
    }, listing);
    assert.equal(created.status, 201);
    assert.equal(created.body.status, "pending");
    assert.equal(created.body.createdByUserId, USER_ID);
    assert.equal(calls.create, beforeCreates + 1);
    assert.equal(actions[actionStart]?.action, "created");
    assert.equal(actions[actionStart]?.actorUserId, USER_ID);
  });

  it("lets an admin read who created a supplier and which admin changed it", async () => {
    const created = await send("POST", "/api/v1/supplier", {
      "x-user-id": USER_ID,
      "x-is-admin": "false",
      "x-permitted-action": "true",
    }, listing);
    assert.equal(created.body.createdByUserId, USER_ID);

    const rejected = await send("PATCH", "/api/v1/supplier/1/status", {
      "x-user-id": ADMIN_ID,
      "x-is-admin": "true",
      "x-permitted-action": "true",
    }, { status: "rejected" });
    assert.equal(rejected.status, 200);

    const denied = await send("GET", "/api/v1/supplier/admin/activity", {
      "x-user-id": USER_ID,
      "x-is-admin": "false",
      "x-permitted-action": "true",
    });
    assert.equal(denied.status, 403);

    const listed = await send("GET", "/api/v1/supplier/admin/activity?supplierId=1", {
      "x-user-id": ADMIN_ID,
      "x-is-admin": "true",
      "x-permitted-action": "true",
    });
    assert.equal(listed.status, 200);
    assert.ok(listed.body.some((entry: { action: string; actorUserId: string }) =>
      entry.action === "created" && entry.actorUserId === USER_ID));
    assert.ok(listed.body.some((entry: { action: string; actorUserId: string }) =>
      entry.action === "rejected" && entry.actorUserId === ADMIN_ID));
  });

  it("leaves the public catalogue and the order-service lookup open", async () => {
    const list = await send("GET", "/api/v1/supplier");
    assert.equal(list.status, 200);
    assert.equal(list.body[0].id, 1);

    const one = await send("GET", "/api/v1/supplier/1");
    assert.equal(one.status, 200);
    assert.equal(one.body.name, "Cool Spot");

    const invalid = await send("GET", "/api/v1/supplier/nope");
    assert.equal(invalid.status, 400);
    assert.deepEqual(invalid.body, { error: "Invalid supplier id" });
  });
});
