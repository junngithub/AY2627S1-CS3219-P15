/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-21
 * Scope: Generated the Rating Service calls and the shared list of ratings the
 *        signed-in user still owes, which the rating prompt reads.
 * Reviewed by Ngooi Jun Sen.
 *
 * Endpoints are rating-service's (rating-service/README.md):
 *   GET  /api/v1/rating/{userId}          one unified average + count
 *   GET  /api/v1/rating/me/pending        ratings this user may still give
 *   POST /api/v1/rating/orders/{orderId}  { score 1-5, comment? }
 */

import { useSyncExternalStore } from 'react';
import { api } from './api';

export type RatingRole = 'COURIER' | 'REQUESTER';

export interface UserRating {
  /** Null until someone has rated the user, so "no ratings" never reads as 0 stars. */
  average: number | null;
  count: number;
}

/** A rating the signed-in user may give: Order Service granted it after delivery or acknowledgement. */
export interface PendingRating {
  orderId: string;
  rateeId: string;
  /** The role the other person had on that order. */
  rateeRole: RatingRole;
  grantedAt: Date;
}

interface UserRatingResponse {
  userId: string;
  average: number | null;
  count: number;
}

interface PendingRatingsResponse {
  pending: { orderId: string; rateeId: string; rateeRole: RatingRole; grantedAt: string }[];
}

export const COMMENT_MAX_LENGTH = 500;

export async function fetchUserRating(userId: string): Promise<UserRating> {
  const result = await api.get<Partial<UserRatingResponse> | null>(
    `/rating/${encodeURIComponent(userId)}`,
  );
  // Checked rather than trusted: a body without these fields (the cluster's
  // placeholder rating service returns none) must read as "no ratings", not
  // reach formatRating as undefined and crash the profile page. A numeric
  // string is accepted, since Postgres numerics often serialise that way.
  const average = Number(result?.average);
  const count = Number(result?.count);
  const hasAverage = result?.average !== null && result?.average !== undefined && Number.isFinite(average);
  return {
    average: hasAverage ? average : null,
    count: Number.isFinite(count) ? count : 0,
  };
}

async function fetchPendingRatings(): Promise<PendingRating[]> {
  const result = await api.get<PendingRatingsResponse>('/rating/me/pending');
  return result.pending.map((p) => ({ ...p, grantedAt: new Date(p.grantedAt) }));
}

export async function submitRating(orderId: string, score: number, comment: string): Promise<void> {
  const trimmed = comment.trim();
  await api.post(`/rating/orders/${encodeURIComponent(orderId)}`, {
    score,
    ...(trimmed === '' ? {} : { comment: trimmed }),
  });
  removePending(orderId);
}

/*
 * One pending list for the whole app, kept the same way as the credit balance
 * (src/lib/credit.ts). Grants reach Rating over Kafka a moment after the
 * delivery or acknowledgement that caused them, so the list is polled while
 * something reads it, refreshed when the tab regains focus, and checked a few
 * extra times right after an action that should produce a grant.
 */
const POLL_MS = 30_000;
const AFTER_ACTION_DELAYS_MS = [1_500, 4_000, 10_000];

let pending: PendingRating[] = [];
const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setInterval> | undefined;
let latestRequest = 0;

function emit() {
  for (const listener of listeners) listener();
}

function removePending(orderId: string) {
  const next = pending.filter((p) => p.orderId !== orderId);
  if (next.length === pending.length) return;
  pending = next;
  emit();
}

/** Re-read the pending list. A failure keeps the last list: the prompt is optional. */
export async function refreshPendingRatings(): Promise<void> {
  const request = ++latestRequest;
  try {
    const next = await fetchPendingRatings();
    if (request !== latestRequest) return;
    pending = next;
    emit();
  } catch {
    // Rating Service unreachable: try again on the next poll.
  }
}

/**
 * Call after delivering (the courier may then rate the requester) or
 * acknowledging (the requester may then rate the courier).
 */
export function expectNewRating(): void {
  for (const delay of AFTER_ACTION_DELAYS_MS) {
    setTimeout(() => {
      if (listeners.size > 0) void refreshPendingRatings();
    }, delay);
  }
}

function onFocus() {
  if (document.visibilityState === 'visible') void refreshPendingRatings();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshPendingRatings();
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshPendingRatings();
    }, POLL_MS);
    document.addEventListener('visibilitychange', onFocus);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onFocus);
      // Signed out: forget the list so the next user never sees it.
      latestRequest += 1;
      pending = [];
    }
  };
}

export function usePendingRatings(): PendingRating[] {
  return useSyncExternalStore(subscribe, () => pending);
}

/*
 * "Skip" (UI FR14.1.3) means "don't ask me about this order again". Kept in
 * this browser only: the Rating Service has no notion of a skipped rating, and
 * the grant stays usable.
 */
const SKIPPED_KEY = 'foc.rating.skipped';

function readSkipped(userId: string): string[] {
  try {
    const all = JSON.parse(window.localStorage.getItem(SKIPPED_KEY) ?? '{}') as Record<string, string[]>;
    return Array.isArray(all[userId]) ? all[userId] : [];
  } catch {
    return [];
  }
}

export function isSkipped(userId: string, orderId: string): boolean {
  return readSkipped(userId).includes(orderId);
}

export function skipRating(userId: string, orderId: string): void {
  try {
    const all = JSON.parse(window.localStorage.getItem(SKIPPED_KEY) ?? '{}') as Record<string, string[]>;
    all[userId] = [...readSkipped(userId), orderId].slice(-200);
    window.localStorage.setItem(SKIPPED_KEY, JSON.stringify(all));
  } catch {
    // Storage blocked: the prompt may ask again after a reload, which is harmless.
  }
}
