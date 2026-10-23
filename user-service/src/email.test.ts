import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { readEmailConfiguration } from "./email-config";
import { createEmailSender, DevelopmentEmailSender, SesEmailSender } from "./email";
import { AppError } from "./errors";

describe("email configuration", () => {
  it("preserves development/test logging and disables delivery by default elsewhere", () => {
    for (const NODE_ENV of [undefined, "development", "test"]) {
      assert.deepEqual(readEmailConfiguration({ NODE_ENV }), { provider: "development" });
    }
    for (const NODE_ENV of ["production", "staging", "unexpected"]) {
      assert.deepEqual(readEmailConfiguration({ NODE_ENV }), { provider: "disabled" });
    }
  });
  it("refuses development logging outside development/test, even with APP_ENV=local", () => {
    for (const NODE_ENV of ["production", "staging", "unexpected"]) {
      assert.throws(() => readEmailConfiguration({ NODE_ENV, APP_ENV: "local", EMAIL_PROVIDER: "development" }));
    }
  });
  it("validates SES settings and allows a verified Gmail sender independently of NUS recipients", () => {
    assert.deepEqual(readEmailConfiguration({ EMAIL_PROVIDER: "ses", AWS_REGION: " ap-southeast-1 ", SES_FROM_EMAIL: " foc.sender@gmail.com " }),
      { provider: "ses", region: "ap-southeast-1", fromAddress: "foc.sender@gmail.com" });
    for (const env of [
      { EMAIL_PROVIDER: "unknown" }, { EMAIL_PROVIDER: "ses" },
      { EMAIL_PROVIDER: "ses", AWS_REGION: "invalid", SES_FROM_EMAIL: "sender@example.com" },
      { EMAIL_PROVIDER: "ses", AWS_REGION: "ap-southeast-1" },
    ]) assert.throws(() => readEmailConfiguration(env));
  });
  it("rejects display names, multiple senders and header injection without echoing the value", () => {
    for (const SES_FROM_EMAIL of ["Name <sender@example.com>", "a@example.com,b@example.com", "a@example.com\r\nBcc: b@example.com", "not-an-email"]) {
      assert.throws(() => readEmailConfiguration({ EMAIL_PROVIDER: "ses", AWS_REGION: "ap-southeast-1", SES_FROM_EMAIL }),
        (error: unknown) => error instanceof Error && !error.message.includes(SES_FROM_EMAIL));
    }
  });
  it("constructs the selected sender without making an AWS request", async () => {
    assert.ok(createEmailSender({ provider: "development" }) instanceof DevelopmentEmailSender);
    assert.ok(createEmailSender({ provider: "ses", region: "ap-southeast-1", fromAddress: "sender@example.com" }) instanceof SesEmailSender);
    const disabled = createEmailSender({ provider: "disabled" });
    for (const call of [() => disabled.sendVerificationOtp("recipient@example.com", "123456", 10),
      () => disabled.sendPasswordResetLink("recipient@example.com", "https://example.com/reset-password?token=secret", 30),
      () => disabled.sendAccountLocked("recipient@example.com", "https://example.com/forgot-password")]) {
      await assert.rejects(call, (error: unknown) => error instanceof AppError && error.status === 503 && error.code === "EMAIL_NOT_CONFIGURED");
    }
  });
});

describe("SES email delivery without real emails", () => {
  it("sends single-recipient UTF-8 verification, reset and lockout emails without logging their secrets", async (context) => {
    const logs: unknown[][] = [];
    context.mock.method(console, "log", (...args: unknown[]) => { logs.push(args); });
    const commands: SendEmailCommand[] = [];
    const sender = new SesEmailSender("sender@gmail.com", { send: async (command) => { commands.push(command); return { MessageId: "test-message" }; } });
    const link = "https://example.com/reset-password?token=private-reset-token";
    await sender.sendVerificationOtp("student@u.nus.edu", "123456", 10);
    await sender.sendPasswordResetLink("student@u.nus.edu", link, 30);
    await sender.sendAccountLocked("student@u.nus.edu", "https://example.com/forgot-password");
    assert.equal(commands.length, 3);
    for (const command of commands) {
      assert.ok(command instanceof SendEmailCommand);
      assert.equal(command.input.FromEmailAddress, "sender@gmail.com");
      assert.deepEqual(command.input.Destination, { ToAddresses: ["student@u.nus.edu"] });
      assert.equal(command.input.Content?.Simple?.Subject?.Charset, "UTF-8");
      assert.equal(command.input.Content?.Simple?.Body?.Text?.Charset, "UTF-8");
    }
    assert.match(commands[0].input.Content!.Simple!.Body!.Text!.Data!, /123456[\s\S]*10 minutes/);
    assert.match(commands[1].input.Content!.Simple!.Body!.Text!.Data!, /private-reset-token[\s\S]*30 minutes/);
    assert.match(commands[2].input.Content!.Simple!.Body!.Text!.Data!, /locked[\s\S]*https:\/\/example.com\/forgot-password/);
    assert.ok(!commands[2].input.Content!.Simple!.Body!.Text!.Data!.includes("private-reset-token"));
    const output = JSON.stringify(logs);
    for (const secret of ["123456", link, "student@u.nus.edu", "sender@gmail.com"]) assert.ok(!output.includes(secret));
    assert.match(output, /SES accepted/);
  });
  it("sanitizes SES rejection, throttling, expired credentials and network errors without logger fallback", async (context) => {
    const logs: unknown[][] = [];
    context.mock.method(console, "log", (...args: unknown[]) => { logs.push(args); });
    context.mock.method(console, "error", (...args: unknown[]) => { logs.push(args); });
    for (const name of ["MessageRejected", "AccessDeniedException", "TooManyRequestsException", "ExpiredTokenException", "CredentialsProviderError", "TimeoutError", "secret-in-error-name"]) {
      const failure = new Error("raw-secret-and-OTP-123456");
      failure.name = name;
      const sender = new SesEmailSender("sender@example.com", { send: async () => { throw failure; } });
      for (const call of [() => sender.sendVerificationOtp("recipient@example.com", "123456", 10),
        () => sender.sendPasswordResetLink("recipient@example.com", "https://example.com/?token=reset-secret", 30),
        () => sender.sendAccountLocked("recipient@example.com", "https://example.com/forgot-password")]) {
        await assert.rejects(call, (error: unknown) => error instanceof AppError && error.status === 503
          && error.code === "EMAIL_DELIVERY_FAILED" && !error.message.includes("raw-secret"));
      }
    }
    const output = JSON.stringify(logs);
    for (const secret of ["raw-secret", "123456", "reset-secret", "secret-in-error-name", "[development email]", "SES accepted"]) assert.ok(!output.includes(secret));
  });
  it("serializes and signs a real SDK request using only a fake in-memory HTTP handler", async (context) => {
    context.mock.method(console, "log", () => undefined);
    let requestBody = "";
    let hostname = "";
    const client = new SESv2Client({ region: "ap-southeast-1", maxAttempts: 1,
      credentials: { accessKeyId: "TEST_ONLY_NOT_A_REAL_KEY", secretAccessKey: "test-only-not-a-real-secret" },
      requestHandler: { handle: async (request: { hostname: string; body?: unknown; headers: Record<string, string> }) => {
        hostname = request.hostname;
        requestBody = String(request.body);
        assert.ok(request.headers.authorization);
        return { response: { statusCode: 200, headers: { "content-type": "application/json" }, body: Buffer.from('{"MessageId":"fake-message"}') } };
      } },
    });
    try {
      await new SesEmailSender("sender@gmail.com", client).sendVerificationOtp("student@u.nus.edu", "654321", 10);
      assert.equal(hostname, "email.ap-southeast-1.amazonaws.com");
      assert.equal(JSON.parse(requestBody).FromEmailAddress, "sender@gmail.com");
      assert.match(requestBody, /654321/);
    } finally { client.destroy(); }
  });
});
