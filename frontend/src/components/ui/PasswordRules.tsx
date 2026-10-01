/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the password strength bar and rule checklist (UI FR1.2.2).
 * Reviewed by Ngooi Jun Sen.
 */

import type { PasswordRule } from '../../lib/validation';
import styles from './PasswordRules.module.css';

export function PasswordRules({ rules }: { rules: PasswordRule[] }) {
  const passed = rules.filter((rule) => rule.passed).length;
  const strengthClass =
    passed === rules.length ? styles.strong : passed >= 2 ? styles.medium : styles.weak;

  return (
    <div className={styles.wrapper}>
      {/*
        One segment per rule, filled left to right as rules pass. The colour of
        the filled segments is the same strength judgement as before: red until
        two rules hold, accent at two, green once all of them do.
      */}
      <div
        className={styles.meter}
        role="progressbar"
        aria-label="Password strength"
        aria-valuemin={0}
        aria-valuemax={rules.length}
        aria-valuenow={passed}
      >
        {rules.map((rule, index) => (
          <span
            key={rule.id}
            className={[styles.segment, index < passed ? strengthClass : ''].join(' ')}
          />
        ))}
      </div>

      <ul className={styles.rules}>
        {rules.map((rule) => (
          <li
            key={rule.id}
            className={rule.passed ? styles.rulePassed : styles.ruleFailed}
          >
            <span aria-hidden="true">{rule.passed ? '✓' : '✕'}</span> {rule.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
