/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the sign-up page from the desktop and mobile mockups.
 * Reviewed by Ngooi Jun Sen.
 *
 * Covers UI FR1.1 to FR1.4. Mirrors User Service F1.1 and F1.2 client-side;
 * the server validates again.
 */

import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { PasswordRules } from '../components/ui/PasswordRules';
import { TextField } from '../components/ui/TextField';
import { errorMessage } from '../lib/api';
import { signUp } from '../lib/user';
import {
  checkPasswordRules,
  isNusEmail,
  isValidName,
  isValidPassword,
  isValidTelegramHandle,
} from '../lib/validation';
import styles from './SignUpPage.module.css';

export function SignUpPage() {
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [telegram, setTelegram] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // A field only shows feedback once the user has typed in it, so the form
  // does not open covered in red.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const markTouched = (field: string) => setTouched((prev) => ({ ...prev, [field]: true }));
  const show = (field: string, value: string) => touched[field] && value.length > 0;

  const passwordRules = checkPasswordRules(password);
  const nameOk = isValidName(name);
  const emailOk = isNusEmail(email);
  const telegramOk = isValidTelegramHandle(telegram);
  const passwordOk = isValidPassword(password);
  const confirmOk = confirmPassword.length > 0 && confirmPassword === password;

  // UI FR1.2.3: submit stays disabled until every field is valid.
  const formValid = nameOk && emailOk && telegramOk && passwordOk && confirmOk;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formValid || submitting) return;

    setSubmitting(true);
    setFailure(null);
    try {
      // The name is not sent: the contract's signup body has no field for it.
      await signUp({ email: email.trim(), password, telegramHandle: telegram });
      // UI FR2: on success the user lands on the verification-pending page.
      navigate('/verify-email', { state: { email: email.trim() } });
    } catch (error) {
      // User F1.1/F1.2 validate again on the server; show its reason, such as
      // an address already registered, rather than a generic failure.
      setFailure(errorMessage(error, 'Could not reach the server. Try again in a moment.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <header className={styles.header}>
        <h1 className={styles.title}>Create your account</h1>
        <p className={styles.subtitle}>
          NUS email required &mdash; we verify before you can post errands.
        </p>
      </header>

      {failure ? <Alert variant="danger">{failure}</Alert> : null}

      <TextField
        label="Name"
        name="name"
        autoComplete="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => markTouched('name')}
        error={show('name', name) && !nameOk ? 'Enter your full name' : null}
        success={show('name', name) && nameOk ? 'Looks good' : null}
      />

      <TextField
        label="NUS email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        onBlur={() => markTouched('email')}
        error={show('email', email) && !emailOk ? 'Use your @u.nus.edu address' : null}
        success={show('email', email) && emailOk ? 'Valid NUS email' : null}
      />

      <TextField
        label="Telegram handle"
        name="telegram"
        autoComplete="off"
        prefix="@"
        placeholder="yourhandle"
        value={telegram}
        onChange={(event) => setTelegram(event.target.value.replace(/^@/, ''))}
        onBlur={() => markTouched('telegram')}
        error={
          show('telegram', telegram) && !telegramOk
            ? 'Handles are 5 to 32 letters, numbers or underscores'
            : null
        }
        hint="Couriers and requesters use this to coordinate handovers."
      />

      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        onBlur={() => markTouched('password')}
      >
        {password.length > 0 ? <PasswordRules rules={passwordRules} /> : null}
      </TextField>

      <TextField
        label="Confirm password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        placeholder="Re-enter password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        onBlur={() => markTouched('confirmPassword')}
        error={
          show('confirmPassword', confirmPassword) && !confirmOk ? 'Passwords do not match' : null
        }
        success={show('confirmPassword', confirmPassword) && confirmOk ? 'Passwords match' : null}
      />

      <p className={styles.loginPrompt}>
        Already have an account? <Link to="/login">Log in</Link>
      </p>

      {/* UI FR1.4.3: sticky at the bottom of the viewport on mobile. */}
      <div className={styles.actions}>
        <Button type="submit" fullWidth disabled={!formValid} loading={submitting}>
          Sign up
        </Button>
      </div>
    </form>
  );
}
