import { Prisma, type User } from "@prisma/client";
import type { Request } from "express";
import { authenticatedUser, bearerToken } from "./auth";
import { lockAdminRoleChanges, otherAvailableAdmins } from "./admin-role-lock";
import { prisma } from "./db";
import { AppError } from "./errors";
import { isUuid } from "./integration-access";
import { hashSessionToken } from "./security";
import { accountStatus } from "./status";
import { lockVerificationUser } from "./verification-events";

export const ADMIN_SEARCH_PAGE_SIZE = 20;
const hidden = () => new AppError(404, "NOT_FOUND", "Endpoint not found");

type Administrator = { userId: string; tokenHash: string };

export function eligibleAdministrator(user: Pick<User, "role" | "accessStatus" | "emailVerifiedAt" | "telegramVerifiedAt"
  | "lockedAt" | "deletionRequestedAt" | "scheduledDeletionAt">): boolean {
  return user.role === "ADMIN" && user.accessStatus === "ACTIVE" && !!user.emailVerifiedAt
    && !!user.telegramVerifiedAt && !user.lockedAt && !user.deletionRequestedAt && !user.scheduledDeletionAt;
}

export async function requireAdministrator(request: Request): Promise<Administrator> {
  try {
    const user = await authenticatedUser(request);
    if (!eligibleAdministrator(user)) throw hidden();
    return { userId: user.id, tokenHash: hashSessionToken(bearerToken(request)) };
  } catch (error) {
    if (error instanceof AppError && error.status === 401) throw hidden();
    throw error;
  }
}

async function assertCurrentAdministrator(transaction: Prisma.TransactionClient, actor: Administrator): Promise<void> {
  const user = await transaction.user.findUnique({ where: { id: actor.userId } });
  const session = await transaction.authSession.findUnique({ where: { tokenHash: actor.tokenHash } });
  if (!user || !eligibleAdministrator(user) || !session || session.userId !== actor.userId
    || session.revokedAt || session.expiresAt <= new Date()) throw hidden();
}

export function parseAdminSearch(q: unknown, page: unknown): { q: string; page: number } {
  if (q !== undefined && (typeof q !== "string" || q.length > 100)) {
    throw new AppError(400, "INVALID_QUERY", "q must be a string of at most 100 characters");
  }
  if (page !== undefined && (typeof page !== "string" || !/^[1-9]\d{0,5}$/.test(page) || Number(page) > 100_000)) {
    throw new AppError(400, "INVALID_PAGE", "page must be an integer between 1 and 100000");
  }
  return { q: typeof q === "string" ? q.trim() : "", page: page === undefined ? 1 : Number(page) };
}

function summary(user: User) {
  return { id: user.id, name: user.name, email: user.email, role: user.role.toLowerCase(), status: accountStatus(user) };
}

export async function searchUsers(actor: Administrator, options: { q: string; page: number }) {
  return prisma.$transaction(async (transaction) => {
    await assertCurrentAdministrator(transaction, actor);
    const where: Prisma.UserWhereInput = {
      AND: [
        { OR: [{ scheduledDeletionAt: null }, { scheduledDeletionAt: { gt: new Date() } }] },
        ...(options.q ? [{ OR: [
          { name: { contains: options.q, mode: "insensitive" as const } },
          { email: { contains: options.q, mode: "insensitive" as const } },
          ...(isUuid(options.q) ? [{ id: options.q.toLowerCase() }] : []),
        ] }] : []),
      ],
    };
    const users = await transaction.user.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (options.page - 1) * ADMIN_SEARCH_PAGE_SIZE, take: ADMIN_SEARCH_PAGE_SIZE });
    const total = await transaction.user.count({ where });
    return { items: users.map(summary), page: options.page, total };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export type AdminChange = { kind: "role"; value: "admin" | "user" } | { kind: "status"; value: "suspended" | "verified" };

export function parseAdminChange(kind: "role" | "status", body: unknown): AdminChange {
  const value = body && typeof body === "object" ? (body as Record<string, unknown>)[kind] : undefined;
  if (kind === "role" && (value === "admin" || value === "user")) return { kind, value };
  if (kind === "status" && (value === "suspended" || value === "verified")) return { kind, value };
  throw new AppError(400, kind === "role" ? "INVALID_ROLE" : "INVALID_STATUS",
    kind === "role" ? "role must be admin or user" : "status must be suspended or verified");
}

async function revokeCredentials(transaction: Prisma.TransactionClient, userId: string, suspend: boolean, now: Date) {
  await transaction.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
  await transaction.passwordResetToken.updateMany({ where: { userId, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
  if (suspend) {
    await transaction.emailVerificationOtp.updateMany({ where: { userId, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
    await transaction.telegramVerificationChallenge.updateMany({ where: { userId, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
  }
}

export async function changeUser(actor: Administrator, targetId: string, change: AdminChange) {
  if (!isUuid(targetId)) throw new AppError(400, "INVALID_USER_ID", "A valid user UUID is required");
  const userId = targetId.toLowerCase();
  return prisma.$transaction(async (transaction) => {
    // Same lock as bootstrap/deletion. All actor/target rows lock in UUID order.
    await lockAdminRoleChanges(transaction);
    for (const id of [...new Set([actor.userId, userId])].sort()) await lockVerificationUser(transaction, id);
    await assertCurrentAdministrator(transaction, actor);
    const target = await transaction.user.findUnique({ where: { id: userId } });
    if (!target) throw new AppError(404, "USER_NOT_FOUND", "User not found");
    if (target.deletionRequestedAt || target.scheduledDeletionAt) {
      throw new AppError(409, "USER_PENDING_DELETION", "Users pending deletion cannot be changed by this operation");
    }
    const role = change.kind === "role" ? (change.value === "admin" ? "ADMIN" : "USER") : target.role;
    const accessStatus = change.kind === "status" ? (change.value === "suspended" ? "SUSPENDED" : "ACTIVE") : target.accessStatus;
    if (change.kind === "role" && change.value === "admin"
      && (accountStatus(target) !== "Verified" || target.lockedAt)) {
      throw new AppError(409, "USER_NOT_ELIGIBLE", "Only active, unlocked users with both verifications can be promoted");
    }
    if (target.role === "ADMIN" && (role !== "ADMIN" || accessStatus !== "ACTIVE")) {
      const remaining = await transaction.user.count({ where: otherAvailableAdmins(userId) });
      if (remaining === 0) throw new AppError(409, "LAST_ADMIN", "The last available administrator cannot be demoted or suspended");
    }
    if (change.kind === "role" && change.value === "user" && userId === actor.userId) {
      throw new AppError(400, "SELF_DEMOTION_FORBIDDEN", "Administrators cannot demote themselves");
    }
    if (target.role === role && target.accessStatus === accessStatus) {
      return { userId, role: role.toLowerCase(), status: accountStatus(target), changed: false };
    }
    const now = new Date();
    const updated = await transaction.user.update({ where: { id: userId }, data: {
      role, accessStatus, authVersion: { increment: 1 },
      ...(change.kind === "status" ? { suspendedAt: accessStatus === "SUSPENDED" ? now : null,
        suspensionReason: accessStatus === "SUSPENDED" ? "Suspended through administrator management" : null } : {}),
    } });
    await revokeCredentials(transaction, userId, accessStatus === "SUSPENDED", now);
    await transaction.userAuditLog.create({ data: { actorUserId: actor.userId, targetUserId: userId,
      action: change.kind === "role" ? "ADMIN_ROLE_CHANGED" : accessStatus === "SUSPENDED" ? "ADMIN_USER_SUSPENDED" : "ADMIN_USER_REINSTATED",
      reason: `Administrator requested ${change.kind}: ${change.value}`,
    } });
    // Reinstatement never fabricates verification timestamps or a credit event.
    return { userId, role: role.toLowerCase(), status: accountStatus(updated), changed: true };
  });
}
