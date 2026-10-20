/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the User Service calls the account pages make, one per
 *        endpoint in the API contract's User section.
 * Reviewed by Ngooi Jun Sen.
 */

import { api } from './api';

/** User F1. All four fields are required; the name becomes the fixed display name. */
export async function signUp(body: {
  name: string;
  email: string;
  password: string;
  telegramHandle: string;
}): Promise<void> {
  await api.post('/user/signup', body);
}

/** User F1.3.2: the six-digit code from the verification email. */
export async function verifyEmail(email: string, otp: string): Promise<void> {
  await api.post('/user/verify-email', { email, otp });
}

/** User F1.3.4. */
export async function resendVerification(email: string): Promise<void> {
  await api.post('/user/resend-verification', { email });
}

/** What GET /user/me/status and POST /user/verify-telegram return. */
export interface AccountStatus {
  status: 'Created' | 'Verified' | 'Suspended';
  /** e.g. VERIFY_EMAIL, VERIFY_TELEGRAM, CANCEL_PENDING_DELETION, CONTACT_ADMIN. */
  nextSteps: string[];
}

/** User F6: the signed-in user's status and what is left to do. */
export async function fetchAccountStatus(): Promise<AccountStatus> {
  return api.get<AccountStatus>('/user/me/status');
}

/**
 * User F1.4: starts a Telegram challenge for the signed-in user.
 *
 * - telegramBotUrl set: the user opens it and presses Start; the bot checks
 *   their handle and sends a six-digit code.
 * - telegramBotUrl null, expiresAt set: no bot is configured, so the service
 *   printed the code to its own log (development only).
 * - Both null: Telegram is already verified.
 *
 * 429 TELEGRAM_RESEND_COOLDOWN if asked again within the cooldown, 503
 * TELEGRAM_NOT_CONFIGURED if verification is unavailable.
 */
export async function requestTelegramVerification(): Promise<{
  telegramBotUrl: string | null;
  expiresAt: string | null;
}> {
  return api.post('/user/request-telegram-verification');
}

/**
 * User F1.4.2: confirms the code from the bot. 400 INVALID_OTP for a wrong or
 * expired code, 409 TELEGRAM_ALREADY_REGISTERED if that Telegram account is
 * linked to someone else.
 */
export async function verifyTelegram(otp: string): Promise<AccountStatus> {
  return api.post<AccountStatus>('/user/verify-telegram', { otp });
}

/** User F2.1: sends a time-limited reset link. */
export async function requestPasswordReset(email: string): Promise<void> {
  await api.post('/user/forgot-password', { email });
}

/** User F2.1.1. */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await api.post('/user/reset-password', { token, newPassword });
}

/**
 * User F3.7. The only profile change the contract allows: name and email are
 * immutable (F3.2/F3.5) and have no endpoint, and role, status and user id
 * are never accepted from the client at all.
 */
export async function changePassword(newPassword: string): Promise<void> {
  await api.patch('/user/me/password', { newPassword });
}

/**
 * User F5.1: marks the account for deletion in six months. The explicit
 * confirm flag is part of the contract, so a stray call cannot delete anyone.
 */
export async function deleteAccount(): Promise<void> {
  await api.delete('/user/me', { confirm: true });
}
