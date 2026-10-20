/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the shared Card surface (UI NFR10.1.1).
 * Reviewed by Ngooi Jun Sen.
 */

import type { HTMLAttributes } from 'react';
import styles from './Card.module.css';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={[styles.card, className ?? ''].filter(Boolean).join(' ')} {...rest} />;
}
