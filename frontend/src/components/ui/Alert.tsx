/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the inline alert banner (login error, and later the
 *        expiry and cancellation notices on order pages).
 * Reviewed by Ngooi Jun Sen.
 */

import type { ReactNode } from 'react';
import styles from './Alert.module.css';

interface AlertProps {
  variant?: 'danger' | 'success' | 'warning';
  children: ReactNode;
}

export function Alert({ variant = 'danger', children }: AlertProps) {
  return (
    <div
      className={[styles.alert, styles[variant]].join(' ')}
      role={variant === 'danger' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}
