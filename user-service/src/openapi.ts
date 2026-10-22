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
      ResetPasswordRequest: {
        type: "object",
        required: ["token", "newPassword"],
        properties: {
          token: { type: "string", description: "Opaque token from the password reset link" },
          newPassword: { type: "string", format: "password", example: "NewSecurePass1" },
        },
      },
      NewPasswordRequest: {
        type: "object",
        required: ["newPassword"],
        properties: { newPassword: { type: "string", format: "password", example: "NewSecurePass1" } },
      },
      TelegramOtpRequest: {
        type: "object",
        required: ["otp"],
        properties: { otp: { type: "string", pattern: "^[0-9]{6}$", example: "123456" } },
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
        description: "Accepts configured NUS email domains and creates email and Telegram verification steps. Sends an OTP using the configured email provider. If delivery fails after account creation, the account remains unverified; use resend-verification rather than signing up again.",
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
          "503": {
            description: "EMAIL_DELIVERY_FAILED or EMAIL_NOT_CONFIGURED. The account may already exist unverified; request a replacement OTP after email delivery is available.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
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
        description: "Returns a generic 202 for a supplied email, even when email delivery fails, so account existence is not disclosed. Delivery failures are logged without OTPs; request again after the provider recovers.",
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
    "/api/v1/user/request-telegram-verification": {
      post: {
        tags: ["Authentication"],
        summary: "Request a Telegram verification code",
        description: "Requires login. Returns a private bot start link; in development without a bot, the OTP is logged. Requests have a 60-second cooldown.",
        security: [{ bearerAuth: [] }],
        responses: {
          "202": {
            description: "Verification challenge prepared (or already verified)",
            content: { "application/json": { schema: {
              type: "object", required: ["telegramBotUrl", "expiresAt"],
              properties: {
                telegramBotUrl: { type: "string", nullable: true, format: "uri" },
                expiresAt: { type: "string", nullable: true, format: "date-time" },
              },
            } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "429": { description: "Verification request cooldown" },
          "503": { description: "A production Telegram bot has not been configured" },
        },
      },
    },
    "/api/v1/user/verify-telegram": {
      post: {
        tags: ["Authentication"],
        summary: "Verify the signed-in user's Telegram OTP",
        description: "The user becomes Verified only when email is also verified. OTPs expire and have an attempt limit.",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: {
          "application/json": { schema: { $ref: "#/components/schemas/TelegramOtpRequest" } },
        } },
        responses: {
          "200": { description: "Telegram verified or already verified", content: {
            "application/json": { schema: { $ref: "#/components/schemas/StatusResponse" } },
          } },
          "400": { description: "Invalid or expired OTP", content: {
            "application/json": { schema: { $ref: "#/components/schemas/Error" } },
          } },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "409": { description: "Telegram account already linked to another user" },
        },
      },
    },
    "/api/v1/user/forgot-password": {
      post: {
        tags: ["Authentication"],
        summary: "Request a password reset link",
        description: "Returns the same 202 whether the account exists or email delivery fails. SES sends a single-use reset link; development mode logs it locally. Request again after a delivery failure.",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/EmailRequest" } },
          },
        },
        responses: {
          "202": { description: "Request accepted; account existence is not disclosed" },
          "400": {
            description: "Email missing",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/v1/user/reset-password": {
      post: {
        tags: ["Authentication"],
        summary: "Set a new password using a single-use reset token",
        description: "Consumes a 30-minute token (configurable), unlocks the account and revokes existing sessions.",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ResetPasswordRequest" } },
          },
        },
        responses: {
          "200": { description: "Password reset successful" },
          "400": {
            description: "Missing fields, invalid password, or invalid/expired token",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
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
    "/api/v1/user/internal/authorize": {
      post: {
        tags: ["User"],
        summary: "Validate a session for another service",
        description:
          "Internal only: blocked at public proxies. Called directly by the API gateway for every protected request, with the client's HTTP method and no body, so every method is accepted (POST shown). Still requires the user's bearer session after removal of the separate Order lookup secret. The gateway reads only the status and the identity headers. Responses are never cached. /api/v1/user/authorize remains a temporary, externally blocked compatibility alias during caller migration.",
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
      delete: {
        tags: ["User"], summary: "Schedule account deletion in six calendar months",
        description: "Requires explicit confirmation. Revokes sessions immediately; login before the deadline cancels deletion. The last active admin is protected.",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", required: ["confirm"], properties: { confirm: { type: "boolean", enum: [true] } },
        } } } },
        responses: {
          "202": { description: "Scheduled; sessions revoked", content: { "application/json": { schema: {
            type: "object", required: ["message", "scheduledDeletionAt"],
            properties: { message: { type: "string" }, scheduledDeletionAt: { type: "string", format: "date-time" } },
          } } } },
          "400": { description: "Explicit confirmation missing" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "409": { description: "Last active administrator" },
        },
      },
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
    "/api/v1/user/internal/users/{userId}/telegram": {
      get: {
        tags: ["User"], summary: "Order Service: look up a verified user's Telegram handle",
        description: "Internal only. Caller authentication is enforced by Linkerd mTLS and an Order-only route policy, not an application shared token. The public gateway must block this path and unprotected ports must not bypass the mesh. Direct local calls have no caller authentication and are for isolated development only. Order must authorize order participation.",
        security: [],
        parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "Minimal contact details", content: { "application/json": { schema: {
            type: "object", required: ["userId", "telegramHandle"],
            properties: { userId: { type: "string", format: "uuid" }, telegramHandle: { type: "string", example: "example_user" } },
          } } } },
          "400": { description: "Invalid user UUID" },
          "404": { description: "User missing, suspended or past its deletion deadline" },
          "409": { description: "User not verified" },
        },
      },
    },
    "/api/v1/user/search": {
      get: {
        tags: ["User"], summary: "Admin Service: search users",
        description: "Admin Service must forward the real administrator's Authorization bearer session. Caller-supplied identity headers alone are not accepted. Matches name/email case-insensitively or an exact UUID. Page size is 20; expired deletion records are excluded.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "q", in: "query", schema: { type: "string", maxLength: 100, default: "" } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, maximum: 100000, default: 1 } },
        ],
        responses: {
          "200": { description: "{ items: [{ id, name, email, role: admin|user, status: Created|Verified|Suspended }], page, total }", content: {
            "application/json": { schema: { type: "object", required: ["items", "page", "total"], properties: {
              items: { type: "array", items: { type: "object", required: ["id", "name", "email", "role", "status"], properties: {
                id: { type: "string", format: "uuid" }, name: { type: "string" }, email: { type: "string", format: "email" },
                role: { type: "string", enum: ["admin", "user"] }, status: { $ref: "#/components/schemas/AccountStatus" },
              } } }, page: { type: "integer" }, total: { type: "integer" },
            } } },
          } },
          "400": { description: "Invalid q/page" }, "404": { description: "Missing/invalid session or caller is not an eligible admin" },
        },
      },
    },
    "/api/v1/user/{userId}/role": {
      post: {
        tags: ["User"], summary: "Admin Service: promote or demote a user",
        description: "Requires the real admin bearer session. Only verified active unlocked accounts can be promoted. Self-demotion and removal of the last available admin are rejected. Actual changes atomically revoke target sessions/reset links and append User audit; repeats return changed:false. Admin Service owns its own audit/events after a successful response.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", required: ["role"], properties: { role: { type: "string", enum: ["admin", "user"] } },
        } } } },
        responses: {
          "200": { description: "{ userId, role, status, changed }; role is lowercase, status is Created|Verified|Suspended" },
          "400": { description: "Invalid UUID/role or self-demotion" },
          "404": { description: "Caller not an eligible admin, invalid session, or user not found" },
          "409": { description: "LAST_ADMIN, USER_NOT_ELIGIBLE or USER_PENDING_DELETION" },
        },
      },
    },
    "/api/v1/user/{userId}/status": {
      post: {
        tags: ["User"], summary: "Admin Service: suspend or reinstate a user",
        description: "Requires the real admin bearer session. status:verified means remove suspension, not bypass OTP verification; response may be Created if verification is unfinished. Suspension revokes sessions, reset links and challenges. Last-admin protection and atomic User audit apply. Reinstatement does not unlock password lockout or grant credits.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", required: ["status"], properties: { status: { type: "string", enum: ["suspended", "verified"] } },
        } } } },
        responses: {
          "200": { description: "{ userId, role, status, changed }; status reflects actual verification after reinstatement" },
          "400": { description: "Invalid UUID/status" },
          "404": { description: "Caller not an eligible admin, invalid session, or user not found" },
          "409": { description: "LAST_ADMIN or USER_PENDING_DELETION" },
        },
      },
    },
    "/api/v1/user/admin/users/{userId}/verify": {
      post: {
        tags: ["User"], summary: "Admin: verify a non-production load-test user",
        description: "Disabled by default. Requires ENABLE_TEST_VERIFICATION=true and a non-production APP_ENV, plus a verified admin bearer session. Records an audit reason and queues UserVerified idempotently. Does not promote roles or reinstate suspended accounts.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", required: ["reason"], properties: { reason: { type: "string", minLength: 3, maxLength: 500, example: "D3 load-test setup" } },
        } } } },
        responses: {
          "200": { description: "Verified or already verified", content: { "application/json": { schema: {
            type: "object", required: ["userId", "status", "nextSteps", "changed"], properties: {
              userId: { type: "string", format: "uuid" }, status: { $ref: "#/components/schemas/AccountStatus" },
              nextSteps: { type: "array", items: { type: "string" } }, changed: { type: "boolean" },
            },
          } } } },
          "400": { description: "Invalid user UUID or audit reason" },
          "404": { description: "Feature disabled, caller not a verified admin, or target not found" },
          "409": { description: "Target suspended or pending deletion" },
        },
      },
    },
    "/api/v1/user/me/password": {
      patch: {
        tags: ["User"], summary: "Change the signed-in user's password",
        description: "Keeps the current session, revokes other sessions and invalidates outstanding reset links.",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: {
          "application/json": { schema: { $ref: "#/components/schemas/NewPasswordRequest" } },
        } },
        responses: {
          "200": { description: "Password changed" },
          "400": { description: "Missing or invalid new password", content: {
            "application/json": { schema: { $ref: "#/components/schemas/Error" } },
          } },
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
