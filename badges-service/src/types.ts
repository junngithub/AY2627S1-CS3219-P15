/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5), date: 2026-09-21
 * Scope: Generated shared types for the badges service scaffold.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

export type MetricName =
  | 'completedDeliveries'
  | 'completedOrders'
  | 'averageRating'
  | 'ratingCount';

export type ConditionOp = 'gte' | 'lte';

export interface BadgeCondition {
  metric: MetricName;
  op: ConditionOp;
  value: number;
}

export interface BadgeDefinition {
  badgeId: string;
  title: string;
  description: string;
  targetRole: 'courier' | 'requester' | 'any';
  displayOrder: number;
  iconEarnedUrl: string;
  iconUnearnedUrl: string;
  /** All conditions must hold for the badge to be held. */
  conditions: BadgeCondition[];
  /** Metric shown as "7 of 10" on the profile; defaults to the first condition. */
  progressMetric?: MetricName;
}

export interface UserMetrics {
  userId: string;
  completedDeliveries: number;
  completedOrders: number;
  /** Null when the user has never been rated. */
  averageRating: number | null;
  ratingCount: number;
}

export interface BadgeEvaluation {
  badgeId: string;
  /** True when every condition holds against the metrics just fetched. */
  satisfied: boolean;
  progress: { current: number; target: number } | null;
}

export interface JobSummary {
  runId: number;
  trigger: 'schedule' | 'manual';
  usersProcessed: number;
  /** Users whose counts an order event changed after the run asked Order Service. */
  usersSkipped: number;
  badgesAwarded: number;
  badgesRevoked: number;
  durationMs: number;
}

/** Badges awarded and revoked by one evaluation. */
export interface BadgeChanges {
  awarded: number;
  revoked: number;
}
