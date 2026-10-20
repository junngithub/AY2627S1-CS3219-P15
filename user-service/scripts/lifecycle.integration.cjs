const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomBytes, createHash } = require("node:crypto");
const { test } = require("node:test");
const { PrismaClient } = require("@prisma/client");

test("account lifecycle and service integration in an isolated PostgreSQL database", async () => {
  const databaseName = "user_lifecycle_it_" + randomBytes(6).toString("hex");
  assert.match(databaseName, /^user_lifecycle_it_[0-9a-f]{12}$/);
  const databaseUrl = "postgresql://user_service:user_service_dev@127.0.0.1:5554/";
  const databaseAdmin = new PrismaClient({ datasources: { db: { url: databaseUrl + "user_db" } } });
  let createdDatabase = false;
  let prisma;
  let server;
  try {
    await databaseAdmin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    createdDatabase = true;
    process.env.DATABASE_URL = databaseUrl + databaseName;
    process.env.NODE_ENV = "development";
    process.env.EMAIL_PROVIDER = "development"; // Never send real email from this fixture.
    process.env.APP_ENV = "test";
    process.env.ENABLE_TEST_VERIFICATION = "true";
    process.env.ORDER_USER_LOOKUP_TOKEN = randomBytes(32).toString("base64url");
    process.env.KAFKA_BROKERS = "";
    process.env.TELEGRAM_BOT_TOKEN = "";
    process.env.TELEGRAM_BOT_USERNAME = "";
    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
      cwd: require("node:path").resolve(__dirname, ".."), env: process.env, stdio: "pipe",
    });
    ({ prisma } = require("../dist/db"));
    const { createApp } = require("../dist/app");
    const { config } = require("../dist/config");
    const { hashPassword, hashSessionToken } = require("../dist/security");
    const { deleteExpiredAccounts, scheduleAccountDeletion, deletionDeadline } = require("../dist/account-lifecycle");
    const { DevelopmentEmailSender } = require("../dist/email");
    DevelopmentEmailSender.prototype.sendVerificationOtp = async () => undefined;
    const password = "LifecycleTestPass1";
    const passwordHash = await hashPassword(password, 1024);
    const app = createApp();
    await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/user`;

    async function request(endpoint, method = "GET", body, token, extraHeaders = {}) {
      const response = await fetch(baseUrl + endpoint, {
        method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}), ...extraHeaders },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
      });
      return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control"),
        userIdHeader: response.headers.get("x-user-id"), isAdminHeader: response.headers.get("x-is-admin"),
        permittedActionHeader: response.headers.get("x-permitted-action") };
    }
    async function user(overrides = {}) {
      const suffix = randomBytes(6).toString("hex");
      return prisma.user.create({ data: {
        email: `lifecycle_${suffix}@u.nus.edu`, name: "Lifecycle Integration Test", telegramHandle: `life_${suffix}`,
        passwordHash, emailVerifiedAt: new Date(), telegramVerifiedAt: new Date(), ...overrides,
      } });
    }
    async function login(target) {
      const result = await request("/login", "POST", { email: target.email, password });
      assert.equal(result.status, 200);
      return result.body.token;
    }
    const adminA = await user({ role: "ADMIN" });
    const adminB = await user({ role: "ADMIN" });
    const adminTokenA = await login(adminA);
    const adminTokenB = await login(adminB);
    const owner = await user();
    const ownerToken = await login(owner);
    const target = await user({ emailVerifiedAt: null, telegramVerifiedAt: null });
    const targetToken = await login(target);
    for (const [account, token, isAdmin, permittedAction] of [
      [owner, ownerToken, false, true], [adminA, adminTokenA, true, true], [target, targetToken, false, false],
    ]) {
      for (const endpoint of ["/internal/authorize", "/authorize"]) {
        for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
          const authorization = await request(endpoint, method, undefined, token);
          assert.equal(authorization.status, 200);
          assert.deepEqual(authorization.body, { authenticated: true, userId: account.id, isAdmin, permittedAction });
          assert.equal(authorization.userIdHeader, account.id);
          assert.equal(authorization.isAdminHeader, String(isAdmin));
          assert.equal(authorization.permittedActionHeader, String(permittedAction));
          assert.equal(authorization.cache, "no-store");
        }
      }
    }
    console.log("PASS: canonical internal authorize and legacy alias preserve bearer authentication, methods, identity headers and permissions");
    const lookup = `/internal/users/${target.id}/telegram`;
    const serviceHeaders = { "x-service-token": process.env.ORDER_USER_LOOKUP_TOKEN };
    const spoofHeaders = { "x-is-admin": "true", "x-user-id": adminA.id, "x-permitted-action": "true" };
    assert.equal((await request(lookup, "GET", undefined, adminTokenA, spoofHeaders)).status, 404);
    assert.equal((await request(lookup, "GET", undefined, undefined, { "x-service-token": "wrong" })).status, 404);
    assert.equal((await request("/internal/users/not-a-uuid/telegram", "GET", undefined, undefined, serviceHeaders)).status, 400);
    assert.equal((await request(lookup, "GET", undefined, undefined, serviceHeaders)).status, 409);

    const override = `/admin/users/${target.id}/verify`;
    assert.equal((await request(override, "POST", { reason: "Load-test setup" }, undefined, spoofHeaders)).status, 404);
    assert.equal((await request(override, "POST", { reason: "Load-test setup" }, ownerToken)).status, 404);
    assert.equal((await request(override, "POST", {}, adminTokenA)).status, 400);
    config.testVerificationEnabled = false;
    assert.equal((await request(override, "POST", { reason: "Load-test setup" }, adminTokenA)).status, 404);
    config.testVerificationEnabled = true;
    const changed = await request(override, "POST", { reason: "D3 load-test setup" }, adminTokenA);
    assert.equal(changed.status, 200);
    assert.equal(changed.body.status, "Verified");
    assert.equal(changed.body.changed, true);
    assert.deepEqual(changed.body.nextSteps, []);
    assert.equal((await request(override, "POST", { reason: "D3 load-test setup" }, adminTokenA)).body.changed, false);
    assert.equal(await prisma.userVerifiedOutbox.count({ where: { userId: target.id } }), 1);
    const audit = await prisma.userAuditLog.findMany({ where: { targetUserId: target.id, action: "TEST_USER_VERIFIED" } });
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actorUserId, adminA.id);
    assert.equal(audit[0].reason, "D3 load-test setup");
    const contact = await request(lookup, "GET", undefined, undefined, serviceHeaders);
    assert.equal(contact.status, 200);
    assert.equal(contact.cache, "no-store");
    assert.deepEqual(contact.body, { userId: target.id, telegramHandle: target.telegramHandle });
    assert.equal((await prisma.user.findUnique({ where: { id: target.id } })).role, "USER");
    const suspended = await user({ accessStatus: "SUSPENDED" });
    assert.equal((await request(`/admin/users/${suspended.id}/verify`, "POST", { reason: "Load-test setup" }, adminTokenA)).status, 409);
    assert.equal((await request(`/internal/users/${suspended.id}/telegram`, "GET", undefined, undefined, serviceHeaders)).status, 404);
    for (const [account, expiresAt] of [
      [suspended, new Date(Date.now() + 600_000)], [owner, new Date(Date.now() - 1000)],
    ]) {
      const token = randomBytes(32).toString("base64url");
      await prisma.authSession.create({ data: { userId: account.id, tokenHash: hashSessionToken(token), expiresAt } });
      for (const endpoint of ["/internal/authorize", "/authorize"]) {
        assert.equal((await request(endpoint, "GET", undefined, token)).status, 401);
      }
    }
    const actualIdentity = await request("/internal/authorize", "POST", undefined, ownerToken, spoofHeaders);
    assert.equal(actualIdentity.status, 200);
    assert.equal(actualIdentity.body.userId, owner.id);
    assert.equal(actualIdentity.body.isAdmin, false);
    console.log("PASS: scoped service-token lookup; spoofed headers and non-admin override denied; audit and verification event idempotent");

    const oldSession = await login(owner);
    const rawReset = randomBytes(32).toString("base64url");
    await prisma.passwordResetToken.create({ data: { userId: owner.id, tokenHash: createHash("sha256").update(rawReset).digest("hex"), expiresAt: new Date(Date.now() + 600_000) } });
    await prisma.emailVerificationOtp.create({ data: { userId: owner.id, otpHash: "test-hash", expiresAt: new Date(Date.now() + 600_000) } });
    await prisma.telegramVerificationChallenge.create({ data: { userId: owner.id, linkHash: "test-link-hash", expiresAt: new Date(Date.now() + 600_000) } });
    await prisma.userVerifiedOutbox.create({ data: { userId: owner.id, email: owner.email } });
    assert.equal((await request("/me", "DELETE", {}, ownerToken)).status, 400);
    assert.equal((await request("/me", "DELETE", { confirm: "true" }, ownerToken)).status, 400);
    const deletion = await request("/me", "DELETE", { confirm: true }, ownerToken);
    assert.equal(deletion.status, 202);
    const pending = await prisma.user.findUnique({ where: { id: owner.id } });
    assert.equal(pending.scheduledDeletionAt.toISOString(), deletionDeadline(pending.deletionRequestedAt).toISOString());
    assert.equal(deletion.body.scheduledDeletionAt, pending.scheduledDeletionAt.toISOString());
    assert.equal((await request("/me", "GET", undefined, ownerToken)).status, 401);
    for (const endpoint of ["/internal/authorize", "/authorize"]) {
      assert.equal((await request(endpoint, "POST", {}, oldSession)).status, 401);
    }
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: owner.id, revokedAt: null } }), 0);
    assert.equal(await prisma.telegramVerificationChallenge.count({ where: { userId: owner.id, revokedAt: null } }), 0);
    assert.equal((await request(`/admin/users/${owner.id}/verify`, "POST", { reason: "Load-test setup" }, adminTokenA)).status, 409);
    const restoredToken = await login(owner);
    const restored = await prisma.user.findUnique({ where: { id: owner.id } });
    assert.equal(restored.scheduledDeletionAt, null);
    assert.equal(restored.deletionRequestedAt, null);
    assert.equal((await request("/me", "GET", undefined, oldSession)).status, 401);
    assert.equal((await request("/me", "GET", undefined, restoredToken)).status, 200);
    assert.equal(await prisma.userAuditLog.count({ where: { targetUserId: owner.id, action: "ACCOUNT_DELETION_CANCELLED" } }), 1);
    console.log("PASS: confirmation, six-calendar-month deadline, session/challenge revocation, login restoration before the deadline");

    await request("/me", "DELETE", { confirm: true }, restoredToken);
    const repeat = await scheduleAccountDeletion(await prisma.user.findUnique({ where: { id: owner.id } }));
    const repeatRecord = await prisma.user.findUnique({ where: { id: owner.id } });
    assert.equal(repeat.toISOString(), repeatRecord.scheduledDeletionAt.toISOString());
    await prisma.user.update({ where: { id: owner.id }, data: { scheduledDeletionAt: new Date(Date.now() - 1000) } });
    const fakeActive = randomBytes(32).toString("base64url");
    await prisma.authSession.create({ data: { userId: owner.id, tokenHash: hashSessionToken(fakeActive), expiresAt: new Date(Date.now() + 600_000) } });
    assert.equal((await request("/login", "POST", { email: owner.email, password })).status, 401);
    for (const endpoint of ["/internal/authorize", "/authorize"]) {
      assert.equal((await request(endpoint, "POST", {}, fakeActive)).status, 401);
    }
    const cleaned = await Promise.all([
      deleteExpiredAccounts({ userIds: [owner.id] }), deleteExpiredAccounts({ userIds: [owner.id] }),
    ]);
    assert.equal(cleaned.reduce((sum, count) => sum + count, 0), 1);
    assert.equal(await prisma.user.findUnique({ where: { id: owner.id } }), null);
    for (const model of [prisma.authSession, prisma.passwordResetToken, prisma.emailVerificationOtp, prisma.telegramVerificationChallenge, prisma.userVerifiedOutbox]) {
      assert.equal(await model.count({ where: { userId: owner.id } }), 0);
    }
    assert.equal(await prisma.userAuditLog.count({ where: { targetUserId: owner.id, action: "ACCOUNT_DELETED" } }), 1);
    const registeredAgain = await request("/signup", "POST", { name: owner.name, email: owner.email, password, telegramHandle: owner.telegramHandle });
    assert.equal(registeredAgain.status, 201);
    assert.notEqual(registeredAgain.body.userId, owner.id);
    assert.equal(registeredAgain.body.status, "Created");
    console.log("PASS: expired accounts cannot restore; concurrent cleanup deletes once; owned data cascades; fresh signup is possible");

    const adminDeletions = await Promise.all([
      request("/me", "DELETE", { confirm: true }, adminTokenA),
      request("/me", "DELETE", { confirm: true }, adminTokenB),
    ]);
    assert.deepEqual(adminDeletions.map((result) => result.status).sort(), [202, 409]);
    const pendingAdmin = await prisma.user.findFirst({ where: { role: "ADMIN", scheduledDeletionAt: { not: null } } });
    const remainingAdmin = await prisma.user.findFirst({ where: { role: "ADMIN", scheduledDeletionAt: null } });
    assert.ok(pendingAdmin && remainingAdmin);
    await prisma.user.update({ where: { id: pendingAdmin.id }, data: { scheduledDeletionAt: new Date(Date.now() - 1000) } });
    assert.equal(await deleteExpiredAccounts({ userIds: [pendingAdmin.id] }), 1);
    await prisma.user.update({ where: { id: remainingAdmin.id }, data: { scheduledDeletionAt: new Date(Date.now() - 1000) } });
    assert.equal(await deleteExpiredAccounts({ userIds: [remainingAdmin.id] }), 0);
    assert.ok(await prisma.user.findUnique({ where: { id: remainingAdmin.id } }));
    console.log("PASS: simultaneous admin deletion requests and cleanup preserve the last administrator");
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma?.$disconnect();
    if (createdDatabase) {
      assert.match(databaseName, /^user_lifecycle_it_[0-9a-f]{12}$/);
      await databaseAdmin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
      console.log("Isolated lifecycle test database and all synthetic records removed");
    }
    await databaseAdmin.$disconnect();
  }
});
