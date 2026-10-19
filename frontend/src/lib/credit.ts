/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-10
 * Scope: Generated the Credit Service call and the hook the nav bar, profile
 *        and new request form share.
 * Reviewed by Ngooi Jun Sen.
 */

import { useEffect, useState } from 'react';
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

/**
 * The signed-in user's available credits, or null while loading or when the
 * Credit Service cannot be reached. Callers show a placeholder for null rather
 * than a guessed number.
 */
export function useCreditBalance(): number | null {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBalance()
      .then((value) => {
        if (!cancelled) setBalance(value);
      })
      .catch(() => {
        if (!cancelled) setBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return balance;
}
