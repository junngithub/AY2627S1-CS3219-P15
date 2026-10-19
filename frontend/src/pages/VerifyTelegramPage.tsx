/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5)
 * Scope: Generated the Telegram verification step that follows email
 *        verification, against User Service's request-telegram-verification
 *        and verify-telegram endpoints.
 * Reviewed by Ngooi Jun Sen.
 *
 * Covers User Service F1.4 (link the Telegram handle with a code from the
 * bot) and F1.5 (the account is Verified only once email and Telegram both
 * are, which is when Credit grants the starting credits). No mockup exists,
 * so it follows the email verification page.
 *
 * Both endpoints need a signed-in session, so this page sits behind
 * RequireAuth: the user verifies their email, logs in, and lands here.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { TextField } from '../components/ui/TextField';
import { ApiError, errorMessage } from '../lib/api';
import { formatCountdown, useCountdown } from '../lib/useCountdown';
import { fetchAccountStatus, requestTelegramVerification, verifyTelegram } from '../lib/user';
// Same centered layout as the email step, so the two read as one flow.
import styles from './VerifyEmailPage.module.css';

/** User Service's TELEGRAM_RESEND_COOLDOWN_SECONDS default. */
const RESEND_COOLDOWN_MS = 60_000;

const OTP_PATTERN = /^\d{6}$/;

const UNREACHABLE = 'Could not reach the server. Try again in a moment.';

/**
 * Where the code comes from after a request:
 * - bot: the user opens the bot link and the bot sends the code.
 * - logs: no bot is configured, so the code is in User Service's log.
 */
type Delivery = { kind: 'bot'; url: string } | { kind: 'logs' };

export function VerifyTelegramPage() {
  const { user, refresh, signOut } = useAuth();

  // Email still to do? Telegram can be linked first, but the account stays
  // Created until both are done, so say so up front.
  const [emailPending, setEmailPending] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchAccountStatus()
      .then((result) => {
        if (!cancelled) setEmailPending(result.nextSteps.includes('VERIFY_EMAIL'));
      })
      .catch(() => {
        // Only drives a hint; the page works without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [delivery, setDelivery] = useState<Delivery | null>(null);
  // Shown once a code has been asked for, including when the ask hit the
  // cooldown: an earlier code may still be valid.
  const [askedForCode, setAskedForCode] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [cooldownEnd, setCooldownEnd] = useState(0);
  const secondsLeft = useCountdown(cooldownEnd);
  const waiting = secondsLeft > 0;

  const [otp, setOtp] = useState('');
  const otpOk = OTP_PATTERN.test(otp);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<'Verified' | 'Created' | null>(null);

  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleRequest() {
    if (requesting || waiting) return;
    setRequesting(true);
    setFailure(null);
    setNotice(null);
    // Start the cooldown before the call so a double click cannot send two.
    setCooldownEnd(Date.now() + RESEND_COOLDOWN_MS);
    try {
      const result = await requestTelegramVerification();
      if (result.telegramBotUrl === null && result.expiresAt === null) {
        // Already linked, e.g. in another tab. Pick up the new status.
        await refresh();
        setDone('Verified');
        return;
      }
      setDelivery(
        result.telegramBotUrl !== null ? { kind: 'bot', url: result.telegramBotUrl } : { kind: 'logs' },
      );
      setAskedForCode(true);
      // A new challenge revokes the old code.
      setOtp('');
      if (askedForCode) setNotice('New code requested. Only the newest code works.');
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        setAskedForCode(true);
        setFailure('A code was requested less than a minute ago. Use that one, or wait to ask again.');
      } else if (error instanceof ApiError && error.status === 503) {
        setCooldownEnd(0);
        setFailure('Telegram verification is unavailable right now. Try again later.');
      } else {
        setCooldownEnd(0);
        setFailure(errorMessage(error, UNREACHABLE));
      }
    } finally {
      setRequesting(false);
    }
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!otpOk || submitting) return;
    setSubmitting(true);
    setFailure(null);
    setNotice(null);
    try {
      const result = await verifyTelegram(otp);
      // The guard and nav read the status from the session, so reload it.
      await refresh();
      setDone(result.status === 'Verified' ? 'Verified' : 'Created');
    } catch (error) {
      setFailure(errorMessage(error, UNREACHABLE));
    } finally {
      setSubmitting(false);
    }
  }

  if (user === null) {
    return null;
  }

  // Nothing to do here once verified, e.g. opening this URL later.
  if (user.status === 'Verified' && done === null) {
    return <Navigate to="/browse" replace />;
  }

  if (done !== null) {
    return (
      <div className={styles.page}>
        <span className={styles.iconCircle}>
          <Icon name="check" size={22} />
        </span>
        <h1 className={styles.title}>Telegram linked</h1>
        {done === 'Verified' ? (
          <>
            <p className={styles.body}>
              Your account is verified. Your starting credits are on their way and will show in the
              top bar within a few seconds.
            </p>
            <Link to="/browse" className={styles.fullWidth}>
              <Button fullWidth>Start browsing</Button>
            </Link>
          </>
        ) : (
          <>
            <p className={styles.body}>
              One step left: verify your NUS email. Your account unlocks once both are done.
            </p>
            <Link to="/verify-email" state={{ email: user.email }} className={styles.fullWidth}>
              <Button fullWidth>Verify email</Button>
            </Link>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <span className={styles.iconCircle}>
        <Icon name="mail" size={22} />
      </span>

      <h1 className={styles.title}>Link your Telegram account</h1>

      <p className={styles.body}>
        Last step. Couriers and requesters reach each other on Telegram, so we check that{' '}
        <strong className={styles.email}>@{user.telegramHandle}</strong> is yours. Our bot sends
        you a six-digit code.
      </p>

      {emailPending ? (
        <Alert variant="warning">
          Your email is not verified yet either.{' '}
          <Link to="/verify-email" state={{ email: user.email }}>
            Verify email
          </Link>
        </Alert>
      ) : null}

      {failure ? <Alert variant="danger">{failure}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      {delivery?.kind === 'bot' ? (
        <>
          <p className={styles.body}>
            Open the bot and press <strong>Start</strong>. It checks your handle and replies with
            your code.
          </p>
          <a
            href={delivery.url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.fullWidth}
          >
            <Button fullWidth tabIndex={-1}>
              Open Telegram
            </Button>
          </a>
        </>
      ) : null}

      {delivery?.kind === 'logs' ? (
        <Alert variant="warning">
          No Telegram bot is connected in this environment, so the code was written to the User
          Service log instead.
        </Alert>
      ) : null}

      {askedForCode ? (
        <form className={styles.form} onSubmit={handleVerify} noValidate>
          <TextField
            label="Code from Telegram"
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            value={otp}
            // Pasted codes often carry spaces; keep the digits only.
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <Button type="submit" fullWidth disabled={!otpOk} loading={submitting}>
            Verify
          </Button>
        </form>
      ) : null}

      <Button
        variant={askedForCode ? 'secondary' : 'primary'}
        fullWidth
        onClick={handleRequest}
        disabled={waiting}
        loading={requesting}
      >
        {waiting
          ? `Get a new code in ${formatCountdown(secondsLeft)}`
          : askedForCode
            ? 'Get a new code'
            : 'Get my code'}
      </Button>

      {/* Screen readers should hear when the button becomes usable again. */}
      <span className="visually-hidden" role="status">
        {askedForCode && !waiting ? 'You can request a new code now.' : ''}
      </span>

      <p className={styles.footer}>
        Not you?{' '}
        <button type="button" className={styles.linkButton} onClick={() => void signOut()}>
          Log out
        </button>
      </p>
    </div>
  );
}
