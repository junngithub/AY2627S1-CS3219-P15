import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { TelegramBotClient } from "./telegram";
import { hashOtp, hashTelegramOtp } from "./security";

describe("Telegram verification security", () => {
  it("refuses development OTP delivery in production without a configured bot", () => {
    execFileSync(process.execPath, ["--import", "tsx", "-e",
      "require('./src/telegram').requestTelegramVerification({}).then(() => process.exit(1)).catch(e => { if (e.status !== 503 || e.code !== 'TELEGRAM_NOT_CONFIGURED') process.exit(1); })",
    ], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "production", OTP_SECRET: "test-production-secret", TELEGRAM_BOT_TOKEN: "", TELEGRAM_BOT_USERNAME: "" },
      timeout: 10_000,
    });
  });
  it("binds a Telegram OTP to its user and separates it from email OTPs", () => {
    const first = hashTelegramOtp("user-a", "123456", "secret");
    assert.notEqual(first, hashTelegramOtp("user-b", "123456", "secret"));
    assert.notEqual(first, hashOtp("user-a", "123456", "secret"));
  });

  it("sends a private message using the Bot API JSON body", async () => {
    const client = new TelegramBotClient("test-bot-secret", async (url, options) => {
      assert.equal(String(url), "https://api.telegram.org/bottest-bot-secret/sendMessage");
      assert.equal(options?.method, "POST");
      assert.deepEqual(JSON.parse(String(options?.body)), { chat_id: 123, text: "Test verification code" });
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    });
    await client.sendMessage(123, "Test verification code");
  });

  it("does not expose the bot token when a network request fails", async () => {
    const client = new TelegramBotClient("test-bot-secret", async () => {
      throw new Error("https://api.telegram.org/bottest-bot-secret/sendMessage failed");
    });
    await assert.rejects(client.sendMessage(123, "message"), { message: "Telegram request failed" });
  });
});
