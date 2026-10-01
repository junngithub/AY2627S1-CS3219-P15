/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the request-a-reset-link page from the desktop mockup.
 * Reviewed by Ngooi Jun Sen.
 *
 * Covers UI FR4.1 and User Service F2.1.1 (time-limited link by email).
 */

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/TextField';
import { ApiError } from '../lib/api';
import { requestPasswordReset } from '../lib/user';
import styles from './ForgotPasswordPage.module.css';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [unreachable, setUnreachable] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (email.trim().length === 0 || submitting) return;

    setSubmitting(true);
    setUnreachable(false);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (error) {
      // An answer from the service - even an error such as "no such account" -
      // gets the same message as success, so this form cannot be used to find
      // out who is registered (User F2.2). Only an outage is reported, since
      // then nothing was sent at all.
      if (error instanceof ApiError) {
        setSent(true);
      } else {
        setUnreachable(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <header className={styles.header}>
        <h1 className={styles.title}>Reset your password</h1>
        <p className={styles.subtitle}>
          We&apos;ll email you a reset link. It expires in 24 hours.
        </p>
      </header>

      {/* The response says the same thing whether or not the address has an
          account, so this page cannot be used to discover who is registered
          (the reasoning behind User F2.2).
          COPY TO CONFIRM: this wording is not in the mockups. */}
      {sent ? (
        <Alert variant="success">
          If that address has an account, a reset link is on its way. Check your inbox.
        </Alert>
      ) : null}

      {unreachable ? (
        <Alert variant="danger">Could not reach the server. Try again in a moment.</Alert>
      ) : null}

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

      <Button type="submit" fullWidth disabled={email.trim().length === 0} loading={submitting}>
        Send reset link
      </Button>

      <p className={styles.footer}>
        <Link to="/login">Back to log in</Link>
      </p>
    </form>
  );
}
