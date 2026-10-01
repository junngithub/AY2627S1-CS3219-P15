import express from "express";
import { errorHandler } from "./errors";
import { createUsersRouter } from "./routes/users";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_request, response) => {
    response.status(200).json({ service: "user-service", status: "ok" });
  });

  app.use("/api/v1/user", createUsersRouter());

  app.use((_request, response) => {
    response.status(404).json({ error: "Endpoint not found", code: "NOT_FOUND" });
  });

  app.use(errorHandler);
  return app;
}
