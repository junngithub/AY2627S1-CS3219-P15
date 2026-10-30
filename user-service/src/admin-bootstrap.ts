import type { PrismaClient, User } from "@prisma/client";
import { lockAdminRoleChanges } from "./admin-role-lock";
import { prisma } from "./db";
import { isUuid } from "./integration-access";
import { lockVerificationUser } from "./verification-events";

export const FIRST_ADMIN_BOOTSTRAPPED = "FIRST_ADMIN_BOOTSTRAPPED";

export class AdminBootstrapError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AdminBootstrapError";
  }
}

export type BootstrapAdminOptions = { help: true } | { help: false; userId: string };

export function parseBootstrapAdminArguments(args: readonly string[]): BootstrapAdminOptions {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) return { help: true };
  let userId: string | undefined;
  let confirmed = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--user-id" && userId === undefined) {
      userId = args[++index];
      if (!isUuid(userId)) throw new AdminBootstrapError("INVALID_USER_ID", "Provide an existing user's UUID with --user-id.");
    } else if (args[index] === "--confirm" && !confirmed) {
      confirmed = true;
    } else {
      throw new AdminBootstrapError("INVALID_ARGUMENTS", "Use --user-id <UUID> --confirm, or --help.");
    }
  }
  if (!userId) throw new AdminBootstrapError("INVALID_USER_ID", "Provide an existing user's UUID with --user-id.");
  if (!confirmed) throw new AdminBootstrapError("CONFIRMATION_REQUIRED", "Explicit --confirm is required to grant administrator privileges.");
  return { help: false, userId: userId.toLowerCase() };
}

type BootstrapCandidate = Pick<User, "role" | "accessStatus" | "emailVerifiedAt" | "telegramVerifiedAt"
  | "lockedAt" | "deletionRequestedAt" | "scheduledDeletionAt">;

export function validateBootstrapCandidate(user: BootstrapCandidate): void {
  if (user.role !== "USER" || user.accessStatus !== "ACTIVE" || user.lockedAt
    || user.deletionRequestedAt || user.scheduledDeletionAt) {
    throw new AdminBootstrapError("USER_NOT_ELIGIBLE", "Target must be an active, unlocked ordinary user with no pending deletion.");
  }
  if (!user.emailVerifiedAt || !user.telegramVerifiedAt) {
    throw new AdminBootstrapError("USER_NOT_VERIFIED", "Target must complete both email and Telegram verification first.");
  }
}

// Deployment-only operation. No HTTP handler or startup hook calls this function.
export async function bootstrapFirstAdmin(userId: string, database: PrismaClient = prisma): Promise<{ userId: string; role: "ADMIN" }> {
  if (!isUuid(userId)) throw new AdminBootstrapError("INVALID_USER_ID", "Provide an existing user's UUID with --user-id.");
  const targetId = userId.toLowerCase();
  return database.$transaction(async (transaction) => {
    await lockAdminRoleChanges(transaction);
    // Count ALL admins: suspension/deletion must never reopen bootstrapping.
    if (await transaction.user.count({ where: { role: "ADMIN" } }) !== 0) {
      throw new AdminBootstrapError("ADMIN_ALREADY_EXISTS", "An administrator already exists. Use the normal admin-management workflow.");
    }
    if (await transaction.userAuditLog.findFirst({ where: { action: FIRST_ADMIN_BOOTSTRAPPED }, select: { id: true } })) {
      throw new AdminBootstrapError("BOOTSTRAP_ALREADY_COMPLETED", "First-admin bootstrap has already been completed. Use the controlled account-recovery process.");
    }
    await lockVerificationUser(transaction, targetId);
    const user = await transaction.user.findUnique({ where: { id: targetId }, select: {
      id: true, role: true, accessStatus: true, emailVerifiedAt: true, telegramVerifiedAt: true,
      lockedAt: true, deletionRequestedAt: true, scheduledDeletionAt: true,
    } });
    if (!user) throw new AdminBootstrapError("USER_NOT_FOUND", "The specified user does not exist.");
    validateBootstrapCandidate(user);

    const now = new Date();
    await transaction.user.update({ where: { id: targetId }, data: { role: "ADMIN", authVersion: { increment: 1 } } });
    await transaction.authSession.updateMany({ where: { userId: targetId, revokedAt: null }, data: { revokedAt: now } });
    await transaction.passwordResetToken.updateMany({ where: { userId: targetId, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
    await transaction.userAuditLog.create({ data: {
      actorUserId: null, targetUserId: targetId, action: FIRST_ADMIN_BOOTSTRAPPED,
      reason: "First administrator assigned by privileged deployment command; no existing administrator",
    } });
    return { userId: targetId, role: "ADMIN" };
  });
}
