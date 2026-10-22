const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomBytes, randomUUID } = require("node:crypto");
const path = require("node:path");
const { test } = require("node:test");
const { PrismaClient } = require("@prisma/client");

test("real admin user endpoints and mesh-protected lookup contract in isolated PostgreSQL", async () => {
  const databaseName = "user_admin_routes_it_" + randomBytes(6).toString("hex");
  const pattern = /^user_admin_routes_it_[0-9a-f]{12}$/;
  assert.match(databaseName, pattern);
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
      PASSWORD_SCRYPT_COST: "1024" });
    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
      cwd: path.resolve(__dirname, ".."), env: process.env, stdio: "pipe",
    });
    ({ prisma } = require("../dist/db"));
    const { createApp } = require("../dist/app");
    const { changeUser } = require("../dist/admin-users");
    const { hashPassword, hashSessionToken } = require("../dist/security");
    const password = "AdminRoutesTest1";
    const passwordHash = await hashPassword(password, 1024);
    await new Promise((resolve) => { server = createApp().listen(0, "127.0.0.1", resolve); });
    const base = `http://127.0.0.1:${server.address().port}/api/v1/user`;
    async function request(endpoint, method = "GET", body, token, extra = {}) {
      const r = await fetch(base + endpoint, { method, headers: { "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
      return { status: r.status, body: await r.json(), cache: r.headers.get("cache-control") };
    }
    async function user(data = {}) {
      const suffix = randomBytes(6).toString("hex");
      return prisma.user.create({ data: { email: `admin_routes_${suffix}@u.nus.edu`, name: "Admin Routes Fixture",
        telegramHandle: `admin_${suffix}`, passwordHash, emailVerifiedAt: new Date(), telegramVerifiedAt: new Date(), ...data } });
    }
    async function login(u) {
      const r = await request("/login", "POST", { email: u.email, password });
      assert.equal(r.status, 200);
      return r.body.token;
    }
    const a = await user({ role: "ADMIN" });
    const b = await user({ role: "ADMIN" });
    let tokenA = await login(a);
    let tokenB = await login(b);
    const target = await user({ name: "Search Case Match" });
    const normalToken = await login(target);
    const unverified = await user({ emailVerifiedAt: null, telegramVerifiedAt: null });
    const missing = randomUUID();
    const spoof = { "x-user-id": a.id, "x-is-admin": "true", "x-permitted-action": "true" };
    for (const [endpoint, method, body] of [["/search", "GET"], [`/${target.id}/role`, "POST", { role: "admin" }],
      [`/${target.id}/status`, "POST", { status: "suspended" }]]) {
      for (const token of [undefined, normalToken, "invalid-session"]) assert.equal((await request(endpoint, method, body, token, spoof)).status, 404);
    }
    for (const endpoint of ["/search?page=0", "/search?page=1.5", "/search?page=100001", "/search?q=a&q=b", "/search?q=" + "a".repeat(101)]) {
      assert.equal((await request(endpoint, "GET", undefined, tokenA)).status, 400);
    }
    const search = await request("/search?q=search%20case", "GET", undefined, tokenA);
    assert.equal(search.status, 200);
    assert.equal(search.cache, "no-store");
    assert.deepEqual(search.body, { items: [{ id: target.id, name: target.name, email: target.email, role: "user", status: "Verified" }], page: 1, total: 1 });
    assert.equal((await request(`/search?q=${target.id}`, "GET", undefined, tokenA)).body.total, 1);
    for (let i = 0; i < 22; i++) await user({ name: "Pagination Fixture" });
    const page1 = (await request("/search?q=Pagination&page=1", "GET", undefined, tokenA)).body;
    const page2 = (await request("/search?q=Pagination&page=2", "GET", undefined, tokenA)).body;
    assert.equal(page1.items.length, 20); assert.equal(page2.items.length, 2); assert.equal(page2.total, 22);
    assert.equal(new Set([...page1.items, ...page2.items].map((x) => x.id)).size, 22);
    for (const x of page1.items) assert.deepEqual(Object.keys(x).sort(), ["email", "id", "name", "role", "status"]);
    console.log("PASS: real bearer admin authorization, spoofed-header denial, bounded search and stable safe pagination");

    assert.equal((await request("/bad-uuid/role", "POST", { role: "admin" }, tokenA)).status, 400);
    assert.equal((await request(`/${missing}/role`, "POST", { role: "admin" }, tokenA)).status, 404);
    assert.equal((await request(`/${target.id}/role`, "POST", { role: "ADMIN" }, tokenA)).status, 400);
    assert.equal((await request(`/${target.id}/status`, "POST", { status: "active" }, tokenA)).status, 400);
    assert.equal((await request(`/${unverified.id}/role`, "POST", { role: "admin", emailVerifiedAt: new Date() }, tokenA)).status, 409);
    assert.equal((await request(`/${unverified.id}/status`, "POST", { status: "suspended" }, tokenA)).status, 200);
    const restored = await request(`/${unverified.id}/status`, "POST", { status: "verified" }, tokenA);
    assert.equal(restored.body.status, "Created");
    const untouched = await prisma.user.findUniqueOrThrow({ where: { id: unverified.id } });
    assert.equal(untouched.emailVerifiedAt, null); assert.equal(untouched.telegramVerifiedAt, null);
    assert.equal(await prisma.userVerifiedOutbox.count(), 0);
    console.log("PASS: invalid mutations rejected; promotion requires verification; reinstatement never fabricates verification or credits");

    await prisma.passwordResetToken.create({ data: { userId: target.id, tokenHash: "fixture-reset", expiresAt: new Date(Date.now() + 60000) } });
    const promoted = await request(`/${target.id}/role`, "POST", { role: "admin" }, tokenA);
    assert.deepEqual(promoted.body, { userId: target.id, role: "admin", status: "Verified", changed: true });
    assert.equal((await request("/internal/authorize", "POST", undefined, normalToken)).status, 401);
    assert.ok((await prisma.passwordResetToken.findUnique({ where: { tokenHash: "fixture-reset" } })).revokedAt);
    const promotedToken = await login(target);
    assert.equal((await request("/internal/authorize", "POST", undefined, promotedToken)).body.isAdmin, true);
    assert.equal((await request(`/${target.id}/role`, "POST", { role: "admin" }, tokenA)).body.changed, false);
    assert.equal((await request("/internal/authorize", "POST", undefined, promotedToken)).status, 200);
    assert.equal(await prisma.userAuditLog.count({ where: { targetUserId: target.id, action: "ADMIN_ROLE_CHANGED" } }), 1);
    assert.equal((await request(`/${target.id}/role`, "POST", { role: "user" }, tokenA)).body.role, "user");
    assert.equal((await request("/internal/authorize", "POST", undefined, promotedToken)).status, 401);
    const newToken = await login(target);
    await prisma.emailVerificationOtp.create({ data: { userId: target.id, otpHash: "fixture-otp", expiresAt: new Date(Date.now() + 60000) } });
    await prisma.telegramVerificationChallenge.create({ data: { userId: target.id, linkHash: "fixture-link", expiresAt: new Date(Date.now() + 60000) } });
    assert.equal((await request(`/${target.id}/status`, "POST", { status: "suspended" }, tokenA)).body.status, "Suspended");
    assert.equal((await request("/internal/authorize", "POST", undefined, newToken)).status, 401);
    assert.equal((await request("/login", "POST", { email: target.email, password })).status, 401);
    assert.equal(await prisma.emailVerificationOtp.count({ where: { userId: target.id, revokedAt: null } }), 0);
    assert.equal(await prisma.telegramVerificationChallenge.count({ where: { userId: target.id, revokedAt: null } }), 0);
    assert.equal((await request(`/${target.id}/status`, "POST", { status: "suspended" }, tokenA)).body.changed, false);
    assert.equal((await request(`/${target.id}/status`, "POST", { status: "verified" }, tokenA)).body.status, "Verified");
    const returned = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    assert.equal(returned.emailVerifiedAt.getTime(), target.emailVerifiedAt.getTime());
    assert.equal(returned.telegramVerifiedAt.getTime(), target.telegramVerifiedAt.getTime());
    await login(target);
    assert.equal((await request("/internal/authorize", "POST", undefined, newToken)).status, 401);
    console.log("PASS: persistent role/status changes, atomic User audit, idempotent retries and immediate session/challenge revocation");

    const rollbackTarget = await user();
    const rollbackToken = await login(rollbackTarget);
    // NOT VALID leaves earlier fixture audits intact but rejects new matching rows.
    await prisma.$executeRawUnsafe(`ALTER TABLE "UserAuditLog" ADD CONSTRAINT reject_admin_fixture_audit CHECK ("action" <> 'ADMIN_ROLE_CHANGED') NOT VALID`);
    await assert.rejects(() => changeUser({ userId: a.id, tokenHash: hashSessionToken(tokenA) }, rollbackTarget.id, { kind: "role", value: "admin" }));
    const rolledBack = await prisma.user.findUniqueOrThrow({ where: { id: rollbackTarget.id } });
    assert.equal(rolledBack.role, "USER"); assert.equal(rolledBack.authVersion, rollbackTarget.authVersion);
    assert.equal((await request("/internal/authorize", "POST", undefined, rollbackToken)).status, 200);
    await prisma.$executeRawUnsafe(`ALTER TABLE "UserAuditLog" DROP CONSTRAINT reject_admin_fixture_audit`);
    await prisma.user.update({ where: { id: b.id }, data: { role: "USER" } });
    await assert.rejects(() => changeUser({ userId: b.id, tokenHash: hashSessionToken(tokenB) }, target.id,
      { kind: "status", value: "suspended" }), (e) => e.code === "NOT_FOUND");
    assert.equal((await request(`/${a.id}/role`, "POST", { role: "user" }, tokenA)).body.code, "LAST_ADMIN");
    assert.equal((await request(`/${a.id}/status`, "POST", { status: "suspended" }, tokenA)).body.code, "LAST_ADMIN");
    await prisma.user.update({ where: { id: b.id }, data: { role: "ADMIN", lockedAt: new Date() } });
    assert.equal((await request(`/${a.id}/status`, "POST", { status: "suspended" }, tokenA)).body.code, "LAST_ADMIN");
    await prisma.user.update({ where: { id: b.id }, data: { lockedAt: null } });
    assert.equal((await request(`/${a.id}/role`, "POST", { role: "user" }, tokenA)).body.code, "SELF_DEMOTION_FORBIDDEN");
    console.log("PASS: failed audit rolls back promotion/revocation, current actor is rechecked and locked admins do not defeat last-admin protection");

    tokenA = await login(a); tokenB = await login(b);
    const race = await Promise.all([
      request(`/${b.id}/role`, "POST", { role: "user" }, tokenA),
      request(`/${a.id}/role`, "POST", { role: "user" }, tokenB),
    ]);
    assert.deepEqual(race.map((x) => x.status).sort(), [200, 404]);
    assert.equal(await prisma.user.count({ where: { role: "ADMIN" } }), 1);
    await prisma.user.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { role: "ADMIN", accessStatus: "ACTIVE" } });
    tokenA = await login(a); tokenB = await login(b);
    const suspendRace = await Promise.all([
      request(`/${b.id}/status`, "POST", { status: "suspended" }, tokenA),
      request(`/${a.id}/status`, "POST", { status: "suspended" }, tokenB),
    ]);
    assert.deepEqual(suspendRace.map((x) => x.status).sort(), [200, 404]);
    assert.equal(await prisma.user.count({ where: { role: "ADMIN", accessStatus: "ACTIVE" } }), 1);
    console.log("PASS: concurrent mutual demotion/suspension permits one winner and preserves an available admin");

    const lookup = `/internal/users/${target.id}/telegram`;
    const contact = await request(lookup);
    assert.equal(contact.status, 200);
    assert.deepEqual(contact.body, { userId: target.id, telegramHandle: target.telegramHandle });
    assert.equal(contact.cache, "no-store");
    // A leftover legacy header is ignored, so Order can roll out independently.
    assert.deepEqual((await request(lookup, "GET", undefined, undefined, { "x-service-token": "obsolete" })).body, contact.body);
    console.log("PASS: minimal Telegram lookup needs no shared token; admin routes still require real bearer sessions (live mesh enforcement not tested here)");
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (prisma) await prisma.$disconnect();
    if (createdDatabase) {
      assert.match(databaseName, pattern);
      await databaseAdmin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
      console.log("Removed only the disposable admin-routes database; no real users or external messages changed");
    }
    await databaseAdmin.$disconnect();
  }
});
