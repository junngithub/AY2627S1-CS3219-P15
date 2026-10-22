/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-21
 * Scope: Generated the rating dialog and its star picker.
 * Reviewed by Ngooi Jun Sen.
 *
 * UI FR14.1.2 (5-star selector, optional comment, header naming who is
 * rated), FR14.1.3 (Submit and Skip) and FR14.2.1 (centred on desktop, bottom
 * sheet on mobile, which the Dialog shell already does).
 */

import { useId, useState } from 'react';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { TextAreaField } from '../ui/Inputs';
import { errorMessage } from '../../lib/api';
import { COMMENT_MAX_LENGTH, type RatingRole, submitRating } from '../../lib/rating';
import styles from './RatingDialog.module.css';

const SCORE_WORDS = ['', 'Poor', 'Below expectations', 'Okay', 'Good', 'Excellent'];

interface RatingDialogProps {
  open: boolean;
  orderId: string;
  rateeRole: RatingRole;
  /** What the order was for, when the order could be loaded. */
  item: string | null;
  /** The other person's Telegram handle, when known. Orders carry no names. */
  rateeHandle: string | null;
  onDone: () => void;
  onSkip: () => void;
}

export function RatingDialog({ open, orderId, rateeRole, item, rateeHandle, onDone, onSkip }: RatingDialogProps) {
  const [score, setScore] = useState(0);
  // The star under the pointer, 0 when not hovering. Previews only; a click sets score.
  const [hovered, setHovered] = useState(0);
  const shown = hovered || score;
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const groupName = useId();

  const who = rateeRole === 'COURIER' ? 'courier' : 'requester';
  const title = `Rate your ${who}`;
  const tooLong = comment.length > COMMENT_MAX_LENGTH;
  const canSubmit = score >= 1 && !tooLong && !saving;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    setFailure(null);
    try {
      await submitRating(orderId, score, comment);
      onDone();
    } catch (error) {
      setFailure(errorMessage(error, 'Could not reach the server. Try again in a moment.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      title={title}
      onClose={saving ? () => undefined : onSkip}
      footer={
        <>
          <Button variant="secondary" onClick={onSkip} disabled={saving}>
            Skip
          </Button>
          <Button disabled={!canSubmit} loading={saving} onClick={submit}>
            Submit
          </Button>
        </>
      }
    >
      <p className={styles.context}>
        How did {rateeHandle ? `@${rateeHandle}` : `your ${who}`} do
        {item ? (
          <>
            {' '}on <span className={styles.item}>{item}</span>
          </>
        ) : null}
        ?
      </p>

      {failure ? <Alert variant="danger">{failure}</Alert> : null}

      {/* Hovering previews a score: every star up to the pointer fills. */}
      <fieldset className={styles.stars} onMouseLeave={() => setHovered(0)}>
        <legend className="visually-hidden">Score out of 5</legend>
        {[1, 2, 3, 4, 5].map((value) => (
          <label
            key={value}
            className={styles.star}
            data-on={value <= shown ? 'true' : undefined}
            onMouseEnter={() => setHovered(value)}
          >
            <input
              type="radio"
              className="visually-hidden"
              name={groupName}
              value={value}
              checked={score === value}
              onChange={() => setScore(value)}
            />
            <Icon name="star" size={32} filled={value <= shown} />
            <span className="visually-hidden">
              {value} {value === 1 ? 'star' : 'stars'}
            </span>
          </label>
        ))}
      </fieldset>
      <p className={styles.scoreWord} aria-live="polite">
        {shown > 0 ? SCORE_WORDS[shown] : 'Choose a score'}
      </p>

      <TextAreaField
        label="Comment (optional)"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        error={tooLong ? `Keep it to ${COMMENT_MAX_LENGTH} characters` : null}
        hint={`${comment.length}/${COMMENT_MAX_LENGTH}`}
      />
    </Dialog>
  );
}
