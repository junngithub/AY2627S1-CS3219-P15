const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomBytes, randomUUID } = require("node:crypto");
const { createServer } = require("node:http");
const path = require("node:path");
const { test } = require("node:test");
const { PrismaClient } = require("@prisma/client");

test("suspended login, reports and appeals with isolated User PostgreSQL and an HTTP Admin stub", { timeout: 120000 }, async () => {
  const databaseName = "user_support_it_" + randomBytes(6).toString("hex");
  const pattern = /^user_support_it_[0-9a-f]{12}$/;
  assert.match(databaseName, pattern);
  const prefix = "postgresql://user_service:user_service_dev@127.0.0.1:5554/";
  const databaseAdmin = new PrismaClient({ datasources: { db: { url: prefix + "user_db" } } });
  let createdDatabase = false; let prisma; let server; let unconfiguredServer; let adminServer;
  try {
    await databaseAdmin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    createdDatabase = true;
    Object.assign(process.env, { DATABASE_URL: prefix + databaseName, NODE_ENV: "development", APP_ENV: "test",
      EMAIL_PROVIDER: "disabled", TELEGRAM_BOT_TOKEN: "", TELEGRAM_BOT_USERNAME: "", KAFKA_BROKERS: "",
      ADMIN_SERVICE_BASE_URL: "", ENABLE_TEST_VERIFICATION: "false", PASSWORD_SCRYPT_COST: "1024" });
    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
      cwd: path.resolve(__dirname, ".."), env: process.env, stdio: "pipe",
    });
    ({ prisma } = require("../dist/db"));
    const { createApp } = require("../dist/app");
    const { HttpAdminIntake } = require("../dist/admin-intake");
    const { hashPassword, hashSessionToken } = require("../dist/security");
    const password = "SupportFixturePass1";
    const passwordHash = await hashPassword(password, 1024);
    const calls = []; const reports = new Map(); const appeals = new Map();
    let mode = "ok";
    adminServer = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      calls.push({ path: req.url, method: req.method, headers: req.headers, body });
      if (mode === "hang") return;
      if (mode === "error") { res.writeHead(500); res.end("private upstream failure"); return; }
      if (mode === "malformed") { res.writeHead(201); res.end("{}"); return; }
      const common = { id: randomUUID(), status: "open", created_at: new Date().toISOString(), closed_at: null, closed_by_admin_id: null };
      let record;
      if (req.url === "/api/v1/admin/reports") {
        const key = body.reporterUserId + ":" + body.reportedUserId;
        if (!reports.has(key)) reports.set(key, { ...common, reporter_user_id: body.reporterUserId,
          reported_user_id: body.reportedUserId, comment: body.comment });
        record = reports.get(key);
      } else {
        assert.equal(req.url, "/api/v1/admin/appeals");
        if (!appeals.has(body.userId)) appeals.set(body.userId, { ...common, user_id: body.userId, message: body.message });
        record = appeals.get(body.userId);
      }
      res.writeHead(201, { "content-type": "application/json" }); res.end(JSON.stringify(record));
    });
    await new Promise((resolve) => adminServer.listen(0, "127.0.0.1", resolve));
    const client = new HttpAdminIntake(`http://127.0.0.1:${adminServer.address().port}`, 250);
    await new Promise((resolve) => { server = createApp(undefined, undefined, client).listen(0, "127.0.0.1", resolve); });
    const base = `http://127.0.0.1:${server.address().port}/api/v1/user`;
    async function post(endpoint, body, token, extra = {}, origin = base) {
      const response = await fetch(origin + endpoint, { method: "POST", headers: { "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
    }
    async function user(data = {}) {
      const suffix = randomBytes(6).toString("hex");
      const row = await prisma.user.create({ data: { email: `support_${suffix}@u.nus.edu`, name: "Support Fixture",
        telegramHandle: "support_" + suffix, passwordHash, emailVerifiedAt: new Date(), telegramVerifiedAt: new Date(), ...data } });
      const token = randomBytes(32).toString("base64url");
      await prisma.authSession.create({ data: { userId: row.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 60000) } });
      return { ...row, token };
    }
    const a = await user(); const b = await user(); const suspended = await user({ accessStatus: "SUSPENDED", suspendedAt: new Date() });
    const generic = { error: "Wrong password or user not found", code: "INVALID_CREDENTIALS" };
    const sessionCount = await prisma.authSession.count();
    const correct = await post("/login", { email: suspended.email, password });
    assert.equal(correct.status, 403); assert.equal(correct.body.code, "ACCOUNT_SUSPENDED"); assert.equal(correct.cache, "no-store");
    const wrong = await post("/login", { email: suspended.email, password: "WrongPassword1" });
    assert.equal(wrong.status, 401); assert.deepEqual(wrong.body, generic);
    assert.deepEqual((await post("/login", { email: "unknown@u.nus.edu", password })).body, generic);
    assert.equal(await prisma.authSession.count(), sessionCount);
    const validLogin = await post("/login", { email: a.email, password });
    assert.equal(validLogin.status, 200); assert.ok(validLogin.body.token);
    console.log("PASS: correct suspended login returns403 without session; wrong/unknown stay generic401; active login still succeeds");

    const reportBody = { reportedUserId: b.id, comment: " A report ", reporterUserId: b.id };
    const beforeReports = calls.length;
    for (const token of [undefined, "fake", suspended.token]) assert.equal((await post("/reports", reportBody, token, { "x-user-id": a.id })).status, 401);
    assert.equal((await post("/reports", { reportedUserId: a.id, comment: "self" }, a.token)).body.code, "SELF_REPORT");
    assert.equal((await post("/reports", { reportedUserId: randomUUID(), comment: "missing" }, a.token)).status, 404);
    for (const body of [{ comment: "missing ID" }, { reportedUserId: b.id, comment: "  " }, { reportedUserId: b.id, comment: "x".repeat(4001) }]) {
      assert.equal((await post("/reports", body, a.token)).status, 400);
    }
    const revoked = await user();
    await prisma.authSession.updateMany({ where: { userId: revoked.id }, data: { revokedAt: new Date() } });
    assert.equal((await post("/reports", reportBody, revoked.token)).status, 401);
    assert.equal(calls.length, beforeReports);
    const reported = await post("/reports", reportBody, a.token);
    assert.equal(reported.status, 201); assert.equal(reported.cache, "no-store");
    assert.deepEqual(calls.at(-1).body, { reporterUserId: a.id, reportedUserId: b.id, comment: "A report" });
    assert.equal(calls.at(-1).headers.authorization, undefined);
    assert.equal(reported.body.reporter_user_id, a.id);
    const repeatReport = await post("/reports", { ...reportBody, comment: "replacement" }, a.token);
    assert.deepEqual(repeatReport.body, reported.body);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: b.id } })).accessStatus, "ACTIVE");
    console.log("PASS: reports derive identity from session, validate target/text, relay201, preserve stored response and never auto-suspend");

    const beforeAppeals = calls.length;
    for (const body of [{ email: "unknown@u.nus.edu", password, message: "test" },
      { email: suspended.email, password: "WrongPassword1", message: "test" }]) {
      const response = await post("/appeals", body);
      assert.equal(response.status, 401); assert.deepEqual(response.body, generic);
    }
    assert.equal((await post("/appeals", { email: a.email, password, message: "not suspended" })).body.code, "ACCOUNT_NOT_SUSPENDED");
    for (const message of ["", "   ", "x".repeat(4001)]) {
      assert.equal((await post("/appeals", { email: suspended.email, password, message })).status, 400);
    }
    for (const unavailable of [await user({ accessStatus: "SUSPENDED", lockedAt: new Date() }),
      await user({ accessStatus: "SUSPENDED", scheduledDeletionAt: new Date(Date.now() - 1000) })]) {
      assert.equal((await post("/appeals", { email: unavailable.email, password, message: "test" })).status, 401);
      if (unavailable.lockedAt) assert.equal((await post("/login", { email: unavailable.email, password })).status, 403);
    }
    assert.equal(calls.length, beforeAppeals);
    const beforeAppealSessions = await prisma.authSession.count();
    const appeal = await post("/appeals", { email: suspended.email.toUpperCase(), password, message: " Review my suspension ", userId: b.id });
    assert.equal(appeal.status, 201); assert.equal(appeal.cache, "no-store");
    assert.deepEqual(calls.at(-1).body, { userId: suspended.id, message: "Review my suspension" });
    assert.equal(calls.at(-1).headers.authorization, undefined);
    const simultaneous = await Promise.all(Array.from({ length: 4 }, () => post("/appeals", {
      email: suspended.email, password, message: "A retry" })));
    for (const response of simultaneous) { assert.equal(response.status, 201); assert.deepEqual(response.body, appeal.body); }
    assert.equal(appeals.size, 1);
    assert.equal(await prisma.authSession.count(), beforeAppealSessions);
    const stillSuspended = await prisma.user.findUniqueOrThrow({ where: { id: suspended.id } });
    assert.equal(stillSuspended.accessStatus, "SUSPENDED"); assert.equal(stillSuspended.passwordHash, passwordHash);
    console.log("PASS: appeals require correct suspended credentials, never forward password/issue session/reinstate, and relay Admin's one-open-appeal behavior");

    const limited = await user({ accessStatus: "SUSPENDED" });
    for (let i = 0; i < 10; i++) assert.equal((await post("/appeals", { email: limited.email, password: "wrong", message: "test" })).status, 401);
    assert.equal((await post("/appeals", { email: limited.email, password, message: "test" })).status, 429);
    const failures = await user({ accessStatus: "SUSPENDED" });
    for (const [failureMode, expected] of [["error", 503], ["malformed", 502], ["hang", 503]]) {
      mode = failureMode;
      const response = await post("/appeals", { email: failures.email, password, message: "test" });
      assert.equal(response.status, expected);
      assert.ok(!JSON.stringify(response.body).includes("private"));
    }
    mode = "ok";
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: failures.id } })).accessStatus, "SUSPENDED");
    await new Promise((resolve) => { unconfiguredServer = createApp().listen(0, "127.0.0.1", resolve); });
    const unconfigured = `http://127.0.0.1:${unconfiguredServer.address().port}/api/v1/user`;
    assert.equal((await post("/reports", reportBody, a.token, {}, unconfigured)).body.code, "ADMIN_NOT_CONFIGURED");
    console.log("PASS: appeal throttling, timeout/malformed/failing Admin responses, missing configuration and sanitized errors fail closed");
  } finally {
    for (const listener of [server, unconfiguredServer, adminServer]) if (listener) {
      listener.closeAllConnections();
      await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    }
    await prisma?.$disconnect();
    if (createdDatabase) {
      assert.match(databaseName, pattern);
      await databaseAdmin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
      console.log("Removed only disposable support-test DB; Admin was a stub; no normal accounts or real messages changed");
    }
    await databaseAdmin.$disconnect();
  }
});
