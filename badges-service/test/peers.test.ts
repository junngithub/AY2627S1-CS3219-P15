/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Tests for the User and Order Service HTTP clients, with fetch stubbed.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOrderCounts, fetchUserIds, PeerError } from '../src/clients/peers.js';

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchUserIds', () => {
  it('asks User Service for one page of user IDs', async () => {
    const fetchMock = stubFetch(200, { userIds: ['a'], total: 1 });
    expect(await fetchUserIds(1000, 1000)).toEqual({ userIds: ['a'], total: 1 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://user.test/api/v1/user/internal/user-ids?offset=1000&limit=1000');
  });

  it('throws a PeerError on a non-2xx answer', async () => {
    stubFetch(503, { error: 'down', code: 'UNAVAILABLE' });
    const error = await fetchUserIds(0, 10).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PeerError);
    expect(error).toMatchObject({ status: 503, name: 'PeerError' });
  });
});

describe('fetchOrderCounts', () => {
  it('posts the batch of user IDs to Order Service', async () => {
    const rows = [{ userId: 'a', completedDeliveries: 1, completedOrders: 2 }];
    const fetchMock = stubFetch(200, rows);
    expect(await fetchOrderCounts(['a'])).toEqual(rows);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://order.test/api/v1/orders/internal/badge-counts');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ userIds: ['a'] });
  });
});
