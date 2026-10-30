/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5), date: 2026-09-21
 * Scope: Generated the badge rule evaluation logic (pure functions, no I/O).
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import type {
  BadgeCondition,
  BadgeDefinition,
  BadgeEvaluation,
  MetricName,
  UserMetrics,
} from '../types.js';

/** Reads a metric off the snapshot. An unrated user counts as 0 average. */
export function readMetric(metrics: UserMetrics, metric: MetricName): number {
  switch (metric) {
    case 'completedDeliveries':
      return metrics.completedDeliveries;
    case 'completedOrders':
      return metrics.completedOrders;
    case 'averageRating':
      return metrics.averageRating ?? 0;
    case 'ratingCount':
      return metrics.ratingCount;
    default: {
      const exhaustive: never = metric;
      throw new Error(`Unknown metric: ${String(exhaustive)}`);
    }
  }
}

export function conditionHolds(condition: BadgeCondition, metrics: UserMetrics): boolean {
  const actual = readMetric(metrics, condition.metric);
  return condition.op === 'gte' ? actual >= condition.value : actual <= condition.value;
}

export function evaluateBadge(
  definition: BadgeDefinition,
  metrics: UserMetrics,
): BadgeEvaluation {
  const satisfied = definition.conditions.every((c) => conditionHolds(c, metrics));

  const progressMetric =
    definition.progressMetric ?? definition.conditions[0]?.metric ?? null;
  const progressCondition = progressMetric
    ? definition.conditions.find((c) => c.metric === progressMetric)
    : undefined;

  const progress =
    progressMetric && progressCondition
      ? {
          current: Math.min(readMetric(metrics, progressMetric), progressCondition.value),
          target: progressCondition.value,
        }
      : null;

  return { badgeId: definition.badgeId, satisfied, progress };
}

export function evaluateAll(
  definitions: BadgeDefinition[],
  metrics: UserMetrics,
): BadgeEvaluation[] {
  return definitions.map((definition) => evaluateBadge(definition, metrics));
}
