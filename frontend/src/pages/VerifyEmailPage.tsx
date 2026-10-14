/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the email verification pending page from the mockups.
 * Reviewed by Ngooi Jun Sen.
 *
 * Covers UI FR2.1 to FR2.3 and User Service F1.3.4 (request a new email).
 */

import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Alert } from '../components/ui/Alert';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { TextField } from '../components/ui/TextField';
import { errorMessage } from '../lib/api';
import { formatCountdown, useCountdown } from '../lib/useCountdown';
import { resendVerification, verifyEmail } from '../lib/user';
import styles from './VerifyEmailPage.module.css';

/** UI FR2.2.2: the resend button is disabled for 60 seconds after a send. */
const RESEND_COOLDOWN_MS = 60_000;

export function VerifyEmailPage() {
  const location = useLocation();
  const { user, refresh } = useAuth();
  const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? user?.email ?? '');
  const [otp, setOtp] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Sign-up has just triggered the first email, so the cooldown starts on load.
  const [cooldownEnd, setCooldownEnd] = useState<number>(() => Date.now() + RESEND_COOLDOWN_MS);
  const secondsLeft = useCountdown(cooldownEnd);
  const waiting = secondsLeft > 0;

  const [failure, setFailure] = useState<string | null>(null);

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !/^\d{6}$/.test(otp) || submitting) return;
    setSubmitting(true);
    setFailure(null);
    try {
      await verifyEmail(email.trim(), otp);
      if (user) await refresh();
      setDone(true);
    } catch (error) {
      setFailure(errorMessage(error, 'Could not reach the server. Try again in a moment.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    // Without the address there is nothing to resend to; that only happens
    // when this page is opened directly rather than from sign-up.
    if (!email.trim()) {
      setFailure('Sign up again to get a new verification email.');
      return;
    }
    setFailure(null);
    // Start the cooldown before the call, so a slow response cannot be
    // double-clicked into two emails (UI FR2.2.2).
    setCooldownEnd(Date.now() + RESEND_COOLDOWN_MS);
    try {
      await resendVerification(email.trim());
    } catch (error) {
      setFailure(errorMessage(error, 'Could not reach the server. Try again in a moment.'));
    }
  }

  if (done) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>Your email is verified</h1>
        <p className={styles.body}>Verify your Telegram account to finish setting up your account.</p>
        <Link to={user ? '/verify-telegram' : '/login'} state={{ from: '/verify-telegram' }}>
          <Button>{user ? 'Verify Telegram' : 'Log in to continue'}</Button>
        </Link>
      </div>
    );
  }

  return (
    <form className={styles.page} onSubmit={handleVerify}>
      <span className={styles.iconCircle}>
        <Icon name="mail" size={22} />
      </span>

      <h1 className={styles.title}>Check your NUS email to verify your account</h1>

      <p className={styles.body}>
        Enter the six-digit code sent to your NUS email. If the code expires, request a new one.
      </p>

      <TextField label="NUS email" name="email" type="email" autoComplete="email"
        value={email} onChange={(event) => setEmail(event.target.value)} required />
      <TextField label="Verification code" name="otp" inputMode="numeric" autoComplete="one-time-code"
        maxLength={6} pattern="[0-9]{6}" value={otp}
        onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} required />

      {failure ? <Alert variant="danger">{failure}</Alert> : null}

      <Button type="submit" fullWidth loading={submitting} disabled={!email.trim() || !/^\d{6}$/.test(otp)}>
        Verify email
      </Button>
      <Button type="button" variant="secondary" fullWidth onClick={handleResend} disabled={waiting}>
        {waiting ? `Resend email in ${formatCountdown(secondsLeft)}` : 'Resend email'}
      </Button>

      {/* Screen readers should hear when the button becomes usable again. */}
      <span className="visually-hidden" role="status">
        {waiting ? '' : 'You can resend the verification email now.'}
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
    </form>
  );
}
