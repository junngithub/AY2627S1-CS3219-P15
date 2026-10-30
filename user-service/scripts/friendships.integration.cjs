const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomBytes, randomUUID } = require("node:crypto");
const path = require("node:path");
const { test } = require("node:test");
const { PrismaClient } = require("@prisma/client");

test("friendship HTTP lifecycle, privacy, concurrency and constraints in disposable PostgreSQL", { timeout: 120000 }, async () => {
  const databaseName = "user_friendships_it_" + randomBytes(6).toString("hex");
  const pattern = /^user_friendships_it_[0-9a-f]{12}$/;
  assert.match(databaseName, pattern);
  // Deliberately fixed to local development. Never read DATABASE_URL or .env to
  // choose a server, never migrate user_db, and never start email/bot workers.
  const prefix = "postgresql://user_service:user_service_dev@127.0.0.1:5554/";
  const databaseAdmin = new PrismaClient({ datasources: { db: { url: prefix + "user_db" } } });
  let createdDatabase = false;
  let prisma;
  let server;
  try {
    await databaseAdmin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    createdDatabase = true;
    Object.assign(process.env, { DATABASE_URL: prefix + databaseName, NODE_ENV: "development", APP_ENV: "test",
      EMAIL_PROVIDER: "disabled", TELEGRAM_BOT_TOKEN: "", TELEGRAM_BOT_USERNAME: "", KAFKA_BROKERS: "",
      ENABLE_TEST_VERIFICATION: "false", PASSWORD_SCRYPT_COST: "1024" });
    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
      cwd: path.resolve(__dirname, ".."), env: process.env, stdio: "pipe",
    });
    ({ prisma } = require("../dist/db"));
    const { createApp } = require("../dist/app");
    const { hashPassword, hashSessionToken } = require("../dist/security");
    const { sendFriendRequest } = require("../dist/friendships");
    const password = "FriendFixturePass1";
    const passwordHash = await hashPassword(password, 1024);
    await new Promise((resolve) => { server = createApp().listen(0, "127.0.0.1", resolve); });
    const base = `http://127.0.0.1:${server.address().port}/api/v1/user`;
    async function request(endpoint, method = "GET", body, token, headers = {}) {
      const response = await fetch(base + endpoint, { method, headers: { "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null, cache: response.headers.get("cache-control") };
    }
    async function user(data = {}) {
      const suffix = randomBytes(6).toString("hex");
      const record = await prisma.user.create({ data: { email: `friend_${suffix}@u.nus.edu`, name: "Friend Fixture " + suffix,
        telegramHandle: "friend_" + suffix, passwordHash, emailVerifiedAt: new Date(), telegramVerifiedAt: new Date(), ...data } });
      const token = randomBytes(32).toString("base64url");
      await prisma.authSession.create({ data: { userId: record.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600000) } });
      return { ...record, token };
    }
    const send = (from, to) => request("/friends/request", "POST", { targetUserId: to.id }, from.token);
    const respond = (by, requestId, action = "accept") => request(`/friends/${requestId}/${action}`, "POST", undefined, by.token);
    const friends = (of, query = "") => request("/friends" + query, "GET", undefined, of.token);
    const remove = (by, of) => request("/friends/" + of.id, "DELETE", undefined, by.token);
    const a = await user(); const b = await user(); const c = await user(); const d = await user();
    const suspended = await user({ accessStatus: "SUSPENDED" });
    const deleting = await user({ deletionRequestedAt: new Date(), scheduledDeletionAt: new Date(Date.now() + 60000) });
    const expired = await user({ scheduledDeletionAt: new Date(Date.now() - 1000) });
    const created = await user({ emailVerifiedAt: null, telegramVerifiedAt: null });
    const spoof = { "x-user-id": a.id, "x-is-admin": "true", "x-permitted-action": "true" };
    const endpoints = [["/friends", "GET"], ["/friends/requests", "GET"], ["/friends/request", "POST", { targetUserId: b.id }],
      [`/friends/${randomUUID()}/accept`, "POST"], [`/friends/${randomUUID()}/reject`, "POST"], [`/friends/${b.id}`, "DELETE"]];
    for (const [endpoint, method, body] of endpoints) {
      for (const token of [undefined, "bad-token", suspended.token, deleting.token, expired.token]) {
        const response = await request(endpoint, method, body, token, spoof);
        assert.equal(response.status, 401);
        assert.equal(response.cache, "no-store");
      }
    }
    const revoked = await user();
    await prisma.authSession.updateMany({ where: { userId: revoked.id }, data: { revokedAt: new Date() } });
    assert.equal((await friends(revoked)).status, 401);
    const sessionExpired = await user();
    await prisma.authSession.updateMany({ where: { userId: sessionExpired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await friends(sessionExpired)).status, 401);
    for (const target of [undefined, "bad", {}, [b.id]]) {
      assert.equal((await request("/friends/request", "POST", { targetUserId: target }, a.token)).status, 400);
    }
    assert.equal((await send(a, a)).status, 400);
    for (const target of [{ id: randomUUID() }, suspended, deleting, expired]) assert.equal((await send(a, target)).status, 404);
    for (const endpoint of ["/friends?page=0", "/friends?pageSize=101", "/friends?page=1&page=2", "/friends/requests?direction=all"]) {
      assert.equal((await request(endpoint, "GET", undefined, a.token)).status, 400);
    }
    assert.equal((await respond(b, "bad")).status, 400);
    assert.equal((await remove(a, { id: "bad" })).status, 400);
    console.log("PASS: real session checks, suspended/deleting/expired/revoked denial, spoofing and input bounds");

    const pending = await send(a, b);
    assert.equal(pending.status, 201);
    assert.equal(pending.cache, "no-store");
    assert.deepEqual(Object.keys(pending.body).sort(), ["createdAt", "recipientId", "requestId", "senderId", "status"]);
    const ab = pending.body.requestId;
    assert.equal((await send(a, b)).status, 409);
    assert.equal((await send(b, a)).status, 409);
    const incoming = await request("/friends/requests", "GET", undefined, b.token);
    assert.deepEqual(incoming.body.items, [{ requestId: ab, status: "pending", createdAt: pending.body.createdAt,
      sender: { id: a.id, name: a.name }, recipient: { id: b.id, name: b.name } }]);
    assert.equal(incoming.body.total, 1);
    assert.equal((await request("/friends/requests?direction=outgoing", "GET", undefined, a.token)).body.items[0].requestId, ab);
    assert.equal((await request("/friends/requests", "GET", undefined, c.token)).body.total, 0);
    assert.equal((await respond(c, ab)).status, 404);
    assert.equal((await respond(a, ab)).status, 404);
    assert.equal((await respond(c, ab, "reject")).status, 404);
    assert.equal((await friends(a)).body.total, 0);
    assert.deepEqual((await respond(b, ab)).body, { requestId: ab, status: "accepted", changed: true });
    assert.deepEqual((await respond(b, ab)).body, { requestId: ab, status: "accepted", changed: false });
    assert.equal((await respond(b, ab, "reject")).status, 409);
    assert.deepEqual((await friends(a)).body.items, [{ id: b.id, name: b.name }]);
    assert.deepEqual((await friends(b)).body.items, [{ id: a.id, name: a.name }]);
    assert.equal((await request("/friends/requests", "GET", undefined, b.token)).body.total, 0);
    await remove(c, a);
    assert.equal((await friends(a)).body.total, 1);
    assert.equal((await remove(b, a)).status, 204);
    assert.equal((await remove(b, a)).status, 204);
    assert.equal((await friends(a)).body.total, 0);
    assert.equal((await friends(b)).body.total, 0);
    assert.equal((await prisma.friendship.findUniqueOrThrow({ where: { id: ab } })).status, "REMOVED");
    assert.equal((await respond(b, ab)).status, 409);
    const renewed = await send(a, b);
    assert.equal(renewed.status, 201); assert.notEqual(renewed.body.requestId, ab);
    console.log("PASS: request discovery, recipient-only actions, minimal public fields, bidirectionality and idempotent removal");

    const cd = (await send(c, d)).body.requestId;
    assert.equal((await respond(d, cd, "reject")).status, 200);
    assert.equal((await respond(d, cd, "reject")).body.changed, false);
    const nextCd = await send(c, d);
    assert.equal(nextCd.status, 201); assert.notEqual(nextCd.body.requestId, cd);
    assert.equal((await respond(d, cd)).status, 409);
    assert.equal((await prisma.friendship.findUniqueOrThrow({ where: { id: nextCd.body.requestId } })).status, "PENDING");
    assert.equal((await send(created, d)).status, 201);
    console.log("PASS: rejection/resend uses fresh request IDs; contract auth-only policy permits active Created accounts");

    const x = await user(); const y = await user();
    const crossed = await Promise.all(Array.from({ length: 12 }, (_, i) => i % 2 ? send(x, y) : send(y, x)));
    assert.equal(crossed.filter((r) => r.status === 201).length, 1);
    assert.equal(crossed.filter((r) => r.status === 409).length, 11);
    const xy = crossed.find((r) => r.status === 201).body;
    const recipient = xy.recipientId === x.id ? x : y;
    const competing = await Promise.all([respond(recipient, xy.requestId), respond(recipient, xy.requestId, "reject")]);
    assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
    const constraintA = await user(); const constraintB = await user();
    await assert.rejects(() => prisma.friendship.create({ data: { senderId: constraintA.id, recipientId: constraintA.id } }));
    await prisma.friendship.create({ data: { senderId: constraintA.id, recipientId: constraintB.id } });
    await assert.rejects(() => prisma.friendship.create({ data: { senderId: constraintB.id, recipientId: constraintA.id, status: "ACCEPTED" } }));
    console.log("PASS: crossed requests and accept/reject races serialize; PostgreSQL independently enforces self/active-pair constraints");

    await prisma.user.update({ where: { id: a.id }, data: { accessStatus: "SUSPENDED" } });
    assert.equal((await request("/friends/requests", "GET", undefined, b.token)).body.total, 0);
    assert.equal((await respond(b, renewed.body.requestId)).status, 409);
    assert.equal((await respond(b, renewed.body.requestId, "reject")).status, 200);
    await prisma.user.update({ where: { id: a.id }, data: { accessStatus: "ACTIVE" } });
    const unavailableId = (await send(a, b)).body.requestId;
    assert.equal((await respond(b, unavailableId)).status, 200);
    await prisma.user.update({ where: { id: a.id }, data: { accessStatus: "SUSPENDED" } });
    assert.equal((await friends(b)).body.total, 0);
    assert.equal((await remove(b, a)).status, 204);
    assert.equal((await prisma.friendship.findUniqueOrThrow({ where: { id: unavailableId } })).status, "REMOVED");
    const stale = await user(); const staleTarget = await user();
    await prisma.authSession.updateMany({ where: { userId: stale.id }, data: { revokedAt: new Date() } });
    await assert.rejects(() => sendFriendRequest({ userId: stale.id, tokenHash: hashSessionToken(stale.token) }, staleTarget.id),
      (error) => error.status === 401);
    assert.equal(await prisma.friendship.count({ where: { senderId: stale.id } }), 0);
    console.log("PASS: unavailable peers are hidden but reject/removal remain possible; mutations recheck revoked sessions transactionally");

    const pageOwner = await user(); const pagePeers = await Promise.all([user(), user(), user()]);
    for (const peer of pagePeers) {
      const invitation = await send(pageOwner, peer);
      assert.equal((await respond(peer, invitation.body.requestId)).status, 200);
    }
    const first = (await friends(pageOwner, "?page=1&pageSize=2")).body;
    const second = (await friends(pageOwner, "?page=2&pageSize=2")).body;
    assert.equal(first.items.length, 2); assert.equal(second.items.length, 1); assert.equal(first.total, 3);
    assert.equal(new Set([...first.items, ...second.items].map((u) => u.id)).size, 3);
    for (const item of [...first.items, ...second.items]) assert.deepEqual(Object.keys(item).sort(), ["id", "name"]);
    const toDelete = await user();
    const outgoingDeleted = await send(toDelete, pageOwner);
    const incomingDeleted = await send(b, toDelete);
    assert.equal(outgoingDeleted.status, 201); assert.equal(incomingDeleted.status, 201);
    await prisma.user.delete({ where: { id: toDelete.id } });
    assert.equal(await prisma.friendship.count({ where: { OR: [{ senderId: toDelete.id }, { recipientId: toDelete.id }] } }), 0);
    assert.equal((await friends(toDelete)).status, 401);
    console.log("PASS: stable bounded pagination, no sensitive fields, and cascades for either account role");
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma?.$disconnect();
    if (createdDatabase) {
      assert.match(databaseName, pattern);
      await databaseAdmin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
      console.log("Removed only the disposable friendship-test database; no real messages or normal accounts changed");
    }
    await databaseAdmin.$disconnect();
  }
});
