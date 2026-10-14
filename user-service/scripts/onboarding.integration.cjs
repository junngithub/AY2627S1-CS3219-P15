const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createHash, randomBytes } = require("node:crypto");
const path = require("node:path");
const { test } = require("node:test");
const { PrismaClient } = require("@prisma/client");

const serviceDirectory = path.resolve(__dirname, "..");
process.env.DATABASE_URL = "postgresql://user_service:user_service_dev@127.0.0.1:5554/user_db";
const prisma = new PrismaClient();
const { handleTelegramUpdate } = require("../dist/telegram");
const { prisma: botDatabase } = require("../dist/db");
const baseUrl = "http://127.0.0.1:8080/api/v1/user";
const hash = (value) => createHash("sha256").update(value).digest("hex");

function docker(args) {
  return execFileSync("docker", ["compose", ...args], {
    cwd: serviceDirectory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
}

async function request(endpoint, body, token, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, body: await response.json() };
}

function loggedOtp(prefix) {
  const line = docker(["logs", "--no-color", "user-service"]).split(/\r?\n/).filter((entry) => entry.includes(prefix)).at(-1);
  assert.ok(line, "A development OTP must be available in the service log");
  const otp = line.split(prefix)[1].slice(0, 6);
  assert.match(otp, /^\d{6}$/);
  return otp;
}

function loggedResetToken(email) {
  const prefix = `[development email] Password reset link for ${email}: `;
  const line = docker(["logs", "--no-color", "user-service"]).split(/\r?\n/).filter((entry) => entry.includes(prefix)).at(-1);
  assert.ok(line);
  return new URL(line.split(prefix)[1].split(" (expires")[0]).searchParams.get("token");
}

test("complete local verification and profile password workflow", async () => {
  assert.equal(docker(["exec", "-T", "user-service", "printenv", "NODE_ENV"]).trim(), "development");
  assert.equal(docker(["exec", "-T", "user-service", "printenv", "TELEGRAM_BOT_TOKEN"]).trim(), "",
    "This automated test uses development delivery only");
  const created = [];
  async function signup() {
    const suffix = randomBytes(8).toString("hex");
    const email = `onboarding_it_${suffix}@u.nus.edu`;
    const telegramHandle = `onboard_${suffix}`;
    const result = await request("/signup", { name: "Onboarding Integration Test", email, password: "OriginalPass1", telegramHandle });
    assert.equal(result.status, 201);
    const id = result.body.userId;
    created.push(id);
    const login = await request("/login", { email, password: "OriginalPass1" });
    assert.equal(login.status, 200);
    return { id, email, telegramHandle, token: login.body.token,
      emailOtp: loggedOtp(`[development email] Verification OTP for ${email}: `) };
  }
  async function telegramCode(user) {
    const result = await request("/request-telegram-verification", {}, user.token);
    assert.equal(result.status, 202);
    assert.equal(result.body.telegramBotUrl, null);
    return loggedOtp(`[development telegram] Verification OTP for ${user.id} (@${user.telegramHandle}): `);
  }
  async function permitAnotherRequest(id) {
    await prisma.telegramVerificationChallenge.updateMany({
      where: { userId: id }, data: { createdAt: new Date(Date.now() - 61_000) },
    });
  }

  try {
    const first = await signup();
    assert.equal((await request("/authorize", {}, first.token)).body.permittedAction, false);
    const emailOnly = await request("/verify-email", { email: first.email, otp: first.emailOtp });
    assert.equal(emailOnly.status, 200);
    assert.equal(emailOnly.body.status, "Created");
    assert.equal(await prisma.userVerifiedOutbox.count({ where: { userId: first.id } }), 0);

    const expiredOtp = await telegramCode(first);
    assert.equal((await request("/request-telegram-verification", {}, first.token)).status, 429);
    await prisma.telegramVerificationChallenge.updateMany({
      where: { userId: first.id }, data: { expiresAt: new Date(Date.now() - 1000) },
    });
    assert.equal((await request("/verify-telegram", { otp: expiredOtp }, first.token)).body.code, "INVALID_OTP");
    await permitAnotherRequest(first.id);
    const limitedOtp = await telegramCode(first);
    const wrongOtp = String((Number(limitedOtp) + 1) % 1_000_000).padStart(6, "0");
    const attempts = await Promise.all(Array.from({ length: 5 }, () => request("/verify-telegram", { otp: wrongOtp }, first.token)));
    assert.ok(attempts.every((result) => result.status === 400));
    const limited = await prisma.telegramVerificationChallenge.findFirst({ where: { userId: first.id }, orderBy: { createdAt: "desc" } });
    assert.equal(limited.attemptCount, 5);
    assert.ok(limited.revokedAt);
    assert.equal((await request("/verify-telegram", { otp: limitedOtp }, first.token)).status, 400);
    await permitAnotherRequest(first.id);
    const validOtp = await telegramCode(first);
    const verified = await request("/verify-telegram", { otp: validOtp }, first.token);
    assert.equal(verified.status, 200);
    assert.equal(verified.body.status, "Verified");
    assert.deepEqual(verified.body.nextSteps, []);
    assert.equal((await request("/authorize", {}, first.token)).body.permittedAction, true);
    assert.equal((await request("/verify-telegram", { otp: validOtp }, first.token)).status, 200);
    assert.equal(await prisma.userVerifiedOutbox.count({ where: { userId: first.id } }), 1);
    const queued = await prisma.userVerifiedOutbox.findUnique({ where: { userId: first.id } });
    assert.equal(queued.publishedAt, null, "With Kafka disabled the durable event must remain queued");
    console.log("PASS: OTP expiry, cooldown, concurrent attempt limit, Created -> Verified, permitted actions, exactly one queued event");

    const otherSession = await request("/login", { email: first.email, password: "OriginalPass1" });
    await request("/forgot-password", { email: first.email });
    const weakChange = await request("/me/password", { newPassword: "weak" }, first.token, "PATCH");
    assert.equal(weakChange.body.code, "INVALID_PASSWORD");
    const changed = await request("/me/password", { newPassword: "ChangedProfilePass2" }, first.token, "PATCH");
    assert.equal(changed.status, 200);
    assert.equal((await request("/me", undefined, first.token)).status, 200);
    assert.equal((await request("/me", undefined, otherSession.body.token)).status, 401);
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: first.id, usedAt: null, revokedAt: null } }), 0);
    assert.equal((await request("/login", { email: first.email, password: "OriginalPass1" })).status, 401);
    assert.equal((await request("/login", { email: first.email, password: "ChangedProfilePass2" })).status, 200);
    console.log("PASS: profile password change retains this session, revokes other sessions/reset links, and changes login credentials");

    await request("/forgot-password", { email: first.email });
    const competingToken = loggedResetToken(first.email);
    const passwordRace = await Promise.all([
      request("/reset-password", { token: competingToken, newPassword: "RecoveryRacePass4" }),
      request("/me/password", { newPassword: "ProfileRacePass5" }, first.token, "PATCH"),
    ]);
    assert.equal(passwordRace.filter((result) => result.status === 200).length, 1);
    assert.ok(passwordRace.every((result) => [200, 400, 401].includes(result.status)));
    console.log("PASS: simultaneous password recovery and profile change have exactly one winner without a deadlock");

    const second = await signup();
    const secondOtp = await telegramCode(second);
    const telegramOnly = await request("/verify-telegram", { otp: secondOtp }, second.token);
    assert.equal(telegramOnly.body.status, "Created");
    assert.deepEqual(telegramOnly.body.nextSteps, ["VERIFY_EMAIL"]);
    assert.equal(await prisma.userVerifiedOutbox.count({ where: { userId: second.id } }), 0);
    assert.equal((await request("/verify-email", { email: second.email, otp: second.emailOtp })).body.status, "Verified");
    assert.equal(await prisma.userVerifiedOutbox.count({ where: { userId: second.id } }), 1);

    const third = await signup();
    const link = randomBytes(32).toString("base64url");
    const challenge = await prisma.telegramVerificationChallenge.create({ data: {
      userId: third.id, linkHash: hash(link), expiresAt: new Date(Date.now() + 600_000),
    } });
    const replies = [];
    const messages = { sendMessage: async (_chatId, text) => { replies.push(text); } };
    const senderId = Math.floor(Math.random() * 1_000_000_000) + 1;
    const update = { update_id: 1, message: { text: `/start ${link}`, chat: { id: senderId, type: "private" }, from: { id: senderId, username: "wrong_handle" } } };
    await handleTelegramUpdate(update, messages);
    assert.equal((await prisma.telegramVerificationChallenge.findUnique({ where: { id: challenge.id } })).sentAt, null);
    update.message.from.username = third.telegramHandle;
    await handleTelegramUpdate(update, messages);
    const sentOtp = replies.at(-1).match(/code is (\d{6})/)[1];
    const concurrent = await Promise.all([
      request("/verify-email", { email: third.email, otp: third.emailOtp }),
      request("/verify-telegram", { otp: sentOtp }, third.token),
    ]);
    assert.ok(concurrent.every((result) => result.status === 200));
    const linked = await prisma.user.findUnique({ where: { id: third.id } });
    assert.equal(linked.telegramUserId, String(senderId));
    assert.equal((await request("/me", undefined, third.token)).body.status, "Verified");
    assert.equal(await prisma.userVerifiedOutbox.count({ where: { userId: third.id } }), 1);
    console.log("PASS: either verification order, matching Telegram ownership through a simulated bot, concurrent verification without duplicate events");
  } finally {
    for (const id of created) await prisma.user.delete({ where: { id } });
    await Promise.all([prisma.$disconnect(), botDatabase.$disconnect()]);
    console.log("Temporary onboarding accounts and their records removed");
  }
});
