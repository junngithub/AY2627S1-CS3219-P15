const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createHash, randomBytes } = require("node:crypto");
const path = require("node:path");
const { test } = require("node:test");
const { PrismaClient } = require("@prisma/client");

// This test is deliberately tied to the local development Compose setup.
// It creates one random account and deletes only that account in finally.
const serviceDirectory = path.resolve(__dirname, "..");
const baseUrl = "http://127.0.0.1:8080/api/v1/user";
const prisma = new PrismaClient({
  datasources: { db: { url: "postgresql://user_service:user_service_dev@127.0.0.1:5554/user_db" } },
});

async function request(endpoint, body, token) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, body: await response.json() };
}

const tokenHash = (token) => createHash("sha256").update(token).digest("hex");

async function readResetToken(email, previousToken) {
  const prefix = `[development email] Password reset link for ${email}: `;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const logs = execFileSync("docker", ["compose", "logs", "--no-color", "user-service"], {
      cwd: serviceDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const line = logs.split(/\r?\n/).filter((entry) => entry.includes(prefix)).at(-1);
    if (line) {
      const link = line.split(prefix)[1].split(" (expires")[0];
      const token = new URL(link).searchParams.get("token");
      if (token && token !== previousToken) return token;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("No new development reset link found in the User Service logs");
}

test("password recovery against Docker User Service and PostgreSQL", async () => {
  const mode = execFileSync("docker", ["compose", "exec", "-T", "user-service", "printenv", "NODE_ENV"], {
    cwd: serviceDirectory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  assert.equal(mode, "development", "Run this only against the local development Compose service");

  const suffix = randomBytes(8).toString("hex");
  const email = `reset_it_${suffix}@u.nus.edu`;
  const originalPassword = "OriginalPass1";
  const newPassword = "ReplacementPass2";
  let userId;

  try {
    const signup = await request("/signup", {
      name: "Password Reset Integration Test", email,
      password: originalPassword, telegramHandle: `reset_it_${suffix}`,
    });
    assert.equal(signup.status, 201);
    userId = signup.body.userId;
    const signupLogs = execFileSync("docker", ["compose", "logs", "--no-color", "user-service"], {
      cwd: serviceDirectory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    const otpPrefix = `[development email] Verification OTP for ${email}: `;
    const otpLine = signupLogs.split(/\r?\n/).find((entry) => entry.includes(otpPrefix));
    assert.ok(otpLine, "Signup must produce a development email OTP");
    const otp = otpLine.split(otpPrefix)[1].slice(0, 6);
    assert.match(otp, /^\d{6}$/);
    const verified = await request("/verify-email", { email, otp });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.status, "Created");
    assert.deepEqual(verified.body.nextSteps, ["VERIFY_TELEGRAM"]);
    const login = await request("/login", { email, password: originalPassword });
    assert.equal(login.status, 200);
    const profile = await request("/me", undefined, login.body.token);
    assert.equal(profile.status, 200);
    assert.equal(profile.body.email, email);
    assert.equal(profile.body.status, "Created");
    console.log("PASS: signup, email OTP verification, login and profile retrieval; Telegram verification is still required");

    const known = await request("/forgot-password", { email });
    const unknown = await request("/forgot-password", { email: `missing_${suffix}@u.nus.edu` });
    assert.equal(known.status, 202);
    assert.deepEqual(unknown, known, "Unknown and registered accounts must get the same response");
    const firstToken = await readResetToken(email);
    const firstRecord = await prisma.passwordResetToken.findUnique({ where: { tokenHash: tokenHash(firstToken) } });
    assert.ok(firstRecord);
    assert.notEqual(firstRecord.tokenHash, firstToken);

    await prisma.passwordResetToken.update({
      where: { id: firstRecord.id }, data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await request("/reset-password", { token: firstToken, newPassword });
    assert.equal(expired.status, 400);
    assert.equal(expired.body.code, "INVALID_RESET_TOKEN");
    console.log("PASS: matching generic responses, hashed token storage, expired-link rejection");

    await request("/forgot-password", { email });
    const secondToken = await readResetToken(email, firstToken);
    await request("/forgot-password", { email });
    const currentToken = await readResetToken(email, secondToken);
    const superseded = await request("/reset-password", { token: secondToken, newPassword });
    assert.equal(superseded.status, 400);
    assert.equal(superseded.body.code, "INVALID_RESET_TOKEN");

    const weak = await request("/reset-password", { token: currentToken, newPassword: "weak" });
    assert.equal(weak.status, 400);
    assert.equal(weak.body.code, "INVALID_PASSWORD");
    const unused = await prisma.passwordResetToken.findUnique({ where: { tokenHash: tokenHash(currentToken) } });
    assert.equal(unused.usedAt, null, "A rejected password must not consume the reset token");

    await prisma.user.update({ where: { id: userId }, data: { lockedAt: new Date(), failedLoginAttempts: 5 } });
    assert.equal((await request("/login", { email, password: originalPassword })).status, 401);
    const reset = await request("/reset-password", { token: currentToken, newPassword });
    assert.equal(reset.status, 200);
    const unlocked = await prisma.user.findUnique({ where: { id: userId } });
    assert.equal(unlocked.lockedAt, null);
    assert.equal(unlocked.failedLoginAttempts, 0);
    assert.equal((await request("/me", undefined, login.body.token)).status, 401);
    assert.equal((await request("/login", { email, password: originalPassword })).status, 401);
    assert.equal((await request("/login", { email, password: newPassword })).status, 200);
    const replay = await request("/reset-password", { token: currentToken, newPassword });
    assert.equal(replay.status, 400);
    assert.equal(replay.body.code, "INVALID_RESET_TOKEN");
    console.log("PASS: old links rejected, password rules enforced, account unlocked, old password/session rejected, link single-use");

    await request("/forgot-password", { email });
    const raceToken = await readResetToken(email, currentToken);
    const race = await Promise.all([
      request("/reset-password", { token: raceToken, newPassword: "ConcurrentPass3" }),
      request("/reset-password", { token: raceToken, newPassword: "ConcurrentPass3" }),
    ]);
    assert.deepEqual(race.map((result) => result.status).sort(), [200, 400]);
    assert.equal(race.find((result) => result.status === 400).body.code, "INVALID_RESET_TOKEN");
    assert.equal((await request("/login", { email, password: "ConcurrentPass3" })).status, 200);
    console.log("PASS: exactly one of two simultaneous reset attempts succeeds");
  } finally {
    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
      assert.equal(await prisma.passwordResetToken.count({ where: { userId } }), 0);
      assert.equal(await prisma.authSession.count({ where: { userId } }), 0);
      console.log("Temporary test account, sessions and reset records removed");
    }
    await prisma.$disconnect();
  }
});
