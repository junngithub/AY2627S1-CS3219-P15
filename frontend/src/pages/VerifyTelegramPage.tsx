import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/TextField';
import { errorMessage } from '../lib/api';
import { useCountdown } from '../lib/useCountdown';
import { requestTelegramVerification, verifyTelegram, type AccountStatusResponse } from '../lib/user';
import styles from './VerifyEmailPage.module.css';

export function VerifyTelegramPage() {
  const { user, refresh } = useAuth();
  const [otp, setOtp] = useState('');
  const [botUrl, setBotUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(false);
  const [result, setResult] = useState<AccountStatusResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [cooldownEnd, setCooldownEnd] = useState(0);
  const secondsLeft = useCountdown(cooldownEnd);

  async function handleRequest() {
    setBusy(true);
    setFailure(null);
    try {
      const challenge = await requestTelegramVerification();
      setBotUrl(challenge.telegramBotUrl);
      setRequested(true);
      setCooldownEnd(Date.now() + 60_000);
    } catch (error) {
      setFailure(errorMessage(error, 'Could not request a verification code. Try again shortly.'));
    } finally { setBusy(false); }
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(otp) || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const verified = await verifyTelegram(otp);
      await refresh();
      setResult(verified);
    } catch (error) {
      setFailure(errorMessage(error, 'Could not verify the code. Try again shortly.'));
    } finally { setBusy(false); }
  }

  if (result || user?.status === 'Verified') {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>Telegram verified</h1>
        {result?.nextSteps.includes('VERIFY_EMAIL') ? (
          <><p className={styles.body}>Verify your NUS email to finish setting up your account.</p>
            <Link to="/verify-email" state={{ email: user?.email }}>Verify email</Link></>
        ) : <p className={styles.body}>Your account is verified. You can now post and accept errands.</p>}
        <Link to="/profile">Back to profile</Link>
      </div>
    );
  }

  return (
    <form className={styles.page} onSubmit={handleVerify}>
      <h1 className={styles.title}>Verify your Telegram account</h1>
      <p className={styles.body}>Request a code for {user?.telegramHandle ? `@${user.telegramHandle}` : 'your Telegram handle'}.
        Open the bot link, press Start, then enter the six-digit code here.</p>
      {failure ? <Alert variant="danger">{failure}</Alert> : null}
      <Button type="button" variant="secondary" onClick={handleRequest} disabled={busy || secondsLeft > 0}>
        {secondsLeft > 0 ? `Request again in ${secondsLeft}s` : 'Request verification code'}
      </Button>
      {botUrl ? <a href={botUrl} target="_blank" rel="noreferrer">Open verification bot in Telegram</a> : null}
      {requested ? <p className={styles.body}>Enter your verification code below.</p> : null}
      <TextField label="Telegram verification code" name="otp" inputMode="numeric" autoComplete="one-time-code"
        maxLength={6} pattern="[0-9]{6}" value={otp}
        onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} required />
      <Button type="submit" loading={busy} disabled={!/^\d{6}$/.test(otp)}>Verify Telegram</Button>
      <Link to="/profile">Back to profile</Link>
    </form>
  );
}
