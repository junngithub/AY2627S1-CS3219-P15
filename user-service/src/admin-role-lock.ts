import type { Prisma } from "@prisma/client";

export function otherAvailableAdmins(excludedUserId: string): Prisma.UserWhereInput {
  return { id: { not: excludedUserId }, role: "ADMIN", accessStatus: "ACTIVE", lockedAt: null,
    emailVerifiedAt: { not: null }, telegramVerifiedAt: { not: null },
    deletionRequestedAt: null, scheduledDeletionAt: null };
}

export async function lockAdminRoleChanges(transaction: Prisma.TransactionClient): Promise<void> {
  // All admin-role mutations and last-admin lifecycle checks must use this lock.
  // Preserve the key already used by deletion workers in older deployments.
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(3219, 15)`;
}
