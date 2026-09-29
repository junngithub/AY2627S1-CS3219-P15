/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the set-a-new-password page from the mobile mockup.
 * Reviewed by Ngooi Jun Sen.
 *
 * Covers UI FR4.2, including FR4.2.2: the same rules and strength indicator
 * as sign-up (User F1.2).
 */

import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { PasswordRules } from '../components/ui/PasswordRules';
import { TextField } from '../components/ui/TextField';
import { checkPasswordRules, isValidPassword } from '../lib/validation';
import styles from './ResetPasswordPage.module.css';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // The link in the email carries the token (User F2.1.1).
  const token = searchParams.get('token');
  // TODO(user-service): the address should come from validating the token, not
  // from the query string, so it cannot be spoofed in the URL.
  const email = searchParams.get('email');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const rules = checkPasswordRules(password);
  const passwordOk = isValidPassword(password);
  const confirmOk = confirmPassword.length > 0 && confirmPassword === password;
  const canSubmit = passwordOk && confirmOk;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    try {
      // TODO(user-service): submit the token and new password, then send the
      // user to login. User F2.3 also unlocks a locked account at this point.
      navigate('/login');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <header className={styles.header}>
        <h1 className={styles.title}>Set a new password</h1>
        {email ? <p className={styles.subtitle}>For {email}</p> : null}
      </header>

      {token === null ? (
        <Alert variant="danger">
          This reset link is missing or invalid. Request a new one from the log-in page.
        </Alert>
      ) : null}

      <TextField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      >
        {password.length > 0 ? <PasswordRules rules={rules} /> : null}
      </TextField>

      <TextField
        label="Confirm new password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        onBlur={() => setConfirmTouched(true)}
        error={confirmTouched && confirmPassword.length > 0 && !confirmOk ? 'Passwords do not match' : null}
        success={confirmTouched && confirmOk ? 'Passwords match' : null}
      />

      {/* UI FR20.2.1: pinned to the bottom of the viewport on mobile. */}
      <div className={styles.actions}>
        <Button type="submit" fullWidth disabled={!canSubmit} loading={submitting}>
          Save password
        </Button>
      </div>
    </form>
  );
}
