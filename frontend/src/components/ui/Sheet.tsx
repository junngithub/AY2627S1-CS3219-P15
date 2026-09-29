/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the mobile bottom sheet used by the task pool filters, and
 *        reusable by the report-issue and rating dialogs later (FR8, FR14).
 * Reviewed by Ngooi Jun Sen.
 */

import { useEffect, useId, type ReactNode } from 'react';
import styles from './Sheet.module.css';

interface SheetProps {
  open: boolean;
  title: string;
  /** Shown to the right of the title, e.g. a Reset link. */
  headerAction?: ReactNode;
  /** Pinned below the scrolling body, e.g. the Show results button. */
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

export function Sheet({ open, title, headerAction, footer, onClose, children }: SheetProps) {
  const titleId = useId();

  // Escape closes it, and the page behind must not scroll while it is up.
  useEffect(() => {
    if (!open) return undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.overlay}>
      {/* Tapping the dimmed area closes, which is what a sheet is expected to do. */}
      <button type="button" className={styles.backdrop} aria-label="Close" onClick={onClose} />

      <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <span className={styles.grabber} aria-hidden="true" />

        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {headerAction}
        </div>

        <div className={styles.body}>{children}</div>

        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>
  );
}
