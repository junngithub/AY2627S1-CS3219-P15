/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated a stand-in used by every route until its page is built
 *        from the full-resolution mockups.
 * Reviewed by Ngooi Jun Sen.
 */

import { Card } from '../components/ui/Card';

interface PagePlaceholderProps {
  title: string;
  /** Backlog IDs this page will satisfy, so it is clear what still needs building. */
  requirements: string;
}

export function PagePlaceholder({ title, requirements }: PagePlaceholderProps) {
  return (
    <div style={{ maxWidth: 'var(--content-max)', margin: '0 auto', padding: 'var(--space-5)' }}>
      <Card>
        <h1 style={{ marginTop: 0, fontSize: 'var(--font-size-xl)' }}>{title}</h1>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: 0 }}>
          Not built yet. Covers {requirements}.
        </p>
      </Card>
    </div>
  );
}
