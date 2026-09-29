/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the profile page from the mockup.
 * Author review: Ngooi Jun Sen to validate before merge.
 *
 * Covers UI FR12.1.1 (name, email, credit balance), FR12.1.2 (change
 * password link), FR12.3.1 (two columns on desktop, account and credits left)
 * and FR12.3.2 (one stacked column on mobile).
 *
 * FR12.2.1 ratings and FR12.2.2 badges are deliberately not built yet: the
 * Rating Service is unwritten, the Badges Service has no metrics to work
 * from, and the two requirements land on 23 October and 6 November. Both are
 * shown as coming soon rather than filled with invented numbers.
 */

import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
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
  const { user } = useAuth();

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
              {/* TODO(user-service): PATCH /api/v1/user/me/password (F3.7).
                  No page exists for it yet, so the control is inert. */}
              <Button variant="secondary" disabled>
                Change password
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
    </div>
  );
}
