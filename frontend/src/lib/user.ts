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
