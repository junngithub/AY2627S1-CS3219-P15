/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5), date: 2026-09-21; moved to Vitest 2026-10-30 (Claude Opus 5.5)
 * Scope: Generated unit tests for the badge rule evaluator.
 * Author review: Ngooi Jun Sen to validate and extend before merge.
 */

import { describe, expect, it } from 'vitest';
import { conditionHolds, evaluateAll, evaluateBadge, readMetric } from '../src/rules/evaluator.js';
import type { BadgeDefinition, MetricName, UserMetrics } from '../src/types.js';

const deliveries10: BadgeDefinition = {
  badgeId: 'ten_deliveries',
  title: 'Ten runs',
  description: 'Complete 10 deliveries.',
  targetRole: 'courier',
  displayOrder: 1,
  iconEarnedUrl: 'a.svg',
  iconUnearnedUrl: 'b.svg',
  conditions: [{ metric: 'completedDeliveries', op: 'gte', value: 10 }],
  progressMetric: 'completedDeliveries',
};

const wellRated: BadgeDefinition = {
  badgeId: 'trusted_user',
  title: 'Well rated',
  description: '4.5 across at least 10 ratings.',
  targetRole: 'any',
  displayOrder: 2,
  iconEarnedUrl: 'a.svg',
  iconUnearnedUrl: 'b.svg',
  conditions: [
    { metric: 'averageRating', op: 'gte', value: 4.5 },
    { metric: 'ratingCount', op: 'gte', value: 10 },
  ],
  progressMetric: 'ratingCount',
};

function metrics(overrides: Partial<UserMetrics> = {}): UserMetrics {
  return {
    userId: 'u1',
    completedDeliveries: 0,
    completedOrders: 0,
    averageRating: null,
    ratingCount: 0,
    ...overrides,
  };
}

describe('readMetric', () => {
  it('treats an unrated user as an average of 0', () => {
    expect(readMetric(metrics(), 'averageRating')).toBe(0);
  });

  it('reads each metric', () => {
    const m = metrics({ completedDeliveries: 1, completedOrders: 2, averageRating: 3, ratingCount: 4 });
    expect(readMetric(m, 'completedDeliveries')).toBe(1);
    expect(readMetric(m, 'completedOrders')).toBe(2);
    expect(readMetric(m, 'averageRating')).toBe(3);
    expect(readMetric(m, 'ratingCount')).toBe(4);
  });

  it('rejects a metric it does not know', () => {
    expect(() => readMetric(metrics(), 'karma' as MetricName)).toThrow('Unknown metric');
  });
});

describe('conditionHolds', () => {
  it('supports an upper bound', () => {
    const condition = { metric: 'completedOrders' as const, op: 'lte' as const, value: 2 };
    expect(conditionHolds(condition, metrics({ completedOrders: 2 }))).toBe(true);
    expect(conditionHolds(condition, metrics({ completedOrders: 3 }))).toBe(false);
  });
});

describe('evaluateBadge', () => {
  it('is satisfied once the threshold is reached', () => {
    const result = evaluateBadge(deliveries10, metrics({ completedDeliveries: 10 }));
    expect(result.satisfied).toBe(true);
  });

  it('is not satisfied below the threshold and reports progress', () => {
    const result = evaluateBadge(deliveries10, metrics({ completedDeliveries: 7 }));
    expect(result.satisfied).toBe(false);
    expect(result.progress).toEqual({ current: 7, target: 10 });
  });

  it('caps progress at the target', () => {
    const result = evaluateBadge(deliveries10, metrics({ completedDeliveries: 42 }));
    expect(result.progress).toEqual({ current: 10, target: 10 });
  });

  it('falls back to the first condition for progress', () => {
    const { progressMetric: _unused, ...withoutProgress } = deliveries10;
    expect(evaluateBadge(withoutProgress, metrics({ completedDeliveries: 3 })).progress).toEqual({
      current: 3,
      target: 10,
    });
  });

  it('has no progress when the badge has no conditions or the progress metric has no condition', () => {
    expect(evaluateBadge({ ...deliveries10, conditions: [] }, metrics()).progress).toBeNull();
    expect(evaluateBadge({ ...deliveries10, progressMetric: 'ratingCount' }, metrics()).progress).toBeNull();
  });

  it('requires every condition to hold', () => {
    const highButFew = evaluateBadge(wellRated, metrics({ averageRating: 5, ratingCount: 3 }));
    expect(highButFew.satisfied).toBe(false);

    const bothMet = evaluateBadge(wellRated, metrics({ averageRating: 4.6, ratingCount: 12 }));
    expect(bothMet.satisfied).toBe(true);
  });

  it('drops back to unsatisfied when a metric falls, which is what revocation reads', () => {
    const before = evaluateBadge(wellRated, metrics({ averageRating: 4.6, ratingCount: 12 }));
    const after = evaluateBadge(wellRated, metrics({ averageRating: 4.1, ratingCount: 14 }));
    expect(before.satisfied).toBe(true);
    expect(after.satisfied).toBe(false);
  });
});

describe('evaluateAll', () => {
  it('returns one evaluation per catalog entry', () => {
    const results = evaluateAll([deliveries10, wellRated], metrics({ completedDeliveries: 11 }));
    expect(results.map((r) => r.badgeId)).toEqual(['ten_deliveries', 'trusted_user']);
    expect(results[0]?.satisfied).toBe(true);
    expect(results[1]?.satisfied).toBe(false);
  });
});
