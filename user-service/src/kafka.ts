import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Kafka, logLevel } from "kafkajs";
import type { Producer, SASLOptions } from "kafkajs";
import { config } from "./config";
import type { UserEventPublisher, UserVerifiedEvent } from "./events";

// The canonical foc.user.status event envelope (see the plan / ADR-0004). The
// `type` field discriminates events on the topic; `eventId` is persisted by the
// credit service for traceability. Kept small and declared here independently
// of the consumer (no shared package across the CJS/ESM service boundary).
export interface EventEnvelope<T> {
  eventId: string;
  type: string;
  occurredAt: string;
  data: T;
}

// Minimal producer surface we depend on, so tests can inject a fake without
// constructing a real Kafka client. A kafkajs Producer satisfies this.
export interface MessageProducer {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(record: {
    topic: string;
    messages: { key?: string; value: string }[];
  }): Promise<unknown>;
}

// Pure envelope builder — easy to unit test without a broker.
export function buildUserVerifiedEnvelope(
  event: UserVerifiedEvent,
  deps: { eventId?: string; occurredAt?: string } = {},
): EventEnvelope<UserVerifiedEvent> {
  return {
    eventId: deps.eventId ?? randomUUID(),
    type: "UserVerified",
    occurredAt: deps.occurredAt ?? new Date().toISOString(),
    data: { userId: event.userId, email: event.email },
  };
}

function createKafkaProducer(): Producer {
  const sasl: SASLOptions | undefined = config.kafka.username
    ? ({
        mechanism: config.kafka.saslMechanism.toLowerCase(),
        username: config.kafka.username,
        password: config.kafka.password,
      } as SASLOptions)
    : undefined;

  const kafka = new Kafka({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers,
    // KAFKA_CA_CERT is a path to Strimzi's PEM CA (mounted by the Helm chart),
    // not the certificate text — read it and use it as the TLS trust anchor.
    ssl: config.kafka.caCertPath
      ? { ca: [readFileSync(config.kafka.caCertPath, "utf8")] }
      : undefined,
    sasl,
    logLevel: logLevel.WARN,
  });
  return kafka.producer();
}

export class KafkaUserEventPublisher implements UserEventPublisher {
  private readonly producer: MessageProducer;
  private connected = false;
  private connectPromise?: Promise<void>;

  constructor(producer: MessageProducer = createKafkaProducer()) {
    this.producer = producer;
  }

  // Idempotent, retry-safe connect: a failed attempt clears the cached promise
  // so the next publish can try again (lazy connect tolerates a broker that is
  // briefly unavailable at start-up).
  async connect(): Promise<void> {
    if (this.connected) return;
    if (!this.connectPromise) this.connectPromise = this.producer.connect();
    try {
      await this.connectPromise;
      this.connected = true;
    } catch (error) {
      this.connectPromise = undefined;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.producer.disconnect();
    this.connected = false;
  }

  async publishUserVerified(event: UserVerifiedEvent): Promise<void> {
    await this.connect();
    const envelope = buildUserVerifiedEnvelope(event);
    await this.producer.send({
      topic: config.kafka.topic,
      // Key by userId: co-partitions a user's events so future status
      // transitions stay ordered (not load-bearing for UserVerified alone).
      messages: [{ key: event.userId, value: JSON.stringify(envelope) }],
    });
  }
}
