import { createApp } from "./app";
import { config } from "./config";
import { prisma } from "./db";
import { KafkaUserEventPublisher } from "./kafka";

const publisher = config.kafka.enabled ? new KafkaUserEventPublisher() : undefined;

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
  server.close(async () => {
    if (publisher) {
      await publisher.disconnect().catch(() => undefined);
    }
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
