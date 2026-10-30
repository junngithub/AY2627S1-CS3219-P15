/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Ported the cron wiring for the daily run.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';
import { config } from '../config.js';
import { RunInProgressError } from '../errors.js';
import { runNow } from './evaluationRun.js';

// F2.1: the daily run, at 22:00 UTC unless BADGES_CRON says otherwise.
export function startScheduler(log: FastifyBaseLogger): () => void {
  const task = cron.schedule(
    config.schedule.cron,
    async () => {
      try {
        const summary = await runNow('schedule');
        log.info({ summary }, 'scheduled badge run finished');
      } catch (error) {
        if (error instanceof RunInProgressError) {
          log.warn('scheduled badge run skipped: another run is in progress');
        } else {
          log.error({ err: error }, 'scheduled badge run failed');
        }
      }
    },
    { timezone: config.schedule.timezone },
  );
  log.info({ cron: config.schedule.cron, timezone: config.schedule.timezone }, 'badge run scheduled');
  return () => task.stop();
}
