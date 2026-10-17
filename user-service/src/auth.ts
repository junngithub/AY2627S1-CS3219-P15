import type { Request } from "express";
import { prisma } from "./db";
import { AppError } from "./errors";
import { hashSessionToken } from "./security";
import { deletionIsDue } from "./account-lifecycle";

export function bearerToken(request: Request): string {
  const match = request.header("authorization")?.match(/^Bearer\s+(\S+)$/i);
  if (!match) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  return match[1];
}

export async function authenticatedUser(request: Request) {
  const tokenHash = hashSessionToken(bearerToken(request));
  const session = await prisma.authSession.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt <= new Date()
    || session.user.accessStatus === "SUSPENDED" || deletionIsDue(session.user)) {
    throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  }
  const touched = await prisma.authSession.updateMany({
    where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { lastUsedAt: new Date() },
  });
  if (touched.count !== 1) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  return session.user;
}
