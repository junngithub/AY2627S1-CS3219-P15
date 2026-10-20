/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the user management page from the mockup.
 * Reviewed by Ngooi Jun Sen, removed unnecessary column for user roles.
 *
 * Covers UI FR17.1.1 (search, with role and status shown), FR17.1.2 (suspend
 * and promote), FR17.1.3 (the adjust-credits modal with balance, amount and
 * reason) and NFR11.1.2 (the table scrolls in its own box on a narrow
 * screen).
 *
 * Reads and acts through the Admin Service (GET /api/v1/admin/users and the
 * promote, suspend and reinstate endpoints). Adjusting credits is still inert:
 * no contract has an endpoint for it.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { ConfirmDialog, Dialog } from '../components/ui/Dialog';
import { Field } from '../components/ui/Field';
import { Icon } from '../components/ui/Icon';
import { TextField } from '../components/ui/TextField';
import { TextAreaField } from '../components/ui/Inputs';
import { errorMessage } from '../lib/api';
import {
  fetchAdminUsers,
  promoteUser,
  reinstateUser,
  suspendUser,
  type AdminUser,
} from '../lib/adminUsers';
import styles from './AdminUsersPage.module.css';

type Pending =
  | { kind: 'suspend'; user: AdminUser }
  | { kind: 'reinstate'; user: AdminUser }
  | { kind: 'promote'; user: AdminUser }
  | null;

/** Wait for typing to pause before searching, so each key is not a request. */
const SEARCH_DELAY_MS = 300;

export function AdminUsersPage() {
  const { user: me } = useAuth();

  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [pending, setPending] = useState<Pending>(null);
  const [working, setWorking] = useState(false);
  const [adjusting, setAdjusting] = useState<AdminUser | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  // Admin F1: search runs on the service, so it covers every user, not just
  // the page on screen.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    fetchAdminUsers(search, page)
      .then((result) => {
        if (cancelled) return;
        setUsers(result.items);
        setHasMore(result.hasMore);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setUsers([]);
        setHasMore(false);
        setLoadError(errorMessage(error, 'Could not reach the Admin Service. Start it and reload.'));
      });
    return () => {
      cancelled = true;
    };
  }, [search, page, reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  async function confirmPending() {
    if (pending === null) return;
    const { kind, user } = pending;

    setWorking(true);
    setActionError(null);
    try {
      if (kind === 'promote') await promoteUser(user.userId);
      if (kind === 'suspend') await suspendUser(user.userId);
      if (kind === 'reinstate') await reinstateUser(user.userId);
      setPending(null);
      // Re-read rather than patching locally, so the table shows what the
      // service actually stored.
      reload();
    } catch (error) {
      setPending(null);
      setActionError(
        errorMessage(error, `Could not reach the Admin Service, so ${user.name} is unchanged.`),
      );
    } finally {
      setWorking(false);
    }
  }

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

        {/* The contract's list carries no total, so only the page is counted. */}
        <p className={styles.totals}>
          {users === null ? 'Loading' : `${users.length} on this page`}
        </p>
      </header>

      {loadError ? <Alert variant="danger">{loadError}</Alert> : null}
      {actionError ? <Alert variant="danger">{actionError}</Alert> : null}

      {users !== null && users.length > 0 ? (
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
              {users.map((user) => {
                const suspended = user.status === 'Suspended';
                // D2 Part 1 point 6: an admin cannot suspend themselves from
                // here, which also stops the last admin locking everyone out.
                // The service must refuse it as well; this only hides it.
                const isMe = me !== null && user.userId === me.userId;

                return (
                  <tr key={user.userId}>
                    <td>
                      <span className={styles.name}>
                        {user.name}
                        {user.isAdmin ? <span className={styles.tag}>Admin</span> : null}
                        {isMe ? <span className={styles.tag}>You</span> : null}
                      </span>
                      <span className={styles.email}>{user.email}</span>
                    </td>
                    <td>
                      <span className={styles[user.status.toLowerCase()]}>{user.status}</span>
                    </td>
                    <td className={styles.credits}>{user.credits ?? '—'}</td>
                    <td>
                      <div className={styles.actions}>
                        <Button variant="secondary" onClick={() => setAdjusting(user)}>
                          Adjust credits
                        </Button>
                        {/* A suspended account cannot be promoted, and an
                            admin has nothing to be promoted to. */}
                        {suspended || user.isAdmin ? null : (
                          <Button
                            variant="secondary"
                            onClick={() => setPending({ kind: 'promote', user })}
                          >
                            Make admin
                          </Button>
                        )}
                        {isMe ? null : suspended ? (
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
      ) : null}

      {users !== null && users.length === 0 && loadError === null ? (
        <p className={styles.empty}>
          {search.trim() === '' ? 'No users yet.' : 'No user matches that search.'}
        </p>
      ) : null}

      {page > 1 || hasMore ? (
        <div className={styles.pager}>
          <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span>Page {page}</span>
          <Button variant="secondary" disabled={!hasMore} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      ) : null}

      <p className={styles.note}>
        Adjusting credits is inert: no contract has an endpoint for it. There is also no way to
        demote an admin, because the contract has no demote endpoint.
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
        busy={working}
        onConfirm={confirmPending}
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
            <p className={styles.currentBalance}>
              {adjusting?.credits === undefined ? 'Unknown' : `${adjusting.credits} credits`}
            </p>
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
