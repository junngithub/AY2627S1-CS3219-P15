import { describe, expect, it, vi } from 'vitest';
import { withRetries } from '../src/messaging/retry.js';

describe('withRetries', () => {
  it('returns the value on the first success', async () => {
    const onFailure = vi.fn();
    expect(await withRetries(async () => 'ok', 4, onFailure, 0)).toEqual({ ok: true, value: 'ok' });
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('retries until it succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('a')).mockResolvedValue('ok');
    const onFailure = vi.fn();
    expect(await withRetries(fn, 4, onFailure, 0)).toEqual({ ok: true, value: 'ok' });
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts and returns the last error', async () => {
    const error = new Error('down');
    const fn = vi.fn().mockRejectedValue(error);
    const onFailure = vi.fn();
    expect(await withRetries(fn, 4, onFailure, 0)).toEqual({ ok: false, error });
    expect(fn).toHaveBeenCalledTimes(4);
    expect(onFailure).toHaveBeenLastCalledWith(error, 4);
  });
});
