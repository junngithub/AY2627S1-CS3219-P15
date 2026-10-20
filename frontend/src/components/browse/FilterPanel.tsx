/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5), date: 2026-09-27
 * Scope: Generated the task pool filters, shared by the desktop sidebar and
 *        the mobile filter sheet.
 * Reviewed by Ngooi Jun Sen.
 */

import { Checkbox } from '../ui/Checkbox';
import { Chip } from '../ui/Chip';
import { Icon } from '../ui/Icon';
import styles from './FilterPanel.module.css';

/** Order F4.2.1 ranks by pickup proximity then reward; F4.3 drops to reward only. */
export const SORT_OPTIONS = [
  { value: 'nearest', label: 'Nearest, then reward' },
  { value: 'reward', label: 'Highest reward' },
  { value: 'newest', label: 'Most recent' },
] as const;

export type SortValue = (typeof SORT_OPTIONS)[number]['value'];

/** Minimum reward steps, as the mockups show them. */
export const REWARD_STEPS = [
  { value: 0, label: 'Any' },
  { value: 3, label: '3+' },
  { value: 5, label: '5+' },
];

interface FilterPanelProps {
  /**
   * The mockups draw the same filters two ways: checkboxes down the desktop
   * sidebar, chips in the mobile sheet.
   */
  variant: 'sidebar' | 'sheet';
  pickupPoints: string[];
  selectedPickups: string[];
  onTogglePickup: (point: string) => void;
  minReward: number;
  onMinReward: (value: number) => void;
  sort?: SortValue;
  onSort?: (value: SortValue) => void;
  /**
   * Only the sheet renders this. FR5.4 places a location search bar on the
   * page with no viewport qualifier, and FR5.6.3 collapses the filters into
   * the sheet on mobile, so that is where it lives below the breakpoint.
   */
  query?: string;
  onQuery?: (value: string) => void;
}

export function FilterPanel({
  variant,
  pickupPoints,
  selectedPickups,
  onTogglePickup,
  minReward,
  onMinReward,
  sort,
  onSort,
  query,
  onQuery,
}: FilterPanelProps) {
  return (
    <div className={styles.panel}>
      {query !== undefined && onQuery !== undefined ? (
        <section className={styles.group}>
          <h2 className={styles.groupTitle}>Location</h2>
          <label className={styles.search}>
            <Icon name="search" size={16} />
            <span className="visually-hidden">Search pickup or delivery location</span>
            <input
              type="search"
              placeholder="Pickup or delivery location"
              value={query}
              onChange={(event) => onQuery(event.target.value)}
            />
          </label>
        </section>
      ) : null}

      {variant === 'sidebar' ? (
        /*
         * A native disclosure: keyboard and screen-reader behaviour comes for
         * free, and it collapses the longest filter in the sidebar. The list
         * is derived from the pool, so it can run to a dozen entries.
         */
        <details className={styles.group} open>
          <summary className={styles.groupSummary}>
            <span className={styles.groupTitle}>Pickup point</span>
            {selectedPickups.length > 0 ? (
              <span className={styles.groupCount}>{selectedPickups.length}</span>
            ) : null}
            <span className={styles.groupChevron} aria-hidden="true">
              <Icon name="chevronDown" size={16} />
            </span>
          </summary>
          <div className={styles.checkList}>
            {pickupPoints.map((point) => (
              <Checkbox
                key={point}
                label={point}
                checked={selectedPickups.includes(point)}
                onChange={() => onTogglePickup(point)}
              />
            ))}
          </div>
        </details>
      ) : (
        <section className={styles.group}>
          <h2 className={styles.groupTitle}>Pickup point</h2>
          <div className={styles.chipWrap}>
            {pickupPoints.map((point) => (
              <Chip
                key={point}
                selected={selectedPickups.includes(point)}
                onClick={() => onTogglePickup(point)}
              >
                {point}
              </Chip>
            ))}
          </div>
        </section>
      )}

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>Minimum reward</h2>
        <div className={styles.chipWrap}>
          {REWARD_STEPS.map((step) => (
            <Chip
              key={step.value}
              selected={minReward === step.value}
              onClick={() => onMinReward(step.value)}
            >
              {step.label}
            </Chip>
          ))}
        </div>
      </section>

      {sort !== undefined && onSort !== undefined ? (
        <section className={styles.group}>
          <h2 className={styles.groupTitle}>Sort</h2>
          <select
            className={styles.select}
            value={sort}
            aria-label="Sort requests"
            onChange={(event) => onSort(event.target.value as SortValue)}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </section>
      ) : null}
    </div>
  );
}
