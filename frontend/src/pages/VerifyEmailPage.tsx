/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the email verification pending page from the mockups, then
 *        reworked it to take the six-digit code the User Service sends.
 * Reviewed by Ngooi Jun Sen.
 *
 * Covers UI FR2.1 to FR2.3 and User Service F1.3.2 to F1.3.4 (enter the code,
 * request a new one).
 */

import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { TextField } from '../components/ui/TextField';
import { errorMessage } from '../lib/api';
import { formatCountdown, useCountdown } from '../lib/useCountdown';
import { resendVerification, verifyEmail } from '../lib/user';
import { isNusEmail } from '../lib/validation';
import styles from './VerifyEmailPage.module.css';

/** UI FR2.2.2: the resend button is disabled for 60 seconds after a send. */
const RESEND_COOLDOWN_MS = 60_000;

/** The User Service sends a six-digit code; see user-service/README.md. */
const OTP_PATTERN = /^\d{6}$/;

export function VerifyEmailPage() {
  const location = useLocation();
  const emailFromSignUp = (location.state as { email?: string } | null)?.email ?? null;

  // Opened directly rather than from sign-up, the page has no address, so it
  // asks for one.
  const [emailInput, setEmailInput] = useState('');
  const email = emailFromSignUp ?? emailInput.trim();
  const emailOk = isNusEmail(email);

  const [otp, setOtp] = useState('');
  const otpOk = OTP_PATTERN.test(otp);

  // Sign-up has just triggered the first email, so the cooldown starts on
  // load. Without sign-up, nothing was sent yet and resend is open at once.
  const [cooldownEnd, setCooldownEnd] = useState<number>(() =>
    emailFromSignUp === null ? 0 : Date.now() + RESEND_COOLDOWN_MS,
  );
  const secondsLeft = useCountdown(cooldownEnd);
  const waiting = secondsLeft > 0;

  const [submitting, setSubmitting] = useState(false);
  const [verified, setVerified] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!emailOk || !otpOk || submitting) return;

    setSubmitting(true);
    setFailure(null);
    setNotice(null);
    try {
      await verifyEmail(email, otp);
      setVerified(true);
    } catch (error) {
      setFailure(errorMessage(error, 'Could not reach the server. Try again in a moment.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (!emailOk) {
      setFailure('Enter your NUS email first.');
      return;
    }
    setFailure(null);
    setNotice(null);
    // Start the cooldown before the call, so a slow response cannot be
    // double-clicked into two emails (UI FR2.2.2).
    setCooldownEnd(Date.now() + RESEND_COOLDOWN_MS);
    try {
      await resendVerification(email);
      // A new code revokes the old one, so clear whatever was typed.
      setOtp('');
      setNotice('A new code is on its way. Only the newest code works.');
    } catch (error) {
      setFailure(errorMessage(error, 'Could not reach the server. Try again in a moment.'));
    }
  }

  if (verified) {
    return (
      <div className={styles.page}>
        <span className={styles.iconCircle}>
          <Icon name="check" size={22} />
        </span>
        <h1 className={styles.title}>Your email is verified</h1>
        <p className={styles.body}>Log in to finish setting up your account.</p>
        <Link to="/login" className={styles.fullWidth}>
          <Button fullWidth>Log in</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <span className={styles.iconCircle}>
        <Icon name="mail" size={22} />
      </span>

      <h1 className={styles.title}>Check your NUS email to verify your account</h1>

      <p className={styles.body}>
        We sent a six-digit code to{' '}
        <strong className={styles.email}>{emailFromSignUp ?? 'your NUS email'}</strong>. Enter it
        below &mdash; the code expires in 10 minutes.
      </p>

      {failure ? <Alert variant="danger">{failure}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      <form className={styles.form} onSubmit={handleVerify} noValidate>
        {emailFromSignUp === null ? (
          <TextField
            label="NUS email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={emailInput}
            onChange={(event) => setEmailInput(event.target.value)}
          />
        ) : null}

        <TextField
          label="Verification code"
          name="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="123456"
          value={otp}
          // Pasted codes often carry spaces; keep the digits only.
          onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
        />

        <Button type="submit" fullWidth disabled={!emailOk || !otpOk} loading={submitting}>
          Verify
        </Button>
      </form>

      <Button variant="secondary" fullWidth onClick={handleResend} disabled={waiting}>
        {waiting ? `Resend code in ${formatCountdown(secondsLeft)}` : 'Resend code'}
      </Button>

      {/* Screen readers should hear when the button becomes usable again. */}
      <span className="visually-hidden" role="status">
        {waiting ? '' : 'You can request a new code now.'}
      </span>

      <p className={styles.footer}>
        {/* OPEN: no requirement covers changing the address at this point;
            this returns to sign-up so the form can be filled in again. */}
        Wrong address? <Link to="/signup">Change email</Link>
        <span className={styles.separator} aria-hidden="true">
          {' · '}
        </span>
        <Link to="/login">Back to log in</Link>
      </p>
    </div>
  );
}
