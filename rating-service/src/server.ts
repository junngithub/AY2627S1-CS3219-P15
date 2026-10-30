import { buildApp } from './app.js';
import { config } from './config.js';
import { queryClient } from './database/index.js';
import { startMessaging } from './messaging/kafka.js';

const app = buildApp();
let stopMessaging: (() => Promise<void>) | undefined;

async function start(): Promise<void> {
  try {
    await app.listen({ host: config.host, port: config.port });
    if (config.kafka.brokers.length > 0) {
      stopMessaging = await startMessaging(app.log);
    } else {
      app.log.warn('KAFKA_BROKERS is not set: no rating grants will arrive and no updates are published');
    }
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

async function shutdown(signal: string): Promise<void> {
  app.log.info(`received ${signal}, shutting down`);
  try {
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
