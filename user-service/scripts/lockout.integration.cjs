const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const path = require("node:path");
const { test } = require("node:test");
const { PrismaClient } = require("@prisma/client");

test("login lockout notifications with fake SES and isolated PostgreSQL", async () => {
  const databaseName = "user_lockout_it_" + randomBytes(6).toString("hex");
  const pattern = /^user_lockout_it_[0-9a-f]{12}$/;
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
      LOGIN_MAX_ATTEMPTS: "5", PASSWORD_SCRYPT_COST: "1024", FRONTEND_BASE_URL: "https://frontend.example.com" });
    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
      cwd: path.resolve(__dirname, ".."), env: process.env, stdio: "pipe",
    });
    ({ prisma } = require("../dist/db"));
    const { createApp } = require("../dist/app");
    const { SesEmailSender } = require("../dist/email");
    const { hashPassword } = require("../dist/security");
    const { recordFailedLogin } = require("../dist/login-security");
    const requests = [];
    let failDelivery = false;
    const sender = new SesEmailSender("sender@example.com", { send: async (command) => {
      requests.push(command.input);
      if (failDelivery) throw new Error("private provider error that must not reach the login response");
      return { MessageId: "fake-lockout-message" };
    } });
    await new Promise((resolve) => { server = createApp(undefined, sender).listen(0, "127.0.0.1", resolve); });
    const base = `http://127.0.0.1:${server.address().port}/api/v1/user`;
    async function post(endpoint, body) {
      const response = await fetch(base + endpoint, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
      return { status: response.status, body: await response.json() };
    }
    const password = "LockoutFixture1";
    const passwordHash = await hashPassword(password, 1024);
    async function user(overrides = {}) {
      const suffix = randomBytes(6).toString("hex");
      return prisma.user.create({ data: { email: `lockout_${suffix}@u.nus.edu`, name: "Lockout Fixture",
        telegramHandle: `lock_${suffix}`, passwordHash, emailVerifiedAt: new Date(), telegramVerifiedAt: new Date(), ...overrides } });
    }
    const genericFailure = { status: 401, body: { error: "Wrong password or user not found", code: "INVALID_CREDENTIALS" } };
    const account = await user();
    const oldSession = await post("/login", { email: account.email, password });
    assert.equal(oldSession.status, 200);
    assert.deepEqual(await post("/login", { email: "missing@u.nus.edu", password }), genericFailure);
    for (let i = 0; i < 4; i++) {
      assert.deepEqual(await post("/login", { email: account.email, password: "IncorrectPassword1" }), genericFailure);
    }
    assert.equal(requests.length, 0);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).failedLoginAttempts, 4);
    const concurrent = await Promise.all(Array.from({ length: 12 }, () =>
      post("/login", { email: account.email, password: "IncorrectPassword1" })));
    for (const result of concurrent) assert.deepEqual(result, genericFailure);
    const locked = await prisma.user.findUniqueOrThrow({ where: { id: account.id } });
    assert.equal(locked.failedLoginAttempts, 5);
    assert.ok(locked.lockedAt);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].Destination, { ToAddresses: [account.email] });
    assert.match(requests[0].Content.Simple.Subject.Data, /Account locked/);
    assert.match(requests[0].Content.Simple.Body.Text.Data, /https:\/\/frontend.example.com\/forgot-password/);
    assert.ok(!requests[0].Content.Simple.Body.Text.Data.includes(password));
    assert.deepEqual(await post("/login", { email: account.email, password }), genericFailure);
    assert.deepEqual(await post("/login", { email: account.email, password: "IncorrectPassword1" }), genericFailure);
    assert.equal(requests.length, 1);
    console.log("PASS: fifth failure locks the account; concurrent and repeated attempts produce one warning and the same generic response");

    assert.equal((await post("/forgot-password", { email: account.email })).status, 202);
    const resetBody = requests.at(-1).Content.Simple.Body.Text.Data;
    const resetUrl = new URL(resetBody.split("\n").find((line) => line.startsWith("https://")));
    const newPassword = "RecoveredFixture2";
    assert.equal((await post("/reset-password", { token: resetUrl.searchParams.get("token"), newPassword })).status, 200);
    assert.equal((await post("/login", { email: account.email, password: newPassword })).status, 200);
    const restored = await prisma.user.findUniqueOrThrow({ where: { id: account.id } });
    assert.equal(restored.lockedAt, null);
    assert.equal(restored.failedLoginAttempts, 0);
    const oldProfile = await fetch(base + "/me", { headers: { authorization: `Bearer ${oldSession.body.token}` } });
    assert.equal(oldProfile.status, 401);
    console.log("PASS: password recovery unlocks login, resets the counter and revokes old sessions");

    const failing = await user({ failedLoginAttempts: 4 });
    failDelivery = true;
    const beforeFailure = requests.length;
    assert.deepEqual(await post("/login", { email: failing.email, password: "IncorrectPassword1" }), genericFailure);
    assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: failing.id } })).lockedAt);
    assert.deepEqual(await post("/login", { email: failing.email, password }), genericFailure);
    assert.equal(requests.length, beforeFailure + 1);
    failDelivery = false;
    console.log("PASS: notification delivery failure cannot undo lockout or expose account/provider details");

    const stale = await user();
    const replacementHash = await hashPassword(newPassword, 1024);
    await prisma.user.update({ where: { id: stale.id }, data: { passwordHash: replacementHash } });
    assert.equal(await recordFailedLogin(stale.id, passwordHash), null);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: stale.id } })).failedLoginAttempts, 0);
    for (const unavailable of [await user({ accessStatus: "SUSPENDED" }),
      await user({ scheduledDeletionAt: new Date(Date.now() - 1000) })]) {
      assert.deepEqual(await post("/login", { email: unavailable.email, password: "IncorrectPassword1" }), genericFailure);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: unavailable.id } })).failedLoginAttempts, 0);
    }
    const beforeSuccess = requests.length;
    await prisma.user.update({ where: { id: account.id }, data: { failedLoginAttempts: 4 } });
    assert.equal((await post("/login", { email: account.email, password: newPassword })).status, 200);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).failedLoginAttempts, 0);
    assert.equal(requests.length, beforeSuccess);
    console.log("PASS: stale password checks cannot lock a reset account; unavailable accounts do not trigger warnings; successful login resets attempts");
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma?.$disconnect();
    if (createdDatabase) {
      assert.match(databaseName, pattern);
      await databaseAdmin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
      console.log("Removed only the disposable lockout-test database; no real messages or accounts changed");
    }
    await databaseAdmin.$disconnect();
  }
});
