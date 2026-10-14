/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the client-side sign-up validation rules (pure functions).
 * Reviewed by Ngooi Jun Sen.
 *
 * These mirror User Service F1.1 and F1.2. The server still validates
 * everything; this only drives the inline feedback (UI FR1.2, NFR3.1.1).
 */

/**
 * Domains accepted at sign-up (User F1.1.1).
 * Both student and staff email domains are accepted by User Service.
 */
export const ALLOWED_EMAIL_DOMAINS = ['u.nus.edu', 'nus.edu.sg'];

export interface PasswordRule {
  id: 'case' | 'number' | 'length';
  label: string;
  passed: boolean;
}

export function isValidName(name: string): boolean {
  return name.trim().length >= 2 && name.trim().length <= 100;
}

export function isNusEmail(email: string): boolean {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || trimmed.indexOf('@') !== at) return false;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  return local.length > 0 && ALLOWED_EMAIL_DOMAINS.includes(domain);
}

/**
 * Telegram handles are 5 to 32 characters of letters, digits and underscores.
 * The leading "@" is shown as a prefix in the field, so it is not part of the value.
 */
export function isValidTelegramHandle(handle: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(handle.trim().replace(/^@/, ''));
}

/** User F1.2: upper and lower case, a digit, at least 10 characters. */
export function checkPasswordRules(password: string): PasswordRule[] {
  return [
    {
      id: 'case',
      label: 'Upper & lowercase',
      passed: /[a-z]/.test(password) && /[A-Z]/.test(password),
    },
    { id: 'number', label: 'A number', passed: /[0-9]/.test(password) },
    { id: 'length', label: '10+ characters', passed: password.length >= 10 },
  ];
}

export function isValidPassword(password: string): boolean {
  return checkPasswordRules(password).every((rule) => rule.passed);
}

/** 0 to 3: how many password rules are met, used for the strength bar. */
export function passwordStrength(password: string): number {
  return checkPasswordRules(password).filter((rule) => rule.passed).length;
}
