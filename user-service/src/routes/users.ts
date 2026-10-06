import { Prisma } from "@prisma/client";
import { NextFunction, Request, Response, Router } from "express";
import { authorizationResult, identityHeaders } from "../authorization";
import { config } from "../config";
import { prisma } from "../db";
import { DevelopmentEmailSender, EmailSender } from "../email";
import { AppError } from "../errors";
import {
  generateOtp,
  generateSessionToken,
  hashOtp,
  hashPassword,
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

type AsyncHandler = (request: Request, response: Response, next: NextFunction) => Promise<void>;

function asyncHandler(handler: AsyncHandler) {
  return (request: Request, response: Response, next: NextFunction): void => {
    handler(request, response, next).catch(next);
  };
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function bearerToken(request: Request): string {
  const authorization = request.header("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  return match[1];
}

async function authenticatedUser(request: Request) {
  const tokenHash = hashSessionToken(bearerToken(request));
  const session = await prisma.authSession.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= new Date() ||
    session.user.accessStatus === "SUSPENDED"
  ) {
    throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  }

  await prisma.authSession.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date() },
  });

  return session.user;
}

export function createUsersRouter(emailSender: EmailSender = new DevelopmentEmailSender()): Router {
  const router = Router();
  const dummyPasswordHash = hashPassword("NotARealPassword123", config.passwordScryptCost);

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

      if (user.emailVerifiedAt) {
        response.json({
          status: accountStatus(user),
          nextSteps: accountNextSteps(user),
        });
        return;
      }

      const otpRecord = await prisma.emailVerificationOtp.findFirst({
        where: { userId: user.id, usedAt: null, revokedAt: null },
        orderBy: { createdAt: "desc" },
      });

      const submittedHash = hashOtp(email, otp, config.otpSecret);
      const valid =
        otpRecord !== null &&
        otpRecord.expiresAt > new Date() &&
        otpRecord.attemptCount < config.otpMaxAttempts &&
        safeHashEqual(otpRecord.otpHash, submittedHash);

      if (!valid) {
        if (otpRecord) {
          const nextAttemptCount = otpRecord.attemptCount + 1;
          await prisma.emailVerificationOtp.update({
            where: { id: otpRecord.id },
            data: {
              attemptCount: nextAttemptCount,
              revokedAt: nextAttemptCount >= config.otpMaxAttempts ? new Date() : undefined,
            },
          });
        }
        throw new AppError(400, "INVALID_OTP", "Invalid or expired verification OTP");
      }

      const verifiedAt = new Date();
      const verifiedUser = await prisma.$transaction(async (transaction) => {
        await transaction.emailVerificationOtp.update({
          where: { id: otpRecord.id },
          data: { usedAt: verifiedAt },
        });
        return transaction.user.update({
          where: { id: user.id },
          data: { emailVerifiedAt: verifiedAt },
        });
      });

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
        user.accessStatus === "SUSPENDED"
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
