const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const path = require("node:path");
const { test } = require("node:test");
const { PrismaClient } = require("@prisma/client");

test("SES email routes with a fake sender and isolated PostgreSQL", async () => {
  const databaseName = "user_email_it_" + randomBytes(6).toString("hex");
  const databasePattern = /^user_email_it_[0-9a-f]{12}$/;
  assert.match(databaseName, databasePattern);
  const baseDatabaseUrl = "postgresql://user_service:user_service_dev@127.0.0.1:5554/";
  const admin = new PrismaClient({ datasources: { db: { url: baseDatabaseUrl + "user_db" } } });
  let createdDatabase = false;
  let prisma;
  let server;
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    createdDatabase = true;
    Object.assign(process.env, { DATABASE_URL: baseDatabaseUrl + databaseName,
      NODE_ENV: "development", EMAIL_PROVIDER: "disabled", KAFKA_BROKERS: "",
      TELEGRAM_BOT_TOKEN: "", TELEGRAM_BOT_USERNAME: "", PASSWORD_SCRYPT_COST: "1024",
      FRONTEND_BASE_URL: "https://frontend.example.com" });
    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
      cwd: path.resolve(__dirname, ".."), env: process.env, stdio: "pipe",
    });
    ({ prisma } = require("../dist/db"));
    const { createApp } = require("../dist/app");
    const { SesEmailSender } = require("../dist/email");
    const messages = [];
    let failDelivery = false;
    const sender = new SesEmailSender("sender@example.com", { send: async (command) => {
      if (failDelivery) throw new Error("synthetic-private-aws-error");
      messages.push(command.input);
      return { MessageId: "fake-no-email-sent" };
    } });
    await new Promise((resolve) => { server = createApp(undefined, sender).listen(0, "127.0.0.1", resolve); });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/user`;
    async function post(endpoint, body) {
      const response = await fetch(baseUrl + endpoint, { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
      return { status: response.status, body: await response.json() };
    }
    const account = { name: "Email Integration Test", email: "email_fixture@u.nus.edu",
      password: "EmailTestPass1", telegramHandle: "email_fixture" };
    const text = () => messages.at(-1).Content.Simple.Body.Text.Data;
    failDelivery = true;
    const rejected = await post("/signup", account);
    assert.deepEqual(rejected, { status: 503, body: {
      error: "Unable to send email right now. Please try again.", code: "EMAIL_DELIVERY_FAILED",
    } });
    const saved = await prisma.user.findUniqueOrThrow({ where: { email: account.email } });
    assert.equal(saved.emailVerifiedAt, null);
    assert.equal(await prisma.userVerifiedOutbox.count(), 0);
    assert.equal((await post("/signup", account)).status, 409);
    assert.equal(messages.length, 0);
    console.log("PASS: failed signup delivery returns sanitized 503, retains an unverified account and grants no credits");

    const failedResend = await post("/resend-verification", { email: account.email });
    assert.deepEqual(failedResend, await post("/resend-verification", { email: "missing@u.nus.edu" }));
    assert.equal(failedResend.status, 202);
    failDelivery = false;
    assert.equal((await post("/resend-verification", { email: account.email })).status, 202);
    assert.deepEqual(messages.at(-1).Destination, { ToAddresses: [account.email] });
    const otp = text().match(/code is: (\d{6})/)[1];
    const stored = await prisma.emailVerificationOtp.findFirstOrThrow({ where: { userId: saved.id, revokedAt: null }, orderBy: { createdAt: "desc" } });
    assert.notEqual(stored.otpHash, otp);
    const verified = await post("/verify-email", { email: account.email, otp });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.status, "Created");
    assert.deepEqual(verified.body.nextSteps, ["VERIFY_TELEGRAM"]);
    assert.equal(await prisma.userVerifiedOutbox.count(), 0);
    console.log("PASS: resend does not reveal delivery failure/account existence; sent OTP verifies email but still requires Telegram");

    const second = { ...account, email: "email_second@nus.edu.sg", telegramHandle: "email_second" };
    assert.equal((await post("/signup", second)).status, 201);
    assert.deepEqual(messages.at(-1).Destination, { ToAddresses: [second.email] });
    assert.match(text(), /code is: \d{6}/);
    const oldSession = await post("/login", { email: account.email, password: account.password });
    assert.equal(oldSession.status, 200);
    failDelivery = true;
    const failedReset = await post("/forgot-password", { email: account.email });
    assert.equal(failedReset.status, 202);
    assert.deepEqual(failedReset, await post("/forgot-password", { email: "missing@u.nus.edu" }));
    failDelivery = false;
    assert.equal((await post("/forgot-password", { email: account.email })).status, 202);
    const link = new URL(text().split("\n").find((line) => line.startsWith("https://")));
    assert.equal(link.origin, "https://frontend.example.com");
    assert.equal(link.pathname, "/reset-password");
    const token = link.searchParams.get("token");
    assert.ok(token);
    const newPassword = "ReplacementPass2";
    assert.equal((await post("/reset-password", { token, newPassword })).status, 200);
    assert.equal((await post("/reset-password", { token, newPassword })).status, 400);
    assert.equal((await post("/login", { email: account.email, password: account.password })).status, 401);
    assert.equal((await post("/login", { email: account.email, password: newPassword })).status, 200);
    const oldProfile = await fetch(baseUrl + "/me", { headers: { authorization: "Bearer " + oldSession.body.token } });
    assert.equal(oldProfile.status, 401);
    console.log("PASS: SES reset link uses the frontend origin, is single-use, changes the password and revokes prior sessions");
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (prisma) await prisma.$disconnect();
    if (createdDatabase) {
      assert.match(databaseName, databasePattern);
      await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
      console.log("Removed only the disposable email-test database; no real emails sent");
    }
    await admin.$disconnect();
  }
});
