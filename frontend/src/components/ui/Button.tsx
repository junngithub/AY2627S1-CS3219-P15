/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the shared Button component (UI NFR10.1.1).
 * Reviewed by Ngooi Jun Sen.
 */

import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Stretch to the container width; UI FR20.2.1 uses this for primary actions on mobile. */
  fullWidth?: boolean;
  /** Shows a busy state and blocks clicks (UI NFR6.1.1 for race-prone actions). */
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  fullWidth = false,
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    fullWidth ? styles.fullWidth : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}
