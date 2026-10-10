/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the page the verification email links to. No requirement
 *        or mockup covers it; it reuses the pending page's layout.
 * Author review: Ngooi Jun Sen to validate before merge.
 *
 * Posts the link's token to POST /api/v1/user/verify-email (User F1.3.2), which
 * activates the account if the token is still inside its time limit (F1.3.3).
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { errorMessage } from '../lib/api';
import { verifyEmail } from '../lib/user';
import styles from './VerifyEmailPage.module.css';

type State = { kind: 'working' } | { kind: 'done' } | { kind: 'failed'; message: string };

export function VerifyEmailLinkPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [state, setState] = useState<State>(
    token === null
      ? { kind: 'failed', message: 'This verification link is incomplete.' }
      : { kind: 'working' },
  );

  // A token is single use. React's development double-render would otherwise
  // post it twice, and the second post would report a spent token as a failure.
  const sent = useRef(false);

  useEffect(() => {
    if (token === null || sent.current) return;
    sent.current = true;

    verifyEmail(token)
      .then(() => setState({ kind: 'done' }))
      .catch((error: unknown) =>
        setState({
          kind: 'failed',
          message: errorMessage(error, 'Could not reach the server. Reload to try again.'),
        }),
      );
  }, [token]);

  if (state.kind === 'working') {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>Verifying your email…</h1>
      </div>
    );
  }

  if (state.kind === 'failed') {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>We could not verify your email</h1>
        <Alert variant="danger">{state.message}</Alert>
        <p className={styles.body}>
          Links expire after 24 hours. Log in and request a new one, or sign up again if you never
          finished.
        </p>
        <p className={styles.footer}>
          <Link to="/login">Back to log in</Link>
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <span className={styles.iconCircle}>
        <Icon name="check" size={22} />
      </span>
      <h1 className={styles.title}>Your email is verified</h1>
      <p className={styles.body}>Your account is active. Log in to get started.</p>
      <Link to="/login">
        <Button fullWidth>Log in</Button>
      </Link>
    </div>
  );
}
