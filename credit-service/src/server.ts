import { buildApp } from './app.js';
import { config } from './config.js';
import { queryClient } from './database/index.js';
import { startConsumers, stopConsumers } from './kafka/consumer.js';

const app = buildApp();

async function start(): Promise<void> {
  try {
    await app.listen({ host: config.host, port: config.port });
    if (config.kafka.enabled) {
      await startConsumers({
        info: (message) => app.log.info(message),
        warn: (message) => app.log.warn(message),
      });
    }
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

async function shutdown(signal: string): Promise<void> {
  app.log.info(`received ${signal}, shutting down`);
  try {
    await stopConsumers();
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
