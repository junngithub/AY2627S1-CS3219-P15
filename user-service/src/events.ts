// Domain events published by the user service. This mirrors the EmailSender
// abstraction in src/email.ts: a small interface with a dev/no-op default and a
// Kafka-backed implementation (src/kafka.ts), injected into the router the same
// way EmailSender is. New events (UserSuspended, UserDeleted, ...) are added as
// methods here and implemented once in the Kafka publisher.

export interface UserVerifiedEvent {
  userId: string;
  email: string;
}

export interface UserEventPublisher {
  publishUserVerified(event: UserVerifiedEvent): Promise<void>;
}

// Default when Kafka is not configured (local dev without a broker, tests): it
// logs and never throws, so verification still succeeds end to end.
export class LoggingUserEventPublisher implements UserEventPublisher {
  async publishUserVerified(event: UserVerifiedEvent): Promise<void> {
    console.log(
      `[user event] UserVerified userId=${event.userId} email=${event.email} (Kafka disabled — not published)`,
    );
  }
}
