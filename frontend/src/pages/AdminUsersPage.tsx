/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the user management page from the mockup.
 * Reviewed by Ngooi Jun Sen, removed unnecessary column for user roles.
 *
 * Covers UI FR17.1.1 (search, with role and status shown), FR17.1.2 (suspend
 * and promote), FR17.1.3 (the adjust-credits modal with balance, amount and
 * reason) and NFR11.1.2 (the table scrolls in its own box on a narrow
 * screen). Every action is inert: the Admin Service is unwritten.
 */

import { useMemo, useState } from 'react';
import { Button } from '../components/ui/Button';
import { ConfirmDialog, Dialog } from '../components/ui/Dialog';
import { Field } from '../components/ui/Field';
import { Icon } from '../components/ui/Icon';
import { TextField } from '../components/ui/TextField';
import { TextAreaField } from '../components/ui/Inputs';
import { type AdminUser } from '../lib/adminUsers';
import { SAMPLE_ADMIN_USERS, SAMPLE_USER_TOTALS } from '../samples/adminUsers';
import styles from './AdminUsersPage.module.css';

type Pending =
  | { kind: 'suspend'; user: AdminUser }
  | { kind: 'reinstate'; user: AdminUser }
  | { kind: 'promote'; user: AdminUser }
  | null;

export function AdminUsersPage() {
  // TODO(admin): GET /api/v1/admin/users?search=&page=
  const users = SAMPLE_ADMIN_USERS;

  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [adjusting, setAdjusting] = useState<AdminUser | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return users;
    return users.filter((user) =>
      `${user.name} ${user.email}`.toLowerCase().includes(needle),
    );
  }, [users, query]);

  function closeAdjust() {
    setAdjusting(null);
    setAmount('');
    setReason('');
  }

  function submitAdjustment() {
    // TODO(credit): there is no endpoint. Credit NFR2.1 refers to
    // "Admin-initiated credit adjustments (Admin F5)", but the Admin
    // requirements stop at F3 and Admin NFR3.1 forbids Admin from calling
    // Credit directly. Recorded in docs/open-items.md.
    closeAdjust();
  }

  const parsedAmount = Number.parseInt(amount, 10);
  const adjustmentValid =
    adjusting !== null &&
    !Number.isNaN(parsedAmount) &&
    parsedAmount !== 0 &&
    reason.trim().length > 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Users</h1>

        <label className={styles.search}>
          <Icon name="search" size={16} />
          <span className="visually-hidden">Search by name or email</span>
          <input
            type="search"
            placeholder="Search by name or email"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <p className={styles.totals}>
          {SAMPLE_USER_TOTALS.total.toLocaleString()} users &middot;{' '}
          {SAMPLE_USER_TOTALS.suspended} suspended
        </p>
      </header>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">User</th>
              <th scope="col">Status</th>
              <th scope="col">Credits</th>
              <th scope="col" className={styles.actionsHead}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((user) => {
              const suspended = user.status === 'Suspended';

              return (
                <tr key={user.userId}>
                  <td>
                    <span className={styles.name}>{user.name}</span>
                    <span className={styles.email}>{user.email}</span>
                  </td>
                  <td>
                    <span className={styles[user.status.toLowerCase()]}>{user.status}</span>
                  </td>
                  <td className={styles.credits}>{user.credits}</td>
                  <td>
                    <div className={styles.actions}>
                      <Button variant="secondary" onClick={() => setAdjusting(user)}>
                        Adjust credits
                      </Button>
                      {/* A suspended account cannot be promoted. */}
                      {suspended ? null : (
                        <Button
                          variant="secondary"
                          onClick={() => setPending({ kind: 'promote', user })}
                        >
                          Make admin
                        </Button>
                      )}
                      {suspended ? (
                        <Button
                          variant="secondary"
                          onClick={() => setPending({ kind: 'reinstate', user })}
                        >
                          Reinstate
                        </Button>
                      ) : (
                        <Button
                          variant="danger"
                          onClick={() => setPending({ kind: 'suspend', user })}
                        >
                          Suspend
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {visible.length === 0 ? (
        <p className={styles.empty}>No user matches that search.</p>
      ) : null}

      <p className={styles.note}>
        Every action here is inert: the Admin Service is not written yet, and adjusting credits
        has no endpoint in any contract.
      </p>

      {/* NFR9.1.1: suspension and promotion both ask first. */}
      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === 'suspend'
            ? 'Suspend this account?'
            : pending?.kind === 'reinstate'
              ? 'Reinstate this account?'
              : 'Make this person an admin?'
        }
        consequence={
          pending === null ? null : pending.kind === 'suspend' ? (
            <>
              {pending.user.name} is blocked from logging in and from every action, within a
              minute (Admin F1.2.1). Orders already in progress are not cancelled.
            </>
          ) : pending.kind === 'reinstate' ? (
            <>{pending.user.name} can log in and act again, within a minute.</>
          ) : (
            <>
              {pending.user.name} gains the whole admin area, including suspending other people
              and resolving disputes. There is no way to demote someone yet.
            </>
          )
        }
        confirmLabel={
          pending?.kind === 'suspend'
            ? 'Suspend'
            : pending?.kind === 'reinstate'
              ? 'Reinstate'
              : 'Make admin'
        }
        destructive={pending?.kind === 'suspend'}
        onConfirm={() => setPending(null)}
        onCancel={() => setPending(null)}
      />

      {/* FR17.1.3: balance, an amount, and a reason. */}
      <Dialog
        open={adjusting !== null}
        title={`Adjust credits for ${adjusting?.name ?? ''}`}
        onClose={closeAdjust}
        footer={
          <>
            <Button variant="secondary" onClick={closeAdjust}>
              Cancel
            </Button>
            <Button disabled={!adjustmentValid} onClick={submitAdjustment}>
              Apply adjustment
            </Button>
          </>
        }
      >
        <div className={styles.adjustBody}>
          <Field label="Current balance">
            <p className={styles.currentBalance}>{adjusting?.credits ?? 0} credits</p>
          </Field>

          <TextField
            label="Adjustment"
            name="amount"
            inputMode="numeric"
            placeholder="e.g. 5 or -3"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            hint="Positive adds credits, negative removes them."
          />

          <TextAreaField
            label="Reason"
            placeholder="Escalation refund for order #1035"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            hint="Recorded against the adjustment in the ledger (Credit NFR2.1)."
          />
        </div>
      </Dialog>
    </div>
  );
}
