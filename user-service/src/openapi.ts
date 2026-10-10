export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Friends on Campus - User Service API",
    version: "1.0.0",
    description:
      "Authentication and onboarding endpoints implemented by the Friends on Campus User Service.",
  },
  servers: [
    {
      url: "http://localhost:8080",
      description: "Local Docker development server",
    },
  ],
  tags: [
    { name: "Service", description: "Service health" },
    { name: "Authentication", description: "Public signup, verification and login operations" },
    { name: "User", description: "Authenticated user operations" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "Opaque session token",
        description: "Paste the token returned by POST /api/v1/user/login.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error", "code"],
        properties: {
          error: { type: "string", example: "Human-readable error message" },
          code: { type: "string", example: "MACHINE_READABLE_CODE" },
        },
      },
      AccountStatus: {
        type: "string",
        enum: ["Created", "Verified", "Suspended"],
      },
      NextStep: {
        type: "string",
        enum: ["VERIFY_EMAIL", "VERIFY_TELEGRAM", "CONTACT_ADMIN", "CANCEL_PENDING_DELETION"],
      },
      StatusResponse: {
        type: "object",
        required: ["status", "nextSteps"],
        properties: {
          status: { $ref: "#/components/schemas/AccountStatus" },
          nextSteps: {
            type: "array",
            items: { $ref: "#/components/schemas/NextStep" },
          },
        },
      },
      SignupRequest: {
        type: "object",
        required: ["name", "email", "password", "telegramHandle"],
        properties: {
          name: {
            type: "string",
            minLength: 2,
            maxLength: 100,
            description: "The user's immutable display name.",
            example: "Alex Tan",
          },
          email: { type: "string", format: "email", example: "e1234567@u.nus.edu" },
          password: { type: "string", format: "password", example: "SecurePass1" },
          telegramHandle: { type: "string", example: "alex_tan" },
        },
      },
      SignupResponse: {
        type: "object",
        required: ["userId", "email", "status", "nextSteps"],
        properties: {
          userId: { type: "string", format: "uuid" },
          email: { type: "string", format: "email" },
          status: { $ref: "#/components/schemas/AccountStatus" },
          nextSteps: {
            type: "array",
            items: { $ref: "#/components/schemas/NextStep" },
          },
        },
      },
      EmailRequest: {
        type: "object",
        required: ["email"],
        properties: {
          email: { type: "string", format: "email", example: "e1234567@u.nus.edu" },
        },
      },
      VerifyEmailRequest: {
        type: "object",
        required: ["email", "otp"],
        properties: {
          email: { type: "string", format: "email", example: "e1234567@u.nus.edu" },
          otp: { type: "string", pattern: "^[0-9]{6}$", example: "123456" },
        },
      },
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email", example: "e1234567@u.nus.edu" },
          password: { type: "string", format: "password", example: "SecurePass1" },
        },
      },
      UserSummary: {
        type: "object",
        required: ["id", "name", "email", "status"],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string", example: "Alex Tan" },
          email: { type: "string", format: "email", example: "e1234567@u.nus.edu" },
          status: { $ref: "#/components/schemas/AccountStatus" },
        },
      },
      LoginResponse: {
        type: "object",
        required: ["token", "tokenType", "expiresAt", "user"],
        properties: {
          token: { type: "string", description: "Opaque random session token" },
          tokenType: { type: "string", enum: ["Bearer"] },
          expiresAt: { type: "string", format: "date-time" },
          user: { $ref: "#/components/schemas/UserSummary" },
        },
      },
      Profile: {
        type: "object",
        required: ["id", "name", "email", "telegramHandle", "status", "isAdmin"],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string", example: "Alex Tan" },
          email: { type: "string", format: "email", example: "e1234567@u.nus.edu" },
          telegramHandle: { type: "string", example: "alex_tan" },
          status: { $ref: "#/components/schemas/AccountStatus" },
          isAdmin: { type: "boolean", example: false },
        },
      },
      AuthorizationResponse: {
        type: "object",
        required: ["authenticated", "userId", "isAdmin", "permittedAction"],
        properties: {
          authenticated: { type: "boolean", example: true },
          userId: { type: "string", format: "uuid" },
          isAdmin: { type: "boolean", example: false },
          permittedAction: {
            type: "boolean",
            description: "True when the account is active and both email and Telegram are verified.",
            example: false,
          },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: "Missing, expired or invalid session token",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: { error: "Authentication required", code: "UNAUTHORIZED" },
          },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["Service"],
        summary: "Check service health",
        responses: {
          "200": {
            description: "The service is running",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["service", "status"],
                  properties: {
                    service: { type: "string", example: "user-service" },
                    status: { type: "string", example: "ok" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/user/signup": {
      post: {
        tags: ["Authentication"],
        summary: "Create a user account",
        description: "Accepts configured NUS email domains and creates email and Telegram verification steps.",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/SignupRequest" } },
          },
        },
        responses: {
          "201": {
            description: "Account created",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/SignupResponse" } },
            },
          },
          "400": {
            description: "Invalid or missing signup details",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
          "409": {
            description: "Email or Telegram handle already registered",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
        },
      },
    },
    "/api/v1/user/verify-email": {
      post: {
        tags: ["Authentication"],
        summary: "Verify the email OTP",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/VerifyEmailRequest" } },
          },
        },
        responses: {
          "200": {
            description: "Email verified or already verified",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/StatusResponse" } },
            },
          },
          "400": {
            description: "OTP missing, invalid or expired",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
        },
      },
    },
    "/api/v1/user/resend-verification": {
      post: {
        tags: ["Authentication"],
        summary: "Request a replacement email OTP",
        description: "Always returns a generic response so account existence is not disclosed.",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/EmailRequest" } },
          },
        },
        responses: {
          "202": {
            description: "Request accepted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["message"],
                  properties: { message: { type: "string" } },
                },
              },
            },
          },
          "400": {
            description: "Email missing",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
        },
      },
    },
    "/api/v1/user/login": {
      post: {
        tags: ["Authentication"],
        summary: "Log in and create a session",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/LoginRequest" } },
          },
        },
        responses: {
          "200": {
            description: "Login successful",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/LoginResponse" } },
            },
          },
          "401": {
            description: "Generic login failure",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { error: "Wrong password or user not found", code: "INVALID_CREDENTIALS" },
              },
            },
          },
        },
      },
    },
    "/api/v1/user/authorize": {
      post: {
        tags: ["User"],
        summary: "Validate a session for another service",
        description:
          "Called by the API gateway for every protected request, with the client's HTTP method and no body, so every method is accepted (POST shown). The gateway reads only the status and the identity headers. Responses are never cached.",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Session is valid",
            headers: {
              "x-user-id": { schema: { type: "string", format: "uuid" } },
              "x-is-admin": { schema: { type: "string", enum: ["true", "false"] } },
              "x-permitted-action": { schema: { type: "string", enum: ["true", "false"] } },
              "Cache-Control": { schema: { type: "string", example: "no-store" } },
            },
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/AuthorizationResponse" } },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/v1/user/me": {
      get: {
        tags: ["User"],
        summary: "Get the signed-in user's profile",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "User profile",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Profile" } },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/v1/user/me/status": {
      get: {
        tags: ["User"],
        summary: "Get account status and remaining onboarding steps",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Current account status",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/StatusResponse" } },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
  },
};
