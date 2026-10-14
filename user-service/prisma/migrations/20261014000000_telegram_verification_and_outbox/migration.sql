ALTER TABLE "User" ADD COLUMN "telegramUserId" TEXT;
CREATE UNIQUE INDEX "User_telegramUserId_key" ON "User"("telegramUserId");

CREATE TABLE "TelegramVerificationChallenge" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "linkHash" TEXT NOT NULL,
    "otpHash" TEXT,
    "telegramUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TelegramVerificationChallenge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TelegramVerificationChallenge_linkHash_key" ON "TelegramVerificationChallenge"("linkHash");
CREATE INDEX "TelegramVerificationChallenge_userId_createdAt_idx" ON "TelegramVerificationChallenge"("userId", "createdAt");
CREATE INDEX "TelegramVerificationChallenge_expiresAt_idx" ON "TelegramVerificationChallenge"("expiresAt");
ALTER TABLE "TelegramVerificationChallenge" ADD CONSTRAINT "TelegramVerificationChallenge_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "UserVerifiedOutbox" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    CONSTRAINT "UserVerifiedOutbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserVerifiedOutbox_userId_key" ON "UserVerifiedOutbox"("userId");
CREATE INDEX "UserVerifiedOutbox_publishedAt_createdAt_idx" ON "UserVerifiedOutbox"("publishedAt", "createdAt");
ALTER TABLE "UserVerifiedOutbox" ADD CONSTRAINT "UserVerifiedOutbox_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
