CREATE TABLE "UserAuditLog" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "targetUserId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UserAuditLog_targetUserId_createdAt_idx" ON "UserAuditLog"("targetUserId", "createdAt");
