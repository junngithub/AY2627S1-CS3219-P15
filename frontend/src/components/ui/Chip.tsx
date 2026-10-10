/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the selectable pill used by the task pool filters.
 * Reviewed by Ngooi Jun Sen.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Chip.module.css';

interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  selected: boolean;
  children: ReactNode;
}

/**
 * A toggle, not a link: aria-pressed tells a screen reader whether the filter
 * is on, which the visual fill alone would not.
 */
export function Chip({ selected, children, className, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={[styles.chip, selected ? styles.selected : '', className ?? ''].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}
