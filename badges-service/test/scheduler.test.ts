/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Tests for the daily schedule wiring, with node-cron and the run mocked.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import cron from 'node-cron';
import { RunInProgressError } from '../src/errors.js';
import { runNow } from '../src/jobs/evaluationRun.js';
import { startScheduler } from '../src/jobs/scheduler.js';

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../src/jobs/evaluationRun.js', () => ({ runNow: vi.fn() }));

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const stop = vi.fn();
let tick: () => Promise<void>;

beforeEach(() => {
  vi.mocked(cron.schedule).mockImplementation(((_expression: string, fn: () => Promise<void>) => {
    tick = fn;
    return { stop };
  }) as never);
});

describe('startScheduler', () => {
  it('schedules the daily run at 22:00 UTC and can be stopped', () => {
    const stopScheduler = startScheduler(log as never);
    expect(cron.schedule).toHaveBeenCalledWith('0 22 * * *', expect.any(Function), { timezone: 'UTC' });
    stopScheduler();
    expect(stop).toHaveBeenCalled();
  });

  it('runs a scheduled pass and logs its summary', async () => {
    vi.mocked(runNow).mockResolvedValue({ runId: 1 } as never);
    startScheduler(log as never);
    await tick();
    expect(runNow).toHaveBeenCalledWith('schedule');
    expect(log.info).toHaveBeenCalledWith({ summary: { runId: 1 } }, 'scheduled badge run finished');
  });

  it('skips quietly when a run is already in progress', async () => {
    vi.mocked(runNow).mockRejectedValue(new RunInProgressError());
    startScheduler(log as never);
    await tick();
    expect(log.warn).toHaveBeenCalledWith('scheduled badge run skipped: another run is in progress');
  });

  it('logs a failed run', async () => {
    const error = new Error('order down');
    vi.mocked(runNow).mockRejectedValue(error);
    startScheduler(log as never);
    await tick();
    expect(log.error).toHaveBeenCalledWith({ err: error }, 'scheduled badge run failed');
  });
});
