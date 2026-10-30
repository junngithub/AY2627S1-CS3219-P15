import { KafkaJS } from '@confluentinc/kafka-javascript';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { handleRatingCommand } from './grants.js';
import { startOutboxRelay } from './outbox.js';
import { withRetries } from './retry.js';

type KafkaSettings = typeof config.kafka;

// Deployed clusters use TLS + SCRAM-SHA-512 (ADR-0004). A local broker with no
// username set connects in plaintext.
function createKafka(settings: KafkaSettings): KafkaJS.Kafka {
  const secured = settings.username !== '';
  return new KafkaJS.Kafka({
    kafkaJS: {
      clientId: settings.clientId,
      brokers: [...settings.brokers],
      ssl: secured,
      ...(secured && {
        sasl: {
          mechanism: 'scram-sha-512' as const,
          username: settings.username,
          password: settings.password,
        },
      }),
    },
    ...(settings.caCert !== '' && { 'ssl.ca.location': settings.caCert }),
  });
}

// Starts the foc.rating.commands consumer and the outbox relay to foc.user.rating.
// Returns a function that stops both.
export async function startMessaging(log: FastifyBaseLogger): Promise<() => Promise<void>> {
  const settings = config.kafka;
  const kafka = createKafka(settings);

  const producer = kafka.producer();
  await producer.connect();
  const stopRelay = startOutboxRelay(producer, settings.outboxPollMs, (err) =>
    log.warn({ err }, 'outbox relay pass failed; will retry'),
  );

  const consumer = kafka.consumer({
    kafkaJS: { groupId: settings.groupId, fromBeginning: true },
  });
  await consumer.connect();
  await consumer.subscribe({ topics: [settings.commandsTopic] });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const where = { topic, partition, offset: message.offset };
      const raw = message.value?.toString('utf8') ?? '';

      const result = await withRetries(
        () => handleRatingCommand(raw),
        settings.maxAttempts,
        (err, attempt) => log.warn({ err, attempt, ...where }, 'rating command failed'),
      );

      if (!result.ok) {
        // NFR3.1.1: log and skip so one bad message can't block the partition.
        log.error({ err: result.error, ...where, raw }, 'rating command skipped after retries');
      } else if (result.value === 'invalid') {
        log.error({ ...where, raw }, 'rating command rejected: does not match the contract');
      } else {
        log.debug({ ...where, outcome: result.value }, 'rating command handled');
      }
    },
  });

  log.info({ brokers: settings.brokers, topic: settings.commandsTopic }, 'kafka messaging started');

  return async () => {
    stopRelay();
    await consumer.disconnect();
    await producer.disconnect();
  };
}
