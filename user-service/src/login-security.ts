import { config } from "./config";
import { prisma } from "./db";
import { deletionIsDue } from "./account-lifecycle";
import { lockVerificationUser } from "./verification-events";

// Serialize failed attempts so concurrent requests cannot lose increments or
// each send a notification for the same transition into the locked state.
export async function recordFailedLogin(userId: string, observedPasswordHash: string): Promise<string | null> {
  return prisma.$transaction(async (transaction) => {
    await lockVerificationUser(transaction, userId);
    const current = await transaction.user.findUnique({ where: { id: userId } });
    if (!current || current.passwordHash !== observedPasswordHash || current.lockedAt
      || current.accessStatus === "SUSPENDED" || deletionIsDue(current)) return null;
    const attempts = current.failedLoginAttempts + 1;
    const lockedAt = attempts >= config.loginMaxAttempts ? new Date() : null;
    await transaction.user.update({ where: { id: userId }, data: { failedLoginAttempts: attempts, lockedAt } });
    return lockedAt ? current.email : null;
  });
}
