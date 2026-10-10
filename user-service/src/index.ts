import { createApp } from "./app";
import { config } from "./config";
import { prisma } from "./db";

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`User service running on port ${config.port}`);
});

async function shutdown(): Promise<void> {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
