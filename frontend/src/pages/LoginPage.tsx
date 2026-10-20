/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the login page from the desktop and mobile mockups.
 * Reviewed by Ngooi Jun Sen.
 *
 * Covers UI FR3.1 to FR3.3. The error message is deliberately generic
 * (UI FR3.2.1, User F2.2) so it cannot be used to discover which addresses
 * have accounts.
 */

import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/TextField';
import styles from './LoginPage.module.css';

/**
 * The only message shown for any failed sign-in, whatever the cause: unknown
 * address, wrong password, or a locked account (User F2.3).
 */
const GENERIC_ERROR = 'Wrong password or user not found';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn } = useAuth();

  // Where the guard sent them from, so they land back there after signing in.
  const from = (location.state as { from?: string } | null)?.from ?? '/browse';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      navigate(from, { replace: true });
    } catch {
      // Every cause looks the same here on purpose: unknown address, wrong
      // password, locked account (User F2.3), or the service being down.
      setError(GENERIC_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <header className={styles.header}>
        <h1 className={styles.title}>
          <span className={styles.titleMobile}>Welcome back</span>
          <span className={styles.titleDesktop}>Log in to FoC</span>
        </h1>
        <p className={styles.subtitle}>Log in to post errands or run them.</p>
      </header>

      {error ? <Alert variant="danger">{error}</Alert> : null}

      <TextField
        label="Email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@u.nus.edu"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        labelAction={
          <Link to="/forgot-password" className={styles.forgot}>
            <span className={styles.forgotShort}>Forgot?</span>
            <span className={styles.forgotLong}>Forgot password?</span>
          </Link>
        }
      />

      <p className={styles.signupPrompt}>
        Don&apos;t have an account? <Link to="/signup">Sign up</Link>
      </p>

      {/* UI FR3.3.2: pinned to the bottom of the viewport on mobile. */}
      <div className={styles.actions}>
        <Button type="submit" fullWidth disabled={!canSubmit} loading={submitting}>
          Log in
        </Button>
      </div>
    </form>
  );
}
