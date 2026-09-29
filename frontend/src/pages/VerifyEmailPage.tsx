/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the email verification pending page from the mockups.
 * Reviewed by Ngooi Jun Sen.
 *
 * Covers UI FR2.1 to FR2.3 and User Service F1.3.4 (request a new email).
 */

import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { formatCountdown, useCountdown } from '../lib/useCountdown';
import styles from './VerifyEmailPage.module.css';

/** UI FR2.2.2: the resend button is disabled for 60 seconds after a send. */
const RESEND_COOLDOWN_MS = 60_000;

export function VerifyEmailPage() {
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email ?? null;

  // Sign-up has just triggered the first email, so the cooldown starts on load.
  const [cooldownEnd, setCooldownEnd] = useState<number>(() => Date.now() + RESEND_COOLDOWN_MS);
  const secondsLeft = useCountdown(cooldownEnd);
  const waiting = secondsLeft > 0;

  function handleResend() {
    // TODO(user-service): call the resend endpoint (User F1.3.4).
    setCooldownEnd(Date.now() + RESEND_COOLDOWN_MS);
  }

  return (
    <div className={styles.page}>
      <span className={styles.iconCircle}>
        <Icon name="mail" size={22} />
      </span>

      <h1 className={styles.title}>Check your NUS email to verify your account</h1>

      <p className={styles.body}>
        We sent a link to <strong className={styles.email}>{email ?? 'your NUS email'}</strong>. Open
        it to activate your account &mdash; the link expires in 24 hours.
      </p>

      <Button variant="secondary" fullWidth onClick={handleResend} disabled={waiting}>
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
    </div>
  );
}
