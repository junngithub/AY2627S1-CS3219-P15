import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { EmailConfiguration } from "./email-config";
import { AppError } from "./errors";

export interface EmailSender {
  sendVerificationOtp(email: string, otp: string, expiresInMinutes: number): Promise<void>;
  sendPasswordResetLink(email: string, link: string, expiresInMinutes: number): Promise<void>;
  sendAccountLocked(email: string, recoveryUrl: string): Promise<void>;
}

export interface SesEmailClient {
  send(command: SendEmailCommand): Promise<unknown>;
}

export class SesEmailSender implements EmailSender {
  constructor(private readonly fromAddress: string, private readonly client: SesEmailClient) {}

  async sendVerificationOtp(email: string, otp: string, expiresInMinutes: number): Promise<void> {
    await this.send(email, "Friends on Campus - Verify your email",
      `Your Friends on Campus verification code is: ${otp}\n\nThis code expires in ${expiresInMinutes} minutes. Do not share it.\nIf you did not register, you can ignore this email.`, "verification");
  }

  async sendPasswordResetLink(email: string, link: string, expiresInMinutes: number): Promise<void> {
    await this.send(email, "Friends on Campus - Reset your password",
      `Reset your Friends on Campus password using this link:\n${link}\n\nThis link expires in ${expiresInMinutes} minutes and can be used once. Do not share it.\nIf you did not request this, you can ignore this email.`, "password-reset");
  }

  async sendAccountLocked(email: string, recoveryUrl: string): Promise<void> {
    await this.send(email, "Friends on Campus - Account locked",
      `Your Friends on Campus account has been locked after repeated failed login attempts.\n\nReset your password to unlock it: ${recoveryUrl}\n\nIf these attempts were not yours, do not share any verification codes or reset links.`, "account-lockout");
  }

  private async send(email: string, subject: string, text: string, kind: string): Promise<void> {
    try {
      await this.client.send(new SendEmailCommand({
        FromEmailAddress: this.fromAddress,
        Destination: { ToAddresses: [email] },
        Content: { Simple: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: { Text: { Data: text, Charset: "UTF-8" } },
        } },
      }));
    } catch (error) {
      // SDK error messages may contain addresses, request content or credentials.
      const name = error instanceof Error ? error.name : "";
      const category = ["AccessDeniedException", "MessageRejected", "MailFromDomainNotVerifiedException",
        "TooManyRequestsException", "CredentialsProviderError", "TimeoutError"].includes(name) ? name : "unavailable";
      console.error(`[user email] SES ${kind} request failed (${category})`);
      throw new AppError(503, "EMAIL_DELIVERY_FAILED", "Unable to send email right now. Please try again.");
    }
    // Acceptance by SES is not proof of inbox delivery. Never log OTPs/reset URLs.
    console.log(`[user email] SES accepted ${kind} email`);
  }
}

class DisabledEmailSender implements EmailSender {
  async sendVerificationOtp(): Promise<void> { this.unavailable(); }
  async sendPasswordResetLink(): Promise<void> { this.unavailable(); }
  async sendAccountLocked(): Promise<void> { this.unavailable(); }
  private unavailable(): never {
    throw new AppError(503, "EMAIL_NOT_CONFIGURED", "Email delivery is not configured.");
  }
}

export function createEmailSender(settings: EmailConfiguration): EmailSender {
  if (settings.provider === "development") return new DevelopmentEmailSender();
  if (settings.provider === "disabled") return new DisabledEmailSender();
  return new SesEmailSender(settings.fromAddress, new SESv2Client({
    region: settings.region,
    // AWS's default credential chain supports temporary credentials, SSO and
    // deployment roles. No credentials or custom endpoint are embedded here.
    maxAttempts: 3,
    requestHandler: { connectionTimeout: 3000, requestTimeout: 10_000, throwOnRequestTimeout: true },
  }));
}

export class DevelopmentEmailSender implements EmailSender {
  async sendAccountLocked(): Promise<void> {
    console.log("[development email] Account-lockout notification requested");
  }

  async sendVerificationOtp(email: string, otp: string, expiresInMinutes: number): Promise<void> {
    console.log(
      `[development email] Verification OTP for ${email}: ${otp} (expires in ${expiresInMinutes} minutes)`,
    );
  }

  async sendPasswordResetLink(email: string, link: string, expiresInMinutes: number): Promise<void> {
    console.log(
      `[development email] Password reset link for ${email}: ${link} (expires in ${expiresInMinutes} minutes)`,
    );
  }
}
