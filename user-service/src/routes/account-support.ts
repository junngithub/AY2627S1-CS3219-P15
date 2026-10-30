import { Router } from "express";
import { authenticatedUser, bearerToken } from "../auth";
import type { AdminIntake } from "../admin-intake";
import { AppealAttemptLimiter, supportText } from "../account-support";
import { deletionIsDue } from "../account-lifecycle";
import { config } from "../config";
import { prisma } from "../db";
import { AppError } from "../errors";
import { asyncHandler } from "../http";
import { isUuid } from "../integration-access";
import { hashPassword, hashSessionToken, normalizeEmail, verifyPassword } from "../security";
import { lockVerificationUser } from "../verification-events";

const genericFailure = () => new AppError(401, "INVALID_CREDENTIALS", "Wrong password or user not found");
const unauthorized = () => new AppError(401, "UNAUTHORIZED", "Authentication required");

export function createAccountSupportRouter(admin: AdminIntake, limiter = new AppealAttemptLimiter()): Router {
  const router = Router();
  let dummyHash: Promise<string> | undefined;

  router.post("/reports", asyncHandler(async (request, response) => {
    response.set("Cache-Control", "no-store");
    const actor = await authenticatedUser(request);
    const reportedUserId = request.body?.reportedUserId;
    if (!isUuid(reportedUserId)) throw new AppError(400, "INVALID_USER_ID", "A valid reported user UUID is required");
    const targetId = reportedUserId.toLowerCase();
    if (targetId === actor.id) throw new AppError(400, "SELF_REPORT", "You cannot report yourself");
    const comment = supportText(request.body?.comment, "comment");
    const tokenHash = hashSessionToken(bearerToken(request));
    const input = await prisma.$transaction(async (transaction) => {
      for (const id of [...new Set([actor.id, targetId])].sort()) await lockVerificationUser(transaction, id);
      const session = await transaction.authSession.findUnique({ where: { tokenHash }, include: { user: true } });
      if (!session || session.userId !== actor.id || session.revokedAt || session.expiresAt <= new Date()
        || session.user.accessStatus === "SUSPENDED" || session.user.deletionRequestedAt || session.user.scheduledDeletionAt) throw unauthorized();
      const target = await transaction.user.findUnique({ where: { id: targetId }, select: { scheduledDeletionAt: true } });
      if (!target || deletionIsDue(target)) throw new AppError(404, "USER_NOT_FOUND", "User not found");
      return { reporterUserId: actor.id, reportedUserId: targetId, comment };
    });
    // No account lock is held over HTTP; Admin owns the report transaction.
    response.status(201).json(await admin.report(input));
  }));

  router.post("/appeals", asyncHandler(async (request, response) => {
    response.set("Cache-Control", "no-store");
    const emailInput = typeof request.body?.email === "string" ? request.body.email.trim() : "";
    const password = typeof request.body?.password === "string" ? request.body.password.trim() : "";
    if (!emailInput || emailInput.length > 320 || !password) throw genericFailure();
    const email = normalizeEmail(emailInput);
    limiter.check(hashSessionToken(email)); // No raw email/password stored in the limiter.
    const message = supportText(request.body?.message, "message");
    const user = await prisma.user.findUnique({ where: { email } });
    const matches = await verifyPassword(password, user?.passwordHash
      ?? await (dummyHash ??= hashPassword("NotARealSupportPassword123", config.passwordScryptCost)));
    if (!user || !matches || user.lockedAt || deletionIsDue(user)) throw genericFailure();
    const input = await prisma.$transaction(async (transaction) => {
      await lockVerificationUser(transaction, user.id);
      const current = await transaction.user.findUnique({ where: { id: user.id } });
      if (!current || current.passwordHash !== user.passwordHash || current.lockedAt || deletionIsDue(current)) throw genericFailure();
      if (current.accessStatus !== "SUSPENDED") throw new AppError(409, "ACCOUNT_NOT_SUSPENDED", "Only suspended accounts can submit an appeal");
      return { userId: current.id, message };
    });
    // No session is created, no suspension cleared and no password forwarded.
    response.status(201).json(await admin.appeal(input));
  }));
  return router;
}
