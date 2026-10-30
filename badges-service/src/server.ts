/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Service bootstrap (catalog seed, schedule, Kafka, listen), modelled on rating-service.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import { buildApp } from './app.js';
import catalogSeed from './catalog/badges.json' with { type: 'json' };
import { config } from './config.js';
import { queryClient } from './database/index.js';
import { closeInterruptedRuns } from './jobs/evaluationRun.js';
import { startScheduler } from './jobs/scheduler.js';
import { startMessaging } from './messaging/kafka.js';
import { seedCatalog } from './services/catalog.service.js';
import type { BadgeDefinition } from './types.js';

const app = buildApp();
let stopMessaging: (() => Promise<void>) | undefined;
let stopScheduler: (() => void) | undefined;

async function start(): Promise<void> {
  try {
    // The schema itself is migrated by the migrate Job (ADR-0011) before this starts.
    await seedCatalog(catalogSeed as BadgeDefinition[]);
    const closed = await closeInterruptedRuns();
    if (closed > 0) app.log.warn({ closed }, 'closed badge runs cut off by a restart');

    await app.listen({ host: config.host, port: config.port });

    if (config.schedule.enabled) {
      stopScheduler = startScheduler(app.log);
    }
    if (config.kafka.brokers.length > 0) {
      stopMessaging = await startMessaging(app.log);
    } else {
      app.log.warn('KAFKA_BROKERS is not set: badges change only on the daily or manual run');
    }
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

async function shutdown(signal: string): Promise<void> {
  app.log.info(`received ${signal}, shutting down`);
  try {
    stopScheduler?.();
    await stopMessaging?.();
    await app.close();
    await queryClient.end({ timeout: 5 });
  } finally {
    process.exit(0);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

void start();
