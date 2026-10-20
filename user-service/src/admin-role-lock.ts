import type { Prisma } from "@prisma/client";

export async function lockAdminRoleChanges(transaction: Prisma.TransactionClient): Promise<void> {
  // All admin-role mutations and last-admin lifecycle checks must use this lock.
  // Preserve the key already used by deletion workers in older deployments.
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(3219, 15)`;
}
