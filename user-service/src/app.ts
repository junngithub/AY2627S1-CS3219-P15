import express from "express";
import swaggerUi from "swagger-ui-express";
import { errorHandler } from "./errors";
import { openApiDocument } from "./openapi";
import { createUsersRouter } from "./routes/users";

export function createApp() {
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

  app.use("/api/v1/user", createUsersRouter());

  app.use((_request, response) => {
    response.status(404).json({ error: "Endpoint not found", code: "NOT_FOUND" });
  });

  app.use(errorHandler);
  return app;
}
