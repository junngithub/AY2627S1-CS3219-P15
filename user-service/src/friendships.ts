import { Prisma, type Friendship, type User } from "@prisma/client";
import type { Request } from "express";
import { authenticatedUser, bearerToken } from "./auth";
import { prisma } from "./db";
import { AppError } from "./errors";
import { isUuid } from "./integration-access";
import { hashSessionToken } from "./security";
import { lockVerificationUser } from "./verification-events";

type Actor = { userId: string; tokenHash: string };
type Page = { page: number; pageSize: number };
type AccountAvailability = Pick<User, "accessStatus" | "deletionRequestedAt" | "scheduledDeletionAt">;
const publicUser = { id: true, name: true } as const;
const availableWhere = { accessStatus: "ACTIVE" as const, deletionRequestedAt: null, scheduledDeletionAt: null };
const notFound = () => new AppError(404, "FRIEND_REQUEST_NOT_FOUND", "Friend request not found");

export function parseFriendshipId(value: unknown): string {
  if (!isUuid(value)) throw new AppError(400, "INVALID_USER_ID", "A valid UUID is required");
  return value.toLowerCase();
}

export function parseFriendPage(page: unknown, pageSize: unknown): Page {
  function integer(value: unknown, fallback: number, max: number): number {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9]\d{0,5}$/.test(value) || Number(value) > max) {
      throw new AppError(400, "INVALID_PAGINATION", "Invalid page or pageSize");
    }
    return Number(value);
  }
  return { page: integer(page, 1, 100_000), pageSize: integer(pageSize, 20, 100) };
}

export function parseRequestDirection(value: unknown): "incoming" | "outgoing" {
  if (value === undefined) return "incoming";
  if (value !== "incoming" && value !== "outgoing") {
    throw new AppError(400, "INVALID_DIRECTION", "direction must be incoming or outgoing");
  }
  return value;
}

export function friendshipAccountAvailable(user: AccountAvailability): boolean {
  return user.accessStatus === "ACTIVE" && !user.deletionRequestedAt && !user.scheduledDeletionAt;
}

export async function friendshipActor(request: Request): Promise<Actor> {
  const user = await authenticatedUser(request);
  if (!friendshipAccountAvailable(user)) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  return { userId: user.id, tokenHash: hashSessionToken(bearerToken(request)) };
}

async function assertActor(transaction: Prisma.TransactionClient, actor: Actor): Promise<void> {
  const session = await transaction.authSession.findUnique({
    where: { tokenHash: actor.tokenHash },
    select: { userId: true, revokedAt: true, expiresAt: true, user: { select: {
      accessStatus: true, deletionRequestedAt: true, scheduledDeletionAt: true,
    } } },
  });
  if (!session || session.userId !== actor.userId || session.revokedAt || session.expiresAt <= new Date()
    || !friendshipAccountAvailable(session.user)) {
    throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  }
}

function pairWhere(a: string, b: string): Prisma.FriendshipWhereInput {
  return { OR: [{ senderId: a, recipientId: b }, { senderId: b, recipientId: a }] };
}

async function withParticipants<T>(actor: Actor, otherId: string,
  work: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    // Share account locks with suspension/deletion and serialize all operations
    // on either direction of a pair. Always use the same UUID lock order.
    for (const id of [...new Set([actor.userId, otherId])].sort()) await lockVerificationUser(transaction, id);
    await assertActor(transaction, actor);
    return work(transaction);
  });
}

function requestSummary(request: Friendship) {
  return { requestId: request.id, senderId: request.senderId, recipientId: request.recipientId,
    status: request.status.toLowerCase(), createdAt: request.createdAt };
}

export async function sendFriendRequest(actor: Actor, target: unknown) {
  const targetId = parseFriendshipId(target);
  if (targetId === actor.userId) throw new AppError(400, "SELF_FRIEND_REQUEST", "Cannot send a friend request to yourself");
  try {
    return await withParticipants(actor, targetId, async (transaction) => {
      const recipient = await transaction.user.findUnique({ where: { id: targetId }, select: {
        accessStatus: true, deletionRequestedAt: true, scheduledDeletionAt: true,
      } });
      if (!recipient || !friendshipAccountAvailable(recipient)) {
        throw new AppError(404, "USER_NOT_FOUND", "User not available");
      }
      const existing = await transaction.friendship.findFirst({ where: {
        ...pairWhere(actor.userId, targetId), status: { in: ["PENDING", "ACCEPTED"] },
      }, select: { id: true } });
      if (existing) throw new AppError(409, "FRIENDSHIP_ALREADY_EXISTS", "A request or friendship already exists");
      return requestSummary(await transaction.friendship.create({ data: { senderId: actor.userId, recipientId: targetId } }));
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(409, "FRIENDSHIP_ALREADY_EXISTS", "A request or friendship already exists");
    }
    throw error;
  }
}

export async function respondToFriendRequest(actor: Actor, requestIdInput: unknown, action: "accept" | "reject") {
  const requestId = parseFriendshipId(requestIdInput);
  const candidate = await prisma.friendship.findUnique({ where: { id: requestId }, select: { senderId: true, recipientId: true } });
  // Do not reveal whether a private request exists to unrelated callers.
  if (!candidate || candidate.recipientId !== actor.userId) throw notFound();
  return withParticipants(actor, candidate.senderId, async (transaction) => {
    const request = await transaction.friendship.findUnique({ where: { id: requestId } });
    if (!request || request.recipientId !== actor.userId) throw notFound();
    const desired = action === "accept" ? "ACCEPTED" : "REJECTED";
    if (request.status !== "PENDING" && request.status !== desired) {
      throw new AppError(409, "FRIEND_REQUEST_NOT_PENDING", "Friend request is no longer pending");
    }
    if (action === "accept") {
      const sender = await transaction.user.findUnique({ where: { id: request.senderId }, select: {
        accessStatus: true, deletionRequestedAt: true, scheduledDeletionAt: true,
      } });
      if (!sender || !friendshipAccountAvailable(sender)) {
        throw new AppError(409, "USER_NOT_AVAILABLE", "The other account is not available");
      }
    }
    const changed = request.status === "PENDING";
    if (changed) await transaction.friendship.update({ where: { id: requestId }, data: { status: desired } });
    return { requestId, status: desired.toLowerCase(), changed };
  });
}

export async function removeFriend(actor: Actor, friendIdInput: unknown): Promise<void> {
  const friendId = parseFriendshipId(friendIdInput);
  await withParticipants(actor, friendId, async (transaction) => {
    // Idempotent removal; it cannot cancel a pending invitation or modify a
    // relationship between two different people. Keep rejected/removed history.
    await transaction.friendship.updateMany({ where: {
      ...pairWhere(actor.userId, friendId), status: "ACCEPTED",
    }, data: { status: "REMOVED" } });
  });
}

export async function listFriends(actor: Actor, page: Page) {
  return prisma.$transaction(async (transaction) => {
    await assertActor(transaction, actor);
    const where: Prisma.FriendshipWhereInput = { status: "ACCEPTED", OR: [
      { senderId: actor.userId, recipient: availableWhere },
      { recipientId: actor.userId, sender: availableWhere },
    ] };
    const [total, rows] = await Promise.all([
      transaction.friendship.count({ where }),
      transaction.friendship.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page.page - 1) * page.pageSize, take: page.pageSize,
        select: { senderId: true, sender: { select: publicUser }, recipient: { select: publicUser } } }),
    ]);
    return { items: rows.map((row) => row.senderId === actor.userId ? row.recipient : row.sender), ...page, total };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function listFriendRequests(actor: Actor, direction: "incoming" | "outgoing", page: Page) {
  return prisma.$transaction(async (transaction) => {
    await assertActor(transaction, actor);
    const where: Prisma.FriendshipWhereInput = { status: "PENDING", ...(direction === "incoming"
      ? { recipientId: actor.userId, sender: availableWhere } : { senderId: actor.userId, recipient: availableWhere }) };
    const [total, rows] = await Promise.all([
      transaction.friendship.count({ where }),
      transaction.friendship.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page.page - 1) * page.pageSize, take: page.pageSize,
        select: { id: true, createdAt: true, sender: { select: publicUser }, recipient: { select: publicUser } } }),
    ]);
    return { items: rows.map((row) => ({ requestId: row.id, status: "pending", createdAt: row.createdAt,
      sender: row.sender, recipient: row.recipient })), ...page, total };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
