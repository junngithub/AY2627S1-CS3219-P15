CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'REMOVED');

CREATE TABLE "Friendship" (
    "id" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Friendship_not_self" CHECK ("senderId" <> "recipientId"),
    CONSTRAINT "Friendship_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Friendship_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Friendship_senderId_status_createdAt_id_idx" ON "Friendship"("senderId", "status", "createdAt", "id");
CREATE INDEX "Friendship_recipientId_status_createdAt_id_idx" ON "Friendship"("recipientId", "status", "createdAt", "id");

-- A -> B and B -> A must not coexist while pending or accepted. Rejected and
-- removed requests remain history; a later invitation receives a fresh UUID.
CREATE UNIQUE INDEX "Friendship_active_pair_key" ON "Friendship" (
    LEAST("senderId", "recipientId"), GREATEST("senderId", "recipientId")
) WHERE "status" IN ('PENDING', 'ACCEPTED');
