import { Router } from "express";
import { authenticatedUser, bearerToken } from "../auth";
import { authorizationResult } from "../authorization";
import { deletionIsDue } from "../account-lifecycle";
import { config } from "../config";
import { prisma } from "../db";
import { AppError } from "../errors";
import { asyncHandler } from "../http";
import { isUuid, serviceTokenMatches } from "../integration-access";
import { hashSessionToken } from "../security";
import { accountNextSteps, accountStatus } from "../status";
import { enqueueUserVerified, lockVerificationUser } from "../verification-events";

const hidden = () => new AppError(404, "NOT_FOUND", "Endpoint not found");

export function createUserIntegrationRouter(): Router {
  const router = Router();

  router.get("/internal/users/:userId/telegram", asyncHandler(async (request, response) => {
    if (!serviceTokenMatches(request.header("x-service-token"), config.orderUserLookupToken)) throw hidden();
    const userId = request.params.userId;
    if (!isUuid(userId)) throw new AppError(400, "INVALID_USER_ID", "A valid user UUID is required");
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.accessStatus === "SUSPENDED" || deletionIsDue(user)) {
      throw new AppError(404, "USER_NOT_FOUND", "User not found");
    }
    if (accountStatus(user) !== "Verified") {
      throw new AppError(409, "USER_NOT_VERIFIED", "User has not completed verification");
    }
    response.set("Cache-Control", "no-store").json({ userId: user.id, telegramHandle: user.telegramHandle });
  }));

  router.post("/admin/users/:userId/verify", asyncHandler(async (request, response) => {
    if (!config.testVerificationEnabled) throw hidden();
    const actor = await authenticatedUser(request).catch((error) => {
      if (error instanceof AppError && error.status === 401) throw hidden();
      throw error;
    });
    if (actor.role !== "ADMIN" || !authorizationResult(actor).permittedAction || actor.scheduledDeletionAt) throw hidden();
    const userId = request.params.userId;
    if (!isUuid(userId)) throw new AppError(400, "INVALID_USER_ID", "A valid user UUID is required");
    const reason = typeof request.body?.reason === "string" ? request.body.reason.trim() : "";
    if (reason.length < 3 || reason.length > 500) {
      throw new AppError(400, "INVALID_REASON", "A reason between 3 and 500 characters is required");
    }

    const result = await prisma.$transaction(async (transaction) => {
      for (const id of [...new Set([actor.id, userId])].sort()) await lockVerificationUser(transaction, id);
      const currentActor = await transaction.user.findUnique({ where: { id: actor.id } });
      const session = await transaction.authSession.findUnique({ where: { tokenHash: hashSessionToken(bearerToken(request)) } });
      if (!currentActor || currentActor.role !== "ADMIN" || !authorizationResult(currentActor).permittedAction
        || currentActor.scheduledDeletionAt || !session || session.revokedAt || session.expiresAt <= new Date()) throw hidden();
      const target = await transaction.user.findUnique({ where: { id: userId } });
      if (!target || deletionIsDue(target)) throw new AppError(404, "USER_NOT_FOUND", "User not found");
      if (target.accessStatus === "SUSPENDED" || target.scheduledDeletionAt) {
        throw new AppError(409, "USER_NOT_ELIGIBLE", "Suspended accounts or accounts pending deletion cannot be test-verified");
      }
      const changed = !target.emailVerifiedAt || !target.telegramVerifiedAt;
      const updated = changed ? await transaction.user.update({ where: { id: userId }, data: {
        emailVerifiedAt: target.emailVerifiedAt ?? new Date(),
        telegramVerifiedAt: target.telegramVerifiedAt ?? new Date(),
      } }) : target;
      if (changed) {
        await transaction.userAuditLog.create({ data: {
          actorUserId: actor.id, targetUserId: userId, action: "TEST_USER_VERIFIED", reason,
        } });
        await transaction.emailVerificationOtp.updateMany({ where: { userId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
        await transaction.telegramVerificationChallenge.updateMany({ where: { userId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await enqueueUserVerified(transaction, updated);
      return { userId, status: accountStatus(updated), nextSteps: accountNextSteps(updated), changed };
    });
    response.set("Cache-Control", "no-store").json(result);
  }));

  return router;
}
