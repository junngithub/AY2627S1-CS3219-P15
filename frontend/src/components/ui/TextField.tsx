/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the shared labelled text field with inline validation states.
 * Reviewed by Ngooi Jun Sen.
 */

import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import styles from './TextField.module.css';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  /** Shown in red under the field; also marks the input invalid (UI FR1.2.1). */
  error?: string | null;
  /** Shown in green under the field when the value is valid. */
  success?: string | null;
  /** Neutral hint under the field. */
  hint?: ReactNode;
  /** Static text inside the field, such as the "@" on the Telegram handle. */
  prefix?: string;
  /** Right-aligned content on the label row, such as the "Forgot password?" link. */
  labelAction?: ReactNode;
  /** Extra content under the field, such as the password rule list. */
  children?: ReactNode;
}

export function TextField({
  label,
  error,
  success,
  hint,
  prefix,
  labelAction,
  children,
  className,
  ...rest
}: TextFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const state = error ? styles.invalid : success ? styles.valid : '';

  return (
    <div className={[styles.field, className ?? ''].filter(Boolean).join(' ')}>
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
        {labelAction}
      </div>

      <div className={[styles.control, state].filter(Boolean).join(' ')}>
        {prefix ? (
          <span className={styles.prefix} aria-hidden="true">
            {prefix}
          </span>
        ) : null}
        <input
          id={id}
          className={styles.input}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || success || hint ? messageId : undefined}
          {...rest}
        />
      </div>

      {children}

      {error ? (
        <p id={messageId} className={styles.errorText} role="alert">
          {error}
        </p>
      ) : success ? (
        <p id={messageId} className={styles.successText}>
          <span aria-hidden="true">&#10003; </span>
          {success}
        </p>
      ) : hint ? (
        <p id={messageId} className={styles.hintText}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
