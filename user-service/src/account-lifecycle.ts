import { Prisma, type User } from "@prisma/client";
import { prisma } from "./db";
import { AppError } from "./errors";
import { lockVerificationUser } from "./verification-events";

export function deletionDeadline(requestedAt: Date): Date {
  const deadline = new Date(requestedAt);
  const day = deadline.getUTCDate();
  deadline.setUTCDate(1);
  deadline.setUTCMonth(deadline.getUTCMonth() + 6);
  const lastDay = new Date(Date.UTC(deadline.getUTCFullYear(), deadline.getUTCMonth() + 1, 0)).getUTCDate();
  deadline.setUTCDate(Math.min(day, lastDay));
  return deadline;
}

export function deletionIsDue(user: { scheduledDeletionAt: Date | null }, now = new Date()): boolean {
  return user.scheduledDeletionAt !== null && user.scheduledDeletionAt <= now;
}

async function lockAdminDeletion(transaction: Prisma.TransactionClient): Promise<void> {
  // Serialize last-admin checks across concurrent deletion requests/workers.
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(3219, 15)`;
}

async function otherActiveAdmins(transaction: Prisma.TransactionClient, userId: string): Promise<number> {
  return transaction.user.count({ where: {
    id: { not: userId }, role: "ADMIN", accessStatus: "ACTIVE", scheduledDeletionAt: null,
  } });
}

export async function scheduleAccountDeletion(user: User): Promise<Date> {
  return prisma.$transaction(async (transaction) => {
    await lockAdminDeletion(transaction);
    await lockVerificationUser(transaction, user.id);
    const current = await transaction.user.findUniqueOrThrow({ where: { id: user.id } });
    if (deletionIsDue(current)) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    if (current.role === "ADMIN" && await otherActiveAdmins(transaction, user.id) === 0) {
      throw new AppError(409, "LAST_ADMIN", "The last active administrator cannot delete their account");
    }
    const requestedAt = new Date();
    const deadline = current.scheduledDeletionAt ?? deletionDeadline(requestedAt);
    if (!current.scheduledDeletionAt) {
      await transaction.user.update({ where: { id: user.id }, data: {
        deletionRequestedAt: requestedAt, scheduledDeletionAt: deadline, authVersion: { increment: 1 },
      } });
      await transaction.userAuditLog.create({ data: {
        actorUserId: user.id, targetUserId: user.id, action: "ACCOUNT_DELETION_REQUESTED", reason: "Confirmed by account owner",
      } });
    }
    await transaction.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: requestedAt } });
    await transaction.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null, revokedAt: null }, data: { revokedAt: requestedAt } });
    await transaction.emailVerificationOtp.updateMany({ where: { userId: user.id, usedAt: null, revokedAt: null }, data: { revokedAt: requestedAt } });
    await transaction.telegramVerificationChallenge.updateMany({ where: { userId: user.id, usedAt: null, revokedAt: null }, data: { revokedAt: requestedAt } });
    return deadline;
  });
}

export async function deleteExpiredAccounts(options: { now?: Date; limit?: number; userIds?: string[] } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const limit = Math.min(100, Math.max(1, options.limit ?? 100));
  if (options.userIds?.length === 0) return 0;
  return prisma.$transaction(async (transaction) => {
    await lockAdminDeletion(transaction);
    const filter = options.userIds ? Prisma.sql`AND "id" IN (${Prisma.join(options.userIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.empty;
    const candidates = await transaction.$queryRaw<{ id: string; role: string }[]>(Prisma.sql`
      SELECT "id", "role" FROM "User"
      WHERE "scheduledDeletionAt" <= ${now} ${filter}
      ORDER BY "scheduledDeletionAt", "id" LIMIT ${limit} FOR UPDATE SKIP LOCKED
    `);
    let deleted = 0;
    for (const user of candidates) {
      if (user.role === "ADMIN" && await otherActiveAdmins(transaction, user.id) === 0) continue;
      await transaction.userAuditLog.create({ data: {
        targetUserId: user.id, action: "ACCOUNT_DELETED", reason: "Six-month deletion period ended",
      } });
      // User-owned sessions, OTPs, challenges and outbox rows cascade in PostgreSQL.
      await transaction.user.delete({ where: { id: user.id } });
      deleted += 1;
    }
    return deleted;
  });
}
