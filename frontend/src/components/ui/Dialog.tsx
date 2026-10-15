/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the modal shell and the confirmation dialog built on it.
 * Reviewed by Ngooi Jun Sen.
 *
 * UI FR8.3.1 and FR14.2.1 both ask for the same shape: a centred modal on
 * desktop and a bottom sheet on mobile. The report-issue and rating dialogs
 * will reuse this shell.
 */

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './Button';
import styles from './Dialog.module.css';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

export function Dialog({ open, title, onClose, footer, children }: DialogProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  // Callers usually pass a new onClose on every render. Read it through a ref
  // so the effect below runs only on open and close: re-running it on each
  // render would pull focus out of whatever field the user is typing in.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current();
    }

    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    // Move focus into the dialog so the keyboard lands somewhere sensible.
    panel.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className={styles.overlay}>
      <button type="button" className={styles.backdrop} aria-label="Close" onClick={onClose} />

      <div
        ref={panel}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <div className={styles.body}>{children}</div>
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** NFR9.1.2: say plainly what happens if they go ahead. */
  consequence: ReactNode;
  confirmLabel: string;
  /** Destructive actions get the danger button. */
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * NFR9.1.1: irreversible or high-impact actions ask first. Used by the
 * supplier approval queue and, later, by order cancellation and escalation.
 */
export function ConfirmDialog({
  open,
  title,
  consequence,
  confirmLabel,
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={busy ? () => undefined : onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className={styles.consequence}>{consequence}</p>
    </Dialog>
  );
}
