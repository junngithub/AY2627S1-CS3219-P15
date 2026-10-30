/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Generated the HTTP clients the daily run uses to pull user IDs and order counts.
 * Author review: Ngooi Jun Sen to validate before merge.
 *
 * PROVISIONAL: neither endpoint exists yet; the paths and shapes below are what
 * Badges asks of User and Order (README, "What this service needs from teammates").
 * They are internal calls over private service DNS: Linkerd's route policy, not a
 * shared token, decides who may make them (ADR-0012), so no auth header is sent.
 */

import { config } from '../config.js';

export interface UserIdPage {
  userIds: string[];
  total: number;
}

export interface OrderCounts {
  userId: string;
  completedDeliveries: number;
  completedOrders: number;
}

export class PeerError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`${url} answered ${status}`);
    this.name = 'PeerError';
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(config.httpTimeoutMs) });
  if (!response.ok) throw new PeerError(url, response.status);
  return (await response.json()) as T;
}

/** User Service: one page of the IDs of every user to evaluate. */
export function fetchUserIds(offset: number, limit: number): Promise<UserIdPage> {
  const url = `${config.userServiceUrl}/api/v1/user/internal/user-ids?offset=${offset}&limit=${limit}`;
  return call<UserIdPage>(url);
}

/**
 * Order Service: per user, orders in DELIVERED, ACKNOWLEDGED, UNACKNOWLEDGED or
 * COMPLETED that were never escalated (no caseId), as courier and as requester.
 */
export function fetchOrderCounts(userIds: string[]): Promise<OrderCounts[]> {
  const url = `${config.orderServiceUrl}/api/v1/orders/internal/badge-counts`;
  return call<OrderCounts[]>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userIds }),
  });
}
