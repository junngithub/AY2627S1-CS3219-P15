export interface EmailSender {
  sendVerificationOtp(email: string, otp: string, expiresInMinutes: number): Promise<void>;
  sendPasswordResetLink(email: string, link: string, expiresInMinutes: number): Promise<void>;
}

export class DevelopmentEmailSender implements EmailSender {
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
