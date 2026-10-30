import express from "express";
import swaggerUi from "swagger-ui-express";
import { errorHandler } from "./errors";
import type { UserEventPublisher } from "./events";
import { openApiDocument } from "./openapi";
import { createUsersRouter } from "./routes/users";
import { createUserIntegrationRouter } from "./routes/user-integration";
import type { EmailSender } from "./email";
import { createAdminUsersRouter } from "./routes/admin-users";
import { createFriendshipsRouter } from "./routes/friendships";
import { createAccountSupportRouter } from "./routes/account-support";
import { HttpAdminIntake, type AdminIntake } from "./admin-intake";
import { config } from "./config";

export function createApp(eventPublisher?: UserEventPublisher, emailSender?: EmailSender,
  adminIntake: AdminIntake = new HttpAdminIntake(config.admin.baseUrl, config.admin.timeoutMs)) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_request, response) => {
    response.status(200).json({ service: "user-service", status: "ok" });
  });

  app.get("/api-docs.json", (_request, response) => {
    response.status(200).json(openApiDocument);
  });
  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: "Friends on Campus - User Service API",
      swaggerOptions: { persistAuthorization: true },
    }),
  );

  app.use("/api/v1/user", createUsersRouter(emailSender, eventPublisher));
  app.use("/api/v1/user", createUserIntegrationRouter());
  app.use("/api/v1/user", createAdminUsersRouter());
  app.use("/api/v1/user/friends", createFriendshipsRouter());
  app.use("/api/v1/user", createAccountSupportRouter(adminIntake));

  app.use((_request, response) => {
    response.status(404).json({ error: "Endpoint not found", code: "NOT_FOUND" });
  });

  app.use(errorHandler);
  return app;
}
