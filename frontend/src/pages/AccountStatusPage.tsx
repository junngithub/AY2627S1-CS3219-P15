import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Alert } from '../components/ui/Alert';
import { errorMessage } from '../lib/api';
import { getAccountStatus, type AccountStatusResponse } from '../lib/user';
import styles from './VerifyEmailPage.module.css';

export function AccountStatusPage() {
  const { user } = useAuth();
  const [account, setAccount] = useState<AccountStatusResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void getAccountStatus().then((result) => { if (active) setAccount(result); }).catch((error: unknown) => {
      if (active) setFailure(errorMessage(error, 'Could not load account status. Try again shortly.'));
    });
    return () => { active = false; };
  }, []);
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Account status</h1>
      {failure ? <Alert variant="danger">{failure}</Alert> : null}
      {account ? <>
        <p className={styles.body}>{account.status}</p>
        {account.nextSteps.includes('VERIFY_EMAIL') ? <Link to="/verify-email" state={{ email: user?.email }}>Verify NUS email</Link> : null}
        {account.nextSteps.includes('VERIFY_TELEGRAM') ? <Link to="/verify-telegram">Verify Telegram</Link> : null}
        {account.nextSteps.includes('CONTACT_ADMIN') ? <p className={styles.body}>Contact an administrator about your account.</p> : null}
        {account.nextSteps.includes('CANCEL_PENDING_DELETION') ? <p className={styles.body}>Log in again to cancel your pending account deletion.</p> : null}
        {account.nextSteps.length === 0 ? <p className={styles.body}>No verification steps remain.</p> : null}
      </> : !failure ? <p className={styles.body}>Loading status...</p> : null}
      <Link to="/profile">Back to profile</Link>
    </div>
  );
}
