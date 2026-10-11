import { readFileSync } from 'node:fs';
import { Kafka, logLevel } from 'kafkajs';
import type { Consumer, SASLOptions } from 'kafkajs';
import { config } from '../config.js';
import { handleCreditCommandMessage } from './creditCommandsHandler.js';
import { handleUserStatusMessage } from './userStatusHandler.js';

// Transport only: connect, subscribe, and hand each message to a pure handler
// (which holds the testable logic). Thin glue, excluded from coverage like
// server.ts/app.ts.
//
// One consumer, in its own consumer group, per topic: a message being retried on
// one topic doesn't hold up the other. E.g. a completion for a courier with no
// credit account (retried until it has one) mustn't stop new users onboarding.

export interface ConsumerLogger {
  info(message: string): void;
  warn(message: string): void;
}

type MessageHandler = (rawValue: string | null, log: (message: string) => void) => Promise<void>;

const consumers: Consumer[] = [];

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

async function startConsumer(
  kafka: Kafka,
  topic: string,
  groupId: string,
  handle: MessageHandler,
  logger: ConsumerLogger,
): Promise<void> {
  const consumer = kafka.consumer({ groupId });
  consumers.push(consumer);

  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });
  await consumer.run({
    eachMessage: async ({ message }) => {
      const raw = message.value ? message.value.toString('utf8') : null;
      // A throw here leaves the offset uncommitted → kafkajs retries.
      await handle(raw, (m) => logger.warn(m));
    },
  });

  logger.info(`Kafka consumer running: topic=${topic} group=${groupId}`);
}

export async function startConsumers(logger: ConsumerLogger = console): Promise<void> {
  const kafka = buildKafka();
  const { userStatusTopic, userStatusGroupId, creditCommandsTopic, creditCommandsGroupId } =
    config.kafka;

  await startConsumer(kafka, userStatusTopic, userStatusGroupId, handleUserStatusMessage, logger);
  await startConsumer(
    kafka,
    creditCommandsTopic,
    creditCommandsGroupId,
    handleCreditCommandMessage,
    logger,
  );
}

export async function stopConsumers(): Promise<void> {
  await Promise.all(consumers.splice(0).map((consumer) => consumer.disconnect()));
}
