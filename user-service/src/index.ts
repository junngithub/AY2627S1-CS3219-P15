import { createApp } from "./app";
import { config } from "./config";
import { prisma } from "./db";
import { KafkaUserEventPublisher } from "./kafka";
import { TelegramBotClient, TelegramPoller } from "./telegram";
import { VerificationEventDispatcher } from "./verification-events";
import { deleteExpiredAccounts } from "./account-lifecycle";

console.log(`Email delivery provider: ${config.email.provider}`);
if (config.email.provider === "disabled") console.warn("Email delivery is disabled; configure SES before enabling real signup/password recovery.");
const publisher = config.kafka.enabled ? new KafkaUserEventPublisher() : undefined;
const dispatcher = publisher ? new VerificationEventDispatcher(publisher) : undefined;
const telegram = config.telegram.botToken && process.env.TELEGRAM_POLLING_ENABLED !== "false"
  ? new TelegramPoller(new TelegramBotClient(config.telegram.botToken)) : undefined;
telegram?.start();
const verificationTimer = dispatcher ? setInterval(() => {
  void dispatcher.flush().catch(() => console.error("Verification event publication failed; queued for retry"));
}, 5000) : undefined;
let deletionSweep: Promise<unknown> | undefined;
const deletionTimer = setInterval(() => {
  if (deletionSweep) return;
  deletionSweep = deleteExpiredAccounts()
    .then((count) => { if (count) console.log(`Deleted ${count} expired user accounts`); })
    .catch(() => console.error("Account deletion sweep failed; retrying on the next interval"))
    .finally(() => { deletionSweep = undefined; });
}, config.deletionSweepIntervalSeconds * 1000);

const app = createApp(publisher);
const server = app.listen(config.port, () => {
  console.log(`User service running on port ${config.port}`);
});

// Warm the producer connection in the background; publishing also connects
// lazily, so a broker that is briefly unavailable at start-up is not fatal.
if (publisher) {
  publisher
    .connect()
    .then(() => console.log("Kafka producer connected"))
    .catch((error) => console.error("Kafka producer failed to connect:", error));
}

async function shutdown(): Promise<void> {
  if (verificationTimer) clearInterval(verificationTimer);
  clearInterval(deletionTimer);
  await telegram?.stop();
  server.close(async () => {
    await dispatcher?.flush().catch(() => undefined);
    await deletionSweep;
    if (publisher) {
      await publisher.disconnect().catch(() => undefined);
    }
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
