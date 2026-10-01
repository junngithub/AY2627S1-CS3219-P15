/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the select, textarea, datetime and credit stepper controls
 *        used by the new-request form.
 * Reviewed by Ngooi Jun Sen.
 */

import { useId, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Field } from './Field';
import { Icon } from './Icon';
import styles from './Inputs.module.css';

interface SharedProps {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  success?: ReactNode;
}

export type SelectOption = string | { value: string; label: string };

interface SelectFieldProps
  extends SharedProps,
    Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  /** A plain string is both the value and the label. */
  options: SelectOption[];
  placeholder?: string;
}

export function SelectField({
  label,
  hint,
  error,
  success,
  options,
  placeholder,
  ...rest
}: SelectFieldProps) {
  const id = useId();

  return (
    <Field label={label} htmlFor={id} hint={hint} error={error} success={success}>
      <div className={[styles.control, error ? styles.invalid : ''].filter(Boolean).join(' ')}>
        <select id={id} className={styles.select} aria-invalid={error ? true : undefined} {...rest}>
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options.map((option) => {
            const value = typeof option === 'string' ? option : option.value;
            const label = typeof option === 'string' ? option : option.label;
            return (
              <option key={value} value={value}>
                {label}
              </option>
            );
          })}
        </select>
        <span className={styles.selectIcon} aria-hidden="true">
          <Icon name="chevronDown" size={18} />
        </span>
      </div>
    </Field>
  );
}

interface TextAreaFieldProps
  extends SharedProps,
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {}

export function TextAreaField({ label, hint, error, success, ...rest }: TextAreaFieldProps) {
  const id = useId();

  return (
    <Field label={label} htmlFor={id} hint={hint} error={error} success={success}>
      <div className={[styles.control, error ? styles.invalid : ''].filter(Boolean).join(' ')}>
        <textarea
          id={id}
          className={styles.textarea}
          rows={3}
          aria-invalid={error ? true : undefined}
          {...rest}
        />
      </div>
    </Field>
  );
}

interface DateTimeFieldProps extends SharedProps {
  value: string;
  min?: string;
  onChange: (value: string) => void;
}

/**
 * A native datetime-local input rather than a custom picker.
 *
 * DISCREPANCY: the mockups render these as "Today, 15:30". A native control
 * shows the browser's own format instead, which cannot be restyled. The
 * trade is deliberate: on a phone this opens the platform picker, which is far
 * better than anything hand-rolled, and it is keyboard and screen-reader
 * correct for free. Recorded in docs/open-items.md.
 */
export function DateTimeField({ label, hint, error, success, value, min, onChange }: DateTimeFieldProps) {
  const id = useId();

  return (
    <Field label={label} htmlFor={id} hint={hint} error={error} success={success}>
      <div className={[styles.control, error ? styles.invalid : ''].filter(Boolean).join(' ')}>
        <input
          id={id}
          type="datetime-local"
          className={styles.input}
          value={value}
          min={min}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </Field>
  );
}

interface StepperProps extends SharedProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

/**
 * Credits are whole numbers with a hard floor of 1 (Order F1.2.1), so a
 * stepper suits them better than a free text box; the field stays typeable so
 * a large reward does not need twenty taps.
 */
export function CreditStepper({ label, hint, error, success, value, min, max, onChange }: StepperProps) {
  const id = useId();
  const clamp = (next: number) => Math.min(max, Math.max(min, next));

  return (
    <Field label={label} htmlFor={id} hint={hint} error={error} success={success}>
      <div className={[styles.stepper, error ? styles.invalid : ''].filter(Boolean).join(' ')}>
        <button
          type="button"
          className={styles.stepButton}
          aria-label="Fewer credits"
          disabled={value <= min}
          onClick={() => onChange(clamp(value - 1))}
        >
          &minus;
        </button>

        <input
          id={id}
          type="number"
          inputMode="numeric"
          className={styles.stepValue}
          value={Number.isNaN(value) ? '' : value}
          min={min}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(Number.parseInt(event.target.value, 10))}
        />

        <button
          type="button"
          className={styles.stepButton}
          aria-label="More credits"
          onClick={() => onChange(clamp(value + 1))}
        >
          +
        </button>
      </div>
    </Field>
  );
}
