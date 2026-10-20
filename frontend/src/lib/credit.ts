/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-10
 * Scope: Generated the Credit Service call and the hook the nav bar, profile
 *        and new request form share; made it one shared, refreshable balance
 *        with Claude Code (Claude Opus 5.5) on 2026-10-20.
 * Reviewed by Ngooi Jun Sen.
 */

import { useSyncExternalStore } from 'react';
import { api } from './api';

/** `GET /api/v1/credit/me/balance`, as credit-service returns it. */
interface BalanceResponse {
  userId: string;
  balance: number;
}

/*
 * TODO(credit): the mockups also show credits reserved in open orders and an
 * earned / spent / granted breakdown. The balance endpoint returns only the
 * available figure, and the ledger endpoint in the contract
 * (GET /api/v1/credit/me/ledger) is not implemented yet.
 */

export async function fetchBalance(): Promise<number> {
  const result = await api.get<BalanceResponse>('/credit/me/balance');
  return result.balance;
}

/** Often enough that settlement made elsewhere shows up without a reload. */
const POLL_MS = 20_000;

/*
 * One balance for the whole app. The nav bar, profile and new request form
 * all read it, so they cannot disagree, and a page that changes the balance
 * (posting, cancelling, acknowledging) calls refreshCreditBalance() once
 * rather than every reader fetching its own copy.
 *
 * The balance also changes where no request from this tab is involved: the
 * starting credits after verification, and Credit settling an order from
 * Kafka when the requester acknowledges or a deadline passes. For those it
 * polls while anything is reading it, and refreshes when the tab regains
 * focus.
 */
let balance: number | null = null;
const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setInterval> | undefined;
// Each fetch gets a number; an older response arriving late is ignored.
let latestRequest = 0;

function emit() {
  for (const listener of listeners) listener();
}

/**
 * Re-read the balance from the Credit Service, the owner of balances. Call it
 * after any action that changes credits. Null on failure: callers show a
 * placeholder rather than a number that may be wrong.
 */
export async function refreshCreditBalance(): Promise<void> {
  const request = ++latestRequest;
  let next: number | null;
  try {
    next = await fetchBalance();
  } catch {
    next = null;
  }
  if (request !== latestRequest || next === balance) return;
  balance = next;
  emit();
}

function onFocus() {
  if (document.visibilityState === 'visible') void refreshCreditBalance();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshCreditBalance();
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshCreditBalance();
    }, POLL_MS);
    document.addEventListener('visibilitychange', onFocus);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onFocus);
      // Nothing reads it, e.g. after signing out: forget it, so the next user
      // never sees the previous one's balance while theirs loads.
      latestRequest += 1;
      balance = null;
    }
  };
}

/**
 * The signed-in user's available credits, or null while loading or when the
 * Credit Service cannot be reached.
 */
export function useCreditBalance(): number | null {
  return useSyncExternalStore(subscribe, () => balance);
}
