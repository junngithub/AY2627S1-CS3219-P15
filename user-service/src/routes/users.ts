import { Prisma } from "@prisma/client";
import { Router } from "express";
import { authenticatedUser, bearerToken } from "../auth";
import { deletionIsDue, scheduleAccountDeletion } from "../account-lifecycle";
import { authorizationResult, identityHeaders } from "../authorization";
import { config } from "../config";
import { prisma } from "../db";
import { DevelopmentEmailSender, EmailSender } from "../email";
import type { UserEventPublisher } from "../events";
import { AppError } from "../errors";
import { asyncHandler } from "../http";
import {
  generateOtp,
  generatePasswordResetToken,
  generateSessionToken,
  hashOtp,
  hashPassword,
  hashPasswordResetToken,
  hashSessionToken,
  isAllowedEmail,
  isValidTelegramHandle,
  normalizeEmail,
  normalizeTelegramHandle,
  passwordValidationErrors,
  safeHashEqual,
  verifyPassword,
} from "../security";
import { accountNextSteps, accountStatus } from "../status";
import { requestTelegramVerification, verifyTelegramOtp } from "../telegram";
import { enqueueUserVerified, lockVerificationUser, VerificationEventDispatcher } from "../verification-events";

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function createUsersRouter(
  emailSender: EmailSender = new DevelopmentEmailSender(),
  eventPublisher?: UserEventPublisher,
): Router {
  const router = Router();
  const dummyPasswordHash = hashPassword("NotARealPassword123", config.passwordScryptCost);
  const dispatcher = eventPublisher ? new VerificationEventDispatcher(eventPublisher) : undefined;
  function publishPendingVerificationEvents(): void {
    void dispatcher?.flush().catch(() => console.error("Verification event publication failed; queued for retry"));
  }

  router.post(
    "/signup",
    asyncHandler(async (request, response) => {
      const emailInput = requiredString(request.body?.email);
      const password = requiredString(request.body?.password);
      const telegramInput = requiredString(request.body?.telegramHandle);
      const nameInput = requiredString(request.body?.name);

      if (!nameInput || !emailInput || !password || !telegramInput) {
        throw new AppError(
          400,
          "MISSING_FIELDS",
          "name, email, password and telegramHandle are required",
        );
      }

      if (nameInput.length < 2 || nameInput.length > 100) {
        throw new AppError(400, "INVALID_NAME", "Name must contain between 2 and 100 characters");
      }

      const email = normalizeEmail(emailInput);
      const telegramHandle = normalizeTelegramHandle(telegramInput);

      if (!isAllowedEmail(email, config.allowedEmailDomains)) {
        throw new AppError(400, "INVALID_EMAIL_DOMAIN", "A valid NUS email address is required");
      }

      const passwordErrors = passwordValidationErrors(password);
      if (passwordErrors.length > 0) {
        throw new AppError(
          400,
          "INVALID_PASSWORD",
          `Password ${passwordErrors.join(", ")}`,
        );
      }

      if (!isValidTelegramHandle(telegramHandle)) {
        throw new AppError(400, "INVALID_TELEGRAM_HANDLE", "Invalid Telegram handle");
      }

      const existing = await prisma.user.findFirst({
        where: { OR: [{ email }, { telegramHandle }] },
        select: { email: true, telegramHandle: true },
      });

      if (existing?.email === email) {
        throw new AppError(409, "EMAIL_ALREADY_REGISTERED", "Email is already registered");
      }
      if (existing?.telegramHandle === telegramHandle) {
        throw new AppError(
          409,
          "TELEGRAM_ALREADY_REGISTERED",
          "Telegram handle is already registered",
        );
      }

      const otp = generateOtp();
      const expiresAt = new Date(Date.now() + config.otpTtlMinutes * 60_000);
      const passwordHash = await hashPassword(password, config.passwordScryptCost);

      try {
        const user = await prisma.user.create({
          data: {
            email,
            name: nameInput,
            passwordHash,
            telegramHandle,
            emailOtps: {
              create: {
                otpHash: hashOtp(email, otp, config.otpSecret),
                expiresAt,
              },
            },
          },
        });

        await emailSender.sendVerificationOtp(email, otp, config.otpTtlMinutes);

        response.status(201).json({
          userId: user.id,
          email: user.email,
          status: accountStatus(user),
          nextSteps: accountNextSteps(user),
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new AppError(409, "ACCOUNT_ALREADY_EXISTS", "Account already exists");
        }
        throw error;
      }
    }),
  );

  router.post(
    "/verify-email",
    asyncHandler(async (request, response) => {
      const emailInput = requiredString(request.body?.email);
      const otp = requiredString(request.body?.otp);

      if (!emailInput || !otp || !/^\d{6}$/.test(otp)) {
        throw new AppError(400, "INVALID_OTP", "Invalid or expired verification OTP");
      }

      const email = normalizeEmail(emailInput);
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        throw new AppError(400, "INVALID_OTP", "Invalid or expired verification OTP");
      }

      const verifiedUser = await prisma.$transaction(async (transaction) => {
        await lockVerificationUser(transaction, user.id);
        const current = await transaction.user.findUniqueOrThrow({ where: { id: user.id } });
        if (current.emailVerifiedAt) return current;
        const otpRecord = await transaction.emailVerificationOtp.findFirst({
          where: { userId: user.id, usedAt: null, revokedAt: null }, orderBy: { createdAt: "desc" },
        });
        const valid = otpRecord && otpRecord.expiresAt > new Date()
          && otpRecord.attemptCount < config.otpMaxAttempts
          && safeHashEqual(otpRecord.otpHash, hashOtp(email, otp, config.otpSecret));
        if (!valid || !otpRecord) {
          if (otpRecord) {
            await transaction.emailVerificationOtp.update({
              where: { id: otpRecord.id },
              data: {
                attemptCount: { increment: 1 },
                revokedAt: otpRecord.attemptCount + 1 >= config.otpMaxAttempts ? new Date() : undefined,
              },
            });
          }
          return null;
        }
        const verifiedAt = new Date();
        await transaction.emailVerificationOtp.update({
          where: { id: otpRecord.id },
          data: { usedAt: verifiedAt },
        });
        const updated = await transaction.user.update({
          where: { id: user.id },
          data: { emailVerifiedAt: verifiedAt },
        });
        await enqueueUserVerified(transaction, updated);
        return updated;
      });

      if (!verifiedUser) throw new AppError(400, "INVALID_OTP", "Invalid or expired verification OTP");
      publishPendingVerificationEvents();

      response.json({
        status: accountStatus(verifiedUser),
        nextSteps: accountNextSteps(verifiedUser),
      });
    }),
  );

  router.post(
    "/resend-verification",
    asyncHandler(async (request, response) => {
      const emailInput = requiredString(request.body?.email);
      const acceptedResponse = {
        message: "If the account exists and is unverified, a new OTP has been sent",
      };

      if (!emailInput) {
        throw new AppError(400, "MISSING_EMAIL", "email is required");
      }

      const email = normalizeEmail(emailInput);
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || user.emailVerifiedAt) {
        response.status(202).json(acceptedResponse);
        return;
      }

      const otp = generateOtp();
      const expiresAt = new Date(Date.now() + config.otpTtlMinutes * 60_000);

      await prisma.$transaction([
        prisma.emailVerificationOtp.updateMany({
          where: { userId: user.id, usedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
        prisma.emailVerificationOtp.create({
          data: {
            userId: user.id,
            otpHash: hashOtp(email, otp, config.otpSecret),
            expiresAt,
          },
        }),
      ]);

      await emailSender.sendVerificationOtp(email, otp, config.otpTtlMinutes);
      response.status(202).json(acceptedResponse);
    }),
  );

  router.post(
    "/request-telegram-verification",
    asyncHandler(async (request, response) => {
      const user = await authenticatedUser(request);
      response.status(202).json(await requestTelegramVerification(user));
    }),
  );

  router.post(
    "/verify-telegram",
    asyncHandler(async (request, response) => {
      const user = await authenticatedUser(request);
      const otp = requiredString(request.body?.otp);
      if (!otp || !/^\d{6}$/.test(otp)) {
        throw new AppError(400, "INVALID_OTP", "Invalid or expired verification OTP");
      }
      const verifiedUser = await verifyTelegramOtp(user, otp);
      publishPendingVerificationEvents();
      response.json({ status: accountStatus(verifiedUser), nextSteps: accountNextSteps(verifiedUser) });
    }),
  );

  router.post(
    "/forgot-password",
    asyncHandler(async (request, response) => {
      const emailInput = requiredString(request.body?.email);
      if (!emailInput) {
        throw new AppError(400, "MISSING_EMAIL", "email is required");
      }

      // An unknown address gets the same answer as a known one.
      const acceptedResponse = { message: "If the account exists, a password reset link has been sent" };
      const email = normalizeEmail(emailInput);
      const user = await prisma.user.findUnique({ where: { email } });

      if (user) {
        const token = generatePasswordResetToken();
        const expiresAt = new Date(Date.now() + config.passwordResetTtlMinutes * 60_000);
        await prisma.$transaction([
          prisma.passwordResetToken.updateMany({
            where: { userId: user.id, usedAt: null, revokedAt: null },
            data: { revokedAt: new Date() },
          }),
          prisma.passwordResetToken.create({
            data: { userId: user.id, tokenHash: hashPasswordResetToken(token), expiresAt },
          }),
        ]);

        const link = new URL("/reset-password", config.frontendBaseUrl);
        link.searchParams.set("token", token);
        try {
          await emailSender.sendPasswordResetLink(email, link.toString(), config.passwordResetTtlMinutes);
        } catch (error) {
          // Do not reveal account existence through a delivery failure.
          console.error("[user email] failed to send password reset link:", error);
        }
      }

      response.set("Cache-Control", "no-store").status(202).json(acceptedResponse);
    }),
  );

  router.post(
    "/reset-password",
    asyncHandler(async (request, response) => {
      const token = requiredString(request.body?.token);
      const newPassword = requiredString(request.body?.newPassword);
      if (!token || !newPassword) {
        throw new AppError(400, "MISSING_FIELDS", "token and newPassword are required");
      }

      const passwordErrors = passwordValidationErrors(newPassword);
      if (passwordErrors.length > 0) {
        throw new AppError(400, "INVALID_PASSWORD", `Password ${passwordErrors.join(", ")}`);
      }

      const invalidToken = new AppError(400, "INVALID_RESET_TOKEN", "Invalid or expired reset link");
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalidToken;

      const tokenHash = hashPasswordResetToken(token);
      const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
      const now = new Date();
      if (!resetToken || resetToken.usedAt || resetToken.revokedAt || resetToken.expiresAt <= now) {
        throw invalidToken;
      }

      const passwordHash = await hashPassword(newPassword, config.passwordScryptCost);
      await prisma.$transaction(async (transaction) => {
        await lockVerificationUser(transaction, resetToken.userId);
        // Conditional update makes the token single-use even under concurrent requests.
        const claimed = await transaction.passwordResetToken.updateMany({
          where: { id: resetToken.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        });
        if (claimed.count !== 1) throw invalidToken;

        await transaction.user.update({
          where: { id: resetToken.userId },
          data: { passwordHash, failedLoginAttempts: 0, lockedAt: null, authVersion: { increment: 1 } },
        });
        await transaction.authSession.updateMany({
          where: { userId: resetToken.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await transaction.passwordResetToken.updateMany({
          where: { userId: resetToken.userId, id: { not: resetToken.id }, usedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      });

      response.set("Cache-Control", "no-store").json({ message: "Password reset successful" });
    }),
  );

  router.post(
    "/login",
    asyncHandler(async (request, response) => {
      const emailInput = requiredString(request.body?.email);
      const password = requiredString(request.body?.password);
      const genericFailure = new AppError(
        401,
        "INVALID_CREDENTIALS",
        "Wrong password or user not found",
      );

      if (!emailInput || !password) throw genericFailure;

      const email = normalizeEmail(emailInput);
      const user = await prisma.user.findUnique({ where: { email } });
      const passwordMatches = await verifyPassword(
        password,
        user?.passwordHash ?? (await dummyPasswordHash),
      );

      if (
        !user ||
        !passwordMatches ||
        user.lockedAt ||
        user.accessStatus === "SUSPENDED" ||
        deletionIsDue(user)
      ) {
        if (user && !passwordMatches && !user.lockedAt) {
          const attempts = user.failedLoginAttempts + 1;
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginAttempts: attempts,
              lockedAt: attempts >= config.loginMaxAttempts ? new Date() : null,
            },
          });
        }
        throw genericFailure;
      }

      const token = generateSessionToken();
      const expiresAt = new Date(Date.now() + config.sessionTtlHours * 60 * 60_000);
      const loggedInAt = new Date();

      const updatedUser = await prisma.$transaction(async (transaction) => {
        await lockVerificationUser(transaction, user.id);
        const current = await transaction.user.findUnique({ where: { id: user.id } });
        if (!current || current.passwordHash !== user.passwordHash || current.lockedAt
          || current.accessStatus === "SUSPENDED" || deletionIsDue(current)) throw genericFailure;
        if (current.scheduledDeletionAt) {
          await transaction.userAuditLog.create({ data: {
            actorUserId: user.id, targetUserId: user.id, action: "ACCOUNT_DELETION_CANCELLED", reason: "Owner logged in before deletion deadline",
          } });
        }
        const updated = await transaction.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: 0,
            lockedAt: null,
            lastLoginAt: loggedInAt,
            deletionRequestedAt: null,
            scheduledDeletionAt: null,
          },
        });
        await transaction.authSession.create({
          data: {
            userId: user.id,
            tokenHash: hashSessionToken(token),
            expiresAt,
          },
        });
        return updated;
      });

      response.json({
        token,
        tokenType: "Bearer",
        expiresAt: expiresAt.toISOString(),
        user: {
          id: updatedUser.id,
          name: updatedUser.name,
          email: updatedUser.email,
          status: accountStatus(updatedUser),
        },
      });
    }),
  );

  // The API gateway checks every protected request here, using the client's
  // method and no body, so any method is accepted. Identity goes out as
  // headers for the gateway and as JSON for other callers. Never cached, so a
  // suspension applies to the next request.
  router.all(
    "/authorize",
    asyncHandler(async (request, response) => {
      const result = authorizationResult(await authenticatedUser(request));
      response.set(identityHeaders(result)).set("Cache-Control", "no-store").json(result);
    }),
  );

  router.get(
    "/me",
    asyncHandler(async (request, response) => {
      const user = await authenticatedUser(request);
      response.json({
        id: user.id,
        name: user.name,
        email: user.email,
        telegramHandle: user.telegramHandle,
        status: accountStatus(user),
        isAdmin: user.role === "ADMIN",
      });
    }),
  );

  router.patch(
    "/me/password",
    asyncHandler(async (request, response) => {
      const user = await authenticatedUser(request);
      const newPassword = requiredString(request.body?.newPassword);
      if (!newPassword) throw new AppError(400, "MISSING_FIELDS", "newPassword is required");
      const errors = passwordValidationErrors(newPassword);
      if (errors.length) throw new AppError(400, "INVALID_PASSWORD", `Password ${errors.join(", ")}`);
      const passwordHash = await hashPassword(newPassword, config.passwordScryptCost);
      const currentTokenHash = hashSessionToken(bearerToken(request));
      await prisma.$transaction(async (transaction) => {
        await lockVerificationUser(transaction, user.id);
        const session = await transaction.authSession.findUnique({ where: { tokenHash: currentTokenHash } });
        const current = await transaction.user.findUniqueOrThrow({ where: { id: user.id } });
        if (!session || session.revokedAt || session.expiresAt <= new Date() || current.accessStatus === "SUSPENDED") {
          throw new AppError(401, "UNAUTHORIZED", "Authentication required");
        }
        await transaction.user.update({
          where: { id: user.id }, data: { passwordHash, authVersion: { increment: 1 } },
        });
        await transaction.authSession.updateMany({
          where: { userId: user.id, tokenHash: { not: currentTokenHash }, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await transaction.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() },
        });
      });
      response.set("Cache-Control", "no-store").json({ message: "Password changed successfully" });
    }),
  );

  router.delete(
    "/me",
    asyncHandler(async (request, response) => {
      const user = await authenticatedUser(request);
      if (request.body?.confirm !== true) {
        throw new AppError(400, "CONFIRMATION_REQUIRED", "Explicit confirmation is required to delete your account");
      }
      const deadline = await scheduleAccountDeletion(user);
      response.set("Cache-Control", "no-store").status(202).json({
        message: "Account scheduled for deletion. Log in before the deadline to cancel.",
        scheduledDeletionAt: deadline.toISOString(),
      });
    }),
  );

  router.get(
    "/me/status",
    asyncHandler(async (request, response) => {
      const user = await authenticatedUser(request);
      response.json({
        status: accountStatus(user),
        nextSteps: accountNextSteps(user),
      });
    }),
  );

  return router;
}
