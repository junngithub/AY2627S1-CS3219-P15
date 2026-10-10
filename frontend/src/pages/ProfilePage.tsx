/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the profile page from the mockup.
 * Reviewed by Ngooi Jun Sen.
 *
 * Covers UI FR12.1.1 (name, email, credit balance), FR12.1.2 (change
 * password, through PATCH /api/v1/user/me/password), User F5.1 (delete
 * account, through DELETE /api/v1/user/me), FR12.3.1 (two columns on
 * desktop, account and credits left) and FR12.3.2 (one stacked column on
 * mobile).
 *
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { ConfirmDialog, Dialog } from '../components/ui/Dialog';
import { Icon } from '../components/ui/Icon';
import { PasswordRules } from '../components/ui/PasswordRules';
import { TextField } from '../components/ui/TextField';
import { errorMessage } from '../lib/api';
import { changePassword, deleteAccount } from '../lib/user';
import { checkPasswordRules, isValidPassword } from '../lib/validation';
import styles from './ProfilePage.module.css';

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function ProfilePage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const [changingPassword, setChangingPassword] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setFailure(null);
    setNotice(null);
    try {
      await deleteAccount();
      setConfirmingDelete(false);
      await signOut();
      navigate('/login', { replace: true });
    } catch (error) {
      // The service's reason is shown as given - for example refusing the
      // last admin (D2 Part 1 point 6) - rather than a generic failure.
      setConfirmingDelete(false);
      setFailure(errorMessage(error, 'Could not reach the server. Try again in a moment.'));
    } finally {
      setDeleting(false);
    }
  }

  if (user === null) return null;

  return (
    <div className={styles.page}>
      <div className={styles.columns}>
        <div className={styles.column}>
          <section className={styles.card}>
            <div className={styles.identity}>
              <span className={styles.avatar} aria-hidden="true">
                {initials(user.name)}
              </span>
              <div className={styles.identityText}>
                <h1 className={styles.name}>{user.name}</h1>
                <p className={styles.email}>
                  {user.email}
                  {user.status === 'Verified' ? (
                    <span className={styles.verified}>
                      <Icon name="check" size={14} />
                      Verified
                    </span>
                  ) : (
                    <span className={styles.unverified}>{user.status}</span>
                  )}
                </p>
              </div>
            </div>

            <div className={styles.divider} />

            {/*
              D2 Part 1 point 5: there is no form for name or email because
              the contract has no endpoint for either (User F3.2/F3.5), and
              role, status and user id are never sent from the client. The
              server enforces that; this line only says so.
            */}
            <p className={styles.rowNote}>
              Your name and email are fixed once your account is created.
            </p>

            <div className={styles.divider} />

            {notice ? <Alert variant="success">{notice}</Alert> : null}
            {failure ? <Alert variant="danger">{failure}</Alert> : null}

            <div className={styles.passwordRow}>
              <div>
                <p className={styles.rowLabel}>Password</p>
                {/*
                  The mockup shows "Last changed 3 months ago". Nothing
                  returns that: the contract's /user/me is name, email and
                  status. Left out rather than invented.
                */}
                <p className={styles.rowNote}>Change it whenever you like</p>
              </div>
              <Button variant="secondary" onClick={() => setChangingPassword(true)}>
                Change password
              </Button>
            </div>

            <div className={styles.divider} />

            <div className={styles.passwordRow}>
              <div>
                <p className={styles.rowLabel}>Delete account</p>
                <p className={styles.rowNote}>Removed for good after six months</p>
              </div>
              <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
                Delete
              </Button>
            </div>
          </section>

          {/* TODO(credit): FR12.1.1's balance and GET /api/v1/credit/me/ledger
              history, once the Credit Service exists. */}
          <section className={styles.card}>
            <div className={styles.soonHead}>
              <h2 className={styles.cardTitle}>Credit balance</h2>
              <span className={styles.soonTag}>Coming soon</span>
            </div>
            <p className={styles.soonBody}>
              Credits available and reserved, and how they were earned and spent. Waiting on the
              Credit Service.
            </p>
          </section>
        </div>

        <div className={styles.column}>
          <section className={styles.card}>
            <div className={styles.soonHead}>
              <h2 className={styles.cardTitle}>Ratings</h2>
              <span className={styles.soonTag}>Coming soon</span>
            </div>
            <p className={styles.soonBody}>
              Your average as a courier and as a requester, with the count behind each. Waiting on
              the Rating Service.
            </p>
          </section>

          <section className={styles.card}>
            <div className={styles.soonHead}>
              <h2 className={styles.cardTitle}>Badges</h2>
              <span className={styles.soonTag}>Coming soon</span>
            </div>
            <p className={styles.soonBody}>
              Earned badges, and what is left to unlock the rest. Waiting on the Badges Service,
              which needs order and rating counts that no endpoint provides yet.
            </p>
          </section>
        </div>
      </div>

      <ChangePasswordDialog
        open={changingPassword}
        onClose={() => setChangingPassword(false)}
        onChanged={() => {
          setChangingPassword(false);
          setFailure(null);
          setNotice('Password changed.');
        }}
      />

      {/* NFR9.1.1: irreversible actions ask first. */}
      <ConfirmDialog
        open={confirmingDelete}
        title="Delete your account?"
        consequence={
          <>
            Your account is marked for deletion and removed for good after six months.
            You are signed out now. If you are the only admin, the service may refuse, since
            nobody would be left to run the platform.
          </>
        }
        confirmLabel="Delete account"
        destructive
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  );
}

/**
 * User F3.7. Same rules and strength indicator as sign-up (User F1.2), so a
 * password that sign-up would refuse cannot be set here either.
 */
function ChangePasswordDialog({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const rules = checkPasswordRules(password);
  const confirmOk = confirmPassword.length > 0 && confirmPassword === password;
  const canSave = isValidPassword(password) && confirmOk && !saving;

  function close() {
    setPassword('');
    setConfirmPassword('');
    setFailure(null);
    onClose();
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setFailure(null);
    try {
      await changePassword(password);
      setPassword('');
      setConfirmPassword('');
      onChanged();
    } catch (error) {
      setFailure(errorMessage(error, 'Could not reach the server. Try again in a moment.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="Change password"
      onClose={saving ? () => undefined : close}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button disabled={!canSave} loading={saving} onClick={save}>
            Save password
          </Button>
        </>
      }
    >
      {failure ? <Alert variant="danger">{failure}</Alert> : null}
      <TextField
        label="New password"
        name="newPassword"
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
        error={confirmPassword.length > 0 && !confirmOk ? 'Passwords do not match' : null}
      />
    </Dialog>
  );
}
