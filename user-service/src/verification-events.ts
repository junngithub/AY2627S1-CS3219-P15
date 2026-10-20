import { Prisma, type User } from "@prisma/client";
import { prisma } from "./db";
import type { UserEventPublisher } from "./events";
import { accountStatus } from "./status";

export async function lockVerificationUser(transaction: Prisma.TransactionClient, userId: string): Promise<void> {
  await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`);
}

export async function enqueueUserVerified(transaction: Prisma.TransactionClient, user: User): Promise<void> {
  if (accountStatus(user) !== "Verified") return;
  await transaction.userVerifiedOutbox.upsert({
    where: { userId: user.id },
    create: { userId: user.id, email: user.email },
    update: {},
  });
}

export type PendingVerifiedEvent = { id: string; userId: string; email: string; createdAt: Date };
export interface VerifiedEventStore {
  pending(): Promise<PendingVerifiedEvent[]>;
  markPublished(id: string): Promise<void>;
}

const databaseStore: VerifiedEventStore = {
  pending: () => prisma.userVerifiedOutbox.findMany({
    where: { publishedAt: null }, orderBy: { createdAt: "asc" }, take: 20,
  }),
  markPublished: async (id) => {
    await prisma.userVerifiedOutbox.update({ where: { id }, data: { publishedAt: new Date() } });
  },
};

export class VerificationEventDispatcher {
  private running?: Promise<void>;
  constructor(private publisher: UserEventPublisher, private store: VerifiedEventStore = databaseStore) {}

  flush(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.publishPending().finally(() => { this.running = undefined; });
    return this.running;
  }

  private async publishPending(): Promise<void> {
    for (const event of await this.store.pending()) {
      await this.publisher.publishUserVerified(
        { userId: event.userId, email: event.email }, event.id, event.createdAt.toISOString(),
      );
      // If the process stops between send and this update, retry uses the same
      // eventId. Credit must keep handling repeated events idempotently.
      await this.store.markPublished(event.id);
    }
  }
}
