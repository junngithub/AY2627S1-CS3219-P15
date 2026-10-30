/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Generated the Kafka consumer wiring, adapted from rating-service's kafka.ts.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import { KafkaJS } from '@confluentinc/kafka-javascript';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { handleOrderEvent } from './orderEvents.js';
import { handleRatingEvent } from './ratingEvents.js';
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

// Which handler a topic's messages go to.
export function handlerFor(topic: string): ((raw: string) => Promise<string>) | undefined {
  if (topic === config.kafka.orderTopic) return handleOrderEvent;
  if (topic === config.kafka.ratingTopic) return handleRatingEvent;
  return undefined;
}

// Starts the foc.order.status and foc.user.rating consumer. Returns a function that stops it.
export async function startMessaging(log: FastifyBaseLogger): Promise<() => Promise<void>> {
  const settings = config.kafka;
  const kafka = createKafka(settings);

  // fromBeginning: a new consumer group reads what the topics still retain, so
  // ratings given before Badges was deployed are picked up.
  const consumer = kafka.consumer({
    kafkaJS: { groupId: settings.groupId, fromBeginning: true },
  });
  await consumer.connect();
  await consumer.subscribe({ topics: [settings.orderTopic, settings.ratingTopic] });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const where = { topic, partition, offset: message.offset };
      const handler = handlerFor(topic);
      if (!handler) return;
      const raw = message.value?.toString('utf8') ?? '';

      const result = await withRetries(
        () => handler(raw),
        settings.maxAttempts,
        (err, attempt) => log.warn({ err, attempt, ...where }, 'badge event failed'),
      );

      if (!result.ok) {
        // NFR3.1.1: log and skip so one bad message can't block the partition.
        log.error({ err: result.error, ...where, raw }, 'badge event skipped after retries');
      } else if (result.value === 'invalid') {
        log.error({ ...where, raw }, 'badge event rejected: does not match the contract');
      } else {
        log.debug({ ...where, outcome: result.value }, 'badge event handled');
      }
    },
  });

  log.info({ brokers: settings.brokers, topics: [settings.orderTopic, settings.ratingTopic] }, 'kafka messaging started');

  return async () => {
    await consumer.disconnect();
  };
}
