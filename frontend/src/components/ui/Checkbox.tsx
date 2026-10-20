/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the checkbox used by the desktop task pool filters.
 * Reviewed by Ngooi Jun Sen.
 */

import { useId } from 'react';
import styles from './Checkbox.module.css';

interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * The real input stays in the DOM and keeps its keyboard and screen-reader
 * behaviour; it is only visually replaced by the drawn box.
 */
export function Checkbox({ label, checked, onChange }: CheckboxProps) {
  const id = useId();

  return (
    <div className={styles.row}>
      <input
        id={id}
        type="checkbox"
        className={styles.input}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={id} className={styles.label}>
        <span className={styles.box} aria-hidden="true" />
        {label}
      </label>
    </div>
  );
}
