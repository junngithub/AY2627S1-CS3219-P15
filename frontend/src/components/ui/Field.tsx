/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the label, hint and error frame shared by the select,
 *        textarea and stepper on the new-request form.
 * Reviewed by Ngooi Jun Sen.
 */

import type { ReactNode } from 'react';
import styles from './Field.module.css';

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  success?: ReactNode;
  children: ReactNode;
}

/**
 * The message row shows one thing at a time, error first: two contradictory
 * lines under a control is worse than none.
 */
export function Field({ label, htmlFor, hint, error, success, children }: FieldProps) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
      </label>

      {children}

      {error ? (
        <p className={styles.error}>{error}</p>
      ) : success ? (
        <p className={styles.success}>{success}</p>
      ) : hint ? (
        <p className={styles.hint}>{hint}</p>
      ) : null}
    </div>
  );
}
