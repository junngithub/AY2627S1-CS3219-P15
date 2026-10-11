import { readFileSync } from 'node:fs';
import { Kafka, logLevel } from 'kafkajs';
import type { Consumer, SASLOptions } from 'kafkajs';
import { config } from '../config.js';
import { handleUserStatusMessage } from './userStatusHandler.js';

// Transport only: connect, subscribe to foc.user.status, and hand each message
// to the pure handler (which holds the testable logic). Thin glue, excluded
// from coverage like server.ts/app.ts.

export interface ConsumerLogger {
  info(message: string): void;
  warn(message: string): void;
}

let consumer: Consumer | undefined;

function buildKafka(): Kafka {
  const sasl: SASLOptions | undefined = config.kafka.username
    ? ({
        mechanism: config.kafka.saslMechanism.toLowerCase(),
        username: config.kafka.username,
        password: config.kafka.password,
      } as SASLOptions)
    : undefined;

  return new Kafka({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers,
    // KAFKA_CA_CERT is a path to Strimzi's PEM CA (mounted by the Helm chart).
    ssl: config.kafka.caCertPath
      ? { ca: [readFileSync(config.kafka.caCertPath, 'utf8')] }
      : undefined,
    sasl,
    logLevel: logLevel.WARN,
  });
}

export async function startConsumer(logger: ConsumerLogger = console): Promise<void> {
  const kafka = buildKafka();
  consumer = kafka.consumer({ groupId: config.kafka.consumerGroupId });

  await consumer.connect();
  await consumer.subscribe({ topic: config.kafka.userStatusTopic, fromBeginning: true });
  await consumer.run({
    eachMessage: async ({ message }) => {
      const raw = message.value ? message.value.toString('utf8') : null;
      // A throw here leaves the offset uncommitted → kafkajs retries.
      await handleUserStatusMessage(raw, (m) => logger.warn(m));
    },
  });

  logger.info(
    `Kafka consumer running: topic=${config.kafka.userStatusTopic} group=${config.kafka.consumerGroupId}`,
  );
}

export async function stopConsumer(): Promise<void> {
  if (consumer) {
    await consumer.disconnect();
    consumer = undefined;
  }
}
