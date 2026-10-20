const assert = require("node:assert/strict");
const { execFile, execFileSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const path = require("node:path");
const { test } = require("node:test");
const { PrismaClient } = require("@prisma/client");

test("first-admin CLI, atomic audit and concurrency in isolated PostgreSQL", async () => {
  const databaseName = "user_admin_bootstrap_it_" + randomBytes(6).toString("hex");
  assert.match(databaseName, /^user_admin_bootstrap_it_[0-9a-f]{12}$/);
  const baseDatabaseUrl = "postgresql://user_service:user_service_dev@127.0.0.1:5554/";
  const databaseAdmin = new PrismaClient({ datasources: { db: { url: baseDatabaseUrl + "user_db" } } });
  const directory = path.resolve(__dirname, "..");
  const cli = path.join(directory, "dist/bootstrap-admin.js");
  let createdDatabase = false;
  let prisma;
  let server;
  try {
    await databaseAdmin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    createdDatabase = true;
    process.env.DATABASE_URL = baseDatabaseUrl + databaseName;
    process.env.NODE_ENV = "development";
    process.env.EMAIL_PROVIDER = "development"; // Never send real email from this fixture.
    process.env.APP_ENV = "test";
    process.env.KAFKA_BROKERS = "";
    process.env.TELEGRAM_BOT_TOKEN = "";
    process.env.TELEGRAM_BOT_USERNAME = "";
    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
      cwd: directory, env: process.env, stdio: "pipe",
    });
    ({ prisma } = require("../dist/db"));
    const { bootstrapFirstAdmin, FIRST_ADMIN_BOOTSTRAPPED } = require("../dist/admin-bootstrap");
    const { hashPassword, hashSessionToken, hashPasswordResetToken } = require("../dist/security");
    const { DevelopmentEmailSender } = require("../dist/email");
    DevelopmentEmailSender.prototype.sendVerificationOtp = async () => undefined;
    const { createApp } = require("../dist/app");
    await new Promise((resolve) => { server = createApp().listen(0, "127.0.0.1", resolve); });
    const apiUrl = `http://127.0.0.1:${server.address().port}/api/v1/user`;
    const password = "BootstrapTestPass1";
    const passwordHash = await hashPassword(password, 1024);

    function runCli(args, envChanges = {}) {
      return new Promise((resolve) => {
        execFile(process.execPath, [cli, ...args], {
          cwd: directory, env: { ...process.env, NODE_ENV: "production", ...envChanges }, encoding: "utf8", timeout: 15_000,
        }, (error, stdout, stderr) => resolve({ status: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr }));
      });
    }
    async function request(endpoint, method = "GET", body, token) {
      const response = await fetch(apiUrl + endpoint, {
        method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
      });
      return { status: response.status, body: await response.json() };
    }
    async function user(overrides = {}) {
      const suffix = randomBytes(6).toString("hex");
      return prisma.user.create({ data: {
        name: "Bootstrap Integration Test", email: `bootstrap_${suffix}@u.nus.edu`, telegramHandle: `boot_${suffix}`,
        passwordHash, emailVerifiedAt: new Date(), telegramVerifiedAt: new Date(), ...overrides,
      } });
    }
    async function assertNoBootstrap() {
      assert.equal(await prisma.user.count({ where: { role: "ADMIN" } }), 0);
      assert.equal(await prisma.userAuditLog.count({ where: { action: FIRST_ADMIN_BOOTSTRAPPED } }), 0);
    }

    const target = await user();
    const args = ["--user-id", target.id, "--confirm"];
    const help = await runCli(["--help"], { DATABASE_URL: "" });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Deployment-only/);
    const missingConfirmation = await runCli(["--user-id", target.id], { DATABASE_URL: "" });
    assert.equal(missingConfirmation.status, 1);
    assert.match(missingConfirmation.stderr, /CONFIRMATION_REQUIRED/);
    const missingDatabase = await runCli(args, { DATABASE_URL: "" });
    assert.equal(missingDatabase.status, 1);
    assert.match(missingDatabase.stderr, /DATABASE_NOT_CONFIGURED/);
    const invalid = await runCli(["--user-id", "not-a-uuid", "--confirm"]);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /INVALID_USER_ID/);
    const unreachable = await runCli(args, { DATABASE_URL: "postgresql://synthetic:sensitive_test_marker@127.0.0.1:1/missing?connect_timeout=1" });
    assert.equal(unreachable.status, 1);
    assert.match(unreachable.stderr, /BOOTSTRAP_FAILED/);
    assert.doesNotMatch(unreachable.stderr + unreachable.stdout, /sensitive_test_marker|postgresql:\/\//);
    await assert.rejects(bootstrapFirstAdmin("00000000-0000-0000-0000-000000000000"), { code: "USER_NOT_FOUND" });
    await assertNoBootstrap();
    console.log("PASS: help/arguments fail closed before mutation; database errors do not expose credentials");

    for (const [changes, code] of [
      [{ emailVerifiedAt: null }, "USER_NOT_VERIFIED"], [{ telegramVerifiedAt: null }, "USER_NOT_VERIFIED"],
      [{ emailVerifiedAt: null, telegramVerifiedAt: null }, "USER_NOT_VERIFIED"],
      [{ accessStatus: "SUSPENDED" }, "USER_NOT_ELIGIBLE"], [{ lockedAt: new Date() }, "USER_NOT_ELIGIBLE"],
      [{ deletionRequestedAt: new Date() }, "USER_NOT_ELIGIBLE"],
      [{ scheduledDeletionAt: new Date(Date.now() + 600_000) }, "USER_NOT_ELIGIBLE"],
    ]) {
      const ineligible = await user(changes);
      await assert.rejects(bootstrapFirstAdmin(ineligible.id), { code });
      assert.equal((await prisma.user.findUnique({ where: { id: ineligible.id } })).role, "USER");
    }
    await assertNoBootstrap();
    for (const endpoint of ["/bootstrap-admin", "/internal/bootstrap-admin", "/admin/bootstrap"]) {
      assert.equal((await request(endpoint, "POST", { userId: target.id, confirm: true })).status, 404);
    }
    const suffix = randomBytes(6).toString("hex");
    const signedUp = await request("/signup", "POST", {
      name: "Ordinary Signup", email: `bootstrap_signup_${suffix}@u.nus.edu`, telegramHandle: `signup_${suffix}`, password,
    });
    assert.equal(signedUp.status, 201);
    assert.equal((await prisma.user.findUnique({ where: { id: signedUp.body.userId } })).role, "USER");
    console.log("PASS: only eligible existing users can bootstrap; signup and HTTP requests cannot grant admin roles");

    const oldToken = randomBytes(32).toString("base64url");
    const resetToken = randomBytes(32).toString("base64url");
    await prisma.authSession.create({ data: { userId: target.id, tokenHash: hashSessionToken(oldToken), expiresAt: new Date(Date.now() + 600_000) } });
    await prisma.passwordResetToken.create({ data: { userId: target.id, tokenHash: hashPasswordResetToken(resetToken), expiresAt: new Date(Date.now() + 600_000) } });
    // Force a real audit-write failure in this isolated DB to prove rollback.
    await prisma.$executeRawUnsafe('ALTER TABLE "UserAuditLog" ADD CONSTRAINT "test_reject_bootstrap" CHECK ("action" <> \'FIRST_ADMIN_BOOTSTRAPPED\')');
    const failedAudit = await runCli(args);
    assert.equal(failedAudit.status, 1);
    assert.match(failedAudit.stderr, /BOOTSTRAP_FAILED/);
    const rolledBack = await prisma.user.findUnique({ where: { id: target.id } });
    assert.equal(rolledBack.role, "USER");
    assert.equal(rolledBack.authVersion, target.authVersion);
    assert.equal((await prisma.authSession.findUnique({ where: { tokenHash: hashSessionToken(oldToken) } })).revokedAt, null);
    assert.equal((await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashPasswordResetToken(resetToken) } })).revokedAt, null);
    await assertNoBootstrap();
    await prisma.$executeRawUnsafe('ALTER TABLE "UserAuditLog" DROP CONSTRAINT "test_reject_bootstrap"');
    console.log("PASS: audit failure rolls back role changes, session revocation and reset-link revocation atomically");

    const success = await runCli(["--confirm", "--user-id", target.id.toUpperCase()]);
    assert.equal(success.status, 0, success.stderr);
    const output = JSON.parse(success.stdout);
    assert.equal(output.userId, target.id);
    assert.equal(output.role, "ADMIN");
    const promoted = await prisma.user.findUnique({ where: { id: target.id } });
    assert.equal(promoted.role, "ADMIN");
    assert.equal(promoted.authVersion, target.authVersion + 1);
    for (const key of ["email", "name", "passwordHash", "telegramHandle", "telegramUserId", "accessStatus"]) assert.equal(promoted[key], target[key]);
    assert.equal(promoted.emailVerifiedAt.toISOString(), target.emailVerifiedAt.toISOString());
    assert.equal(promoted.telegramVerifiedAt.toISOString(), target.telegramVerifiedAt.toISOString());
    assert.equal((await request("/internal/authorize", "POST", undefined, oldToken)).status, 401);
    assert.ok((await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashPasswordResetToken(resetToken) } })).revokedAt);
    const audit = await prisma.userAuditLog.findMany({ where: { action: FIRST_ADMIN_BOOTSTRAPPED } });
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actorUserId, null);
    assert.equal(audit[0].targetUserId, target.id);
    assert.match(audit[0].reason, /privileged deployment command/);
    const login = await request("/login", "POST", { email: target.email, password });
    assert.equal(login.status, 200);
    const authorized = await request("/internal/authorize", "POST", undefined, login.body.token);
    assert.equal(authorized.status, 200);
    assert.equal(authorized.body.isAdmin, true);
    assert.equal(authorized.body.permittedAction, true);
    assert.equal(await prisma.userVerifiedOutbox.count({ where: { userId: target.id } }), 0);
    console.log("PASS: compiled production-mode CLI promotes only the chosen role, audits once, revokes old credentials and permits fresh admin login");

    const another = await user();
    assert.match((await runCli(args)).stderr, /ADMIN_ALREADY_EXISTS/);
    await prisma.user.update({ where: { id: target.id }, data: { accessStatus: "SUSPENDED", scheduledDeletionAt: new Date(Date.now() - 1000) } });
    await assert.rejects(bootstrapFirstAdmin(another.id), { code: "ADMIN_ALREADY_EXISTS" });
    await prisma.user.update({ where: { id: target.id }, data: { role: "USER" } });
    await assert.rejects(bootstrapFirstAdmin(another.id), { code: "BOOTSTRAP_ALREADY_COMPLETED" });
    assert.equal((await prisma.user.findUnique({ where: { id: another.id } })).role, "USER");
    console.log("PASS: existing inactive admins and the durable bootstrap audit marker prevent repeat bootstrap");

    // Simulate a separate fresh setup by removing only this test's marker.
    // Every row in this uniquely named database is synthetic test data.
    await prisma.userAuditLog.deleteMany({ where: { id: audit[0].id, action: FIRST_ADMIN_BOOTSTRAPPED } });
    const competing = await user();
    const concurrent = await Promise.all([
      runCli(["--user-id", another.id, "--confirm"]), runCli(["--user-id", competing.id, "--confirm"]),
    ]);
    assert.deepEqual(concurrent.map((result) => result.status).sort(), [0, 1]);
    assert.match(concurrent.find((result) => result.status === 1).stderr, /ADMIN_ALREADY_EXISTS/);
    assert.equal(await prisma.user.count({ where: { role: "ADMIN" } }), 1);
    assert.equal(await prisma.userAuditLog.count({ where: { action: FIRST_ADMIN_BOOTSTRAPPED } }), 1);
    console.log("PASS: concurrent separate CLI processes create exactly one initial admin and one audit record");
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma?.$disconnect();
    if (createdDatabase) {
      assert.match(databaseName, /^user_admin_bootstrap_it_[0-9a-f]{12}$/);
      await databaseAdmin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
      console.log("Isolated bootstrap database and all synthetic users removed");
    }
    await databaseAdmin.$disconnect();
  }
});
