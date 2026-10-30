import { Prisma, type User } from "@prisma/client";
import { setTimeout as delay } from "node:timers/promises";
import { config } from "./config";
import { prisma } from "./db";
import { AppError } from "./errors";
import { generateOtp, generateSessionToken, hashSessionToken, hashTelegramOtp, normalizeTelegramHandle, safeHashEqual } from "./security";
import { enqueueUserVerified, lockVerificationUser } from "./verification-events";

export type TelegramUpdate = {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number; type: string };
    from?: { id: number; username?: string; is_bot?: boolean };
  };
};

export interface TelegramMessages {
  sendMessage(chatId: number, text: string): Promise<void>;
}

export class TelegramBotClient implements TelegramMessages {
  constructor(private token: string, private fetcher: typeof fetch = fetch) {}

  private async call<T>(method: string, body: unknown, signal?: AbortSignal): Promise<T> {
    try {
      const response = await this.fetcher(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body), signal: signal ?? AbortSignal.timeout(35_000),
      });
      const data = await response.json() as { ok?: boolean; result?: T };
      if (!response.ok || !data.ok) throw new Error("Telegram request failed");
      return data.result as T;
    } catch {
      // The API URL contains a credential, so never log a raw fetch error.
      throw new Error("Telegram request failed");
    }
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    await this.call("sendMessage", { chat_id: chatId, text }, AbortSignal.timeout(10_000));
  }

  getUpdates(offset: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
    return this.call("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] },
      AbortSignal.any([signal, AbortSignal.timeout(35_000)]));
  }
}

export async function requestTelegramVerification(user: User) {
  if (!config.telegram.development && !config.telegram.botToken) {
    throw new AppError(503, "TELEGRAM_NOT_CONFIGURED", "Telegram verification is temporarily unavailable");
  }
  const linkToken = generateSessionToken();
  const otp = config.telegram.development ? generateOtp() : null;
  const result = await prisma.$transaction(async (transaction) => {
    await lockVerificationUser(transaction, user.id);
    const current = await transaction.user.findUniqueOrThrow({ where: { id: user.id } });
    if (current.accessStatus === "SUSPENDED") throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    if (current.telegramVerifiedAt) return null;
    const latest = await transaction.telegramVerificationChallenge.findFirst({
      where: { userId: user.id }, orderBy: { createdAt: "desc" },
    });
    if (latest && latest.createdAt.getTime() > Date.now() - config.telegram.resendCooldownSeconds * 1000) {
      throw new AppError(429, "TELEGRAM_RESEND_COOLDOWN", "Wait before requesting another Telegram code");
    }
    await transaction.telegramVerificationChallenge.updateMany({
      where: { userId: user.id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() },
    });
    return transaction.telegramVerificationChallenge.create({
      data: {
        userId: user.id, linkHash: hashSessionToken(linkToken),
        expiresAt: new Date(Date.now() + config.otpTtlMinutes * 60_000),
        otpHash: otp ? hashTelegramOtp(user.id, otp, config.otpSecret) : null,
        sentAt: otp ? new Date() : null,
      },
    });
  });
  if (result && otp) {
    console.log(`[development telegram] Verification OTP for ${user.id} (@${user.telegramHandle}): ${otp}`);
  }
  return {
    telegramBotUrl: result && config.telegram.botToken
      ? `https://t.me/${config.telegram.botUsername}?start=${linkToken}` : null,
    expiresAt: result?.expiresAt.toISOString() ?? null,
  };
}

export async function verifyTelegramOtp(user: User, otp: string): Promise<User> {
  try {
    const verified = await prisma.$transaction(async (transaction) => {
      await lockVerificationUser(transaction, user.id);
      const current = await transaction.user.findUniqueOrThrow({ where: { id: user.id } });
      if (current.accessStatus === "SUSPENDED") throw new AppError(401, "UNAUTHORIZED", "Authentication required");
      if (current.telegramVerifiedAt) return current;
      const challenge = await transaction.telegramVerificationChallenge.findFirst({
        where: { userId: user.id, usedAt: null, revokedAt: null }, orderBy: { createdAt: "desc" },
      });
      const valid = challenge?.otpHash && challenge.sentAt && challenge.expiresAt > new Date()
        && challenge.attemptCount < config.otpMaxAttempts
        && (config.telegram.development || challenge.telegramUserId)
        && safeHashEqual(challenge.otpHash, hashTelegramOtp(user.id, otp, config.otpSecret));
      if (!valid || !challenge) {
        if (challenge) {
          await transaction.telegramVerificationChallenge.update({
            where: { id: challenge.id },
            data: {
              attemptCount: { increment: 1 },
              revokedAt: challenge.attemptCount + 1 >= config.otpMaxAttempts ? new Date() : undefined,
            },
          });
        }
        return null;
      }
      await transaction.telegramVerificationChallenge.update({ where: { id: challenge.id }, data: { usedAt: new Date() } });
      const updated = await transaction.user.update({
        where: { id: user.id },
        data: { telegramVerifiedAt: new Date(), telegramUserId: challenge.telegramUserId },
      });
      await enqueueUserVerified(transaction, updated);
      return updated;
    });
    if (!verified) throw new AppError(400, "INVALID_OTP", "Invalid or expired verification OTP");
    return verified;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(409, "TELEGRAM_ALREADY_REGISTERED", "Telegram account is already linked to another user");
    }
    throw error;
  }
}

export async function handleTelegramUpdate(update: TelegramUpdate, messages: TelegramMessages): Promise<void> {
  const message = update.message;
  if (!message || message.chat.type !== "private" || !message.from || message.from.is_bot) return;
  const match = message.text?.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{43})$/);
  if (!match) {
    await messages.sendMessage(message.chat.id, "Open the Telegram verification link from your Friends on Campus account.");
    return;
  }
  const challenge = await prisma.telegramVerificationChallenge.findUnique({
    where: { linkHash: hashSessionToken(match[1]) }, include: { user: true },
  });
  if (!challenge || challenge.usedAt || challenge.revokedAt || challenge.expiresAt <= new Date()
    || challenge.user.telegramVerifiedAt || challenge.user.accessStatus === "SUSPENDED") {
    await messages.sendMessage(message.chat.id, "This verification link is invalid or expired. Request another one in Friends on Campus.");
    return;
  }
  if (!message.from.username || normalizeTelegramHandle(message.from.username) !== challenge.user.telegramHandle) {
    await messages.sendMessage(message.chat.id, "Use the Telegram account with the handle supplied when you signed up.");
    return;
  }
  const otp = generateOtp();
  const otpHash = hashTelegramOtp(challenge.userId, otp, config.otpSecret);
  const claimed = await prisma.telegramVerificationChallenge.updateMany({
    where: { id: challenge.id, sentAt: null, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { otpHash, sentAt: new Date(), telegramUserId: String(message.from.id) },
  });
  if (claimed.count !== 1) {
    await messages.sendMessage(message.chat.id, "Use the code already sent, or request a new verification link in Friends on Campus.");
    return;
  }
  try {
    await messages.sendMessage(message.chat.id, `Your Friends on Campus verification code is ${otp}. Enter it in the app before the verification link expires.`);
  } catch (error) {
    await prisma.telegramVerificationChallenge.updateMany({
      where: { id: challenge.id, otpHash, usedAt: null }, data: { otpHash: null, sentAt: null, telegramUserId: null },
    });
    throw error;
  }
}

export class TelegramPoller {
  private controller = new AbortController();
  private running?: Promise<void>;
  constructor(private client: TelegramBotClient) {}
  start(): void { this.running ??= this.poll(); }
  async stop(): Promise<void> { this.controller.abort(); await this.running; }

  private async poll(): Promise<void> {
    let offset = 0;
    while (!this.controller.signal.aborted) {
      try {
        for (const update of await this.client.getUpdates(offset, this.controller.signal)) {
          await handleTelegramUpdate(update, this.client);
          offset = update.update_id + 1;
        }
      } catch {
        if (this.controller.signal.aborted) break;
        console.error("Telegram polling failed; retrying");
        await delay(1000, undefined, { signal: this.controller.signal }).catch(() => undefined);
      }
    }
  }
}
