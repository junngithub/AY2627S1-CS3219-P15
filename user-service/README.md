# User Service

Owns user registration, verification, authentication, profile status, account lifecycle, and friendships for Friends on Campus.

## Current implementation

- Express + TypeScript service on port `8080`
- PostgreSQL schema managed by Prisma
- Six-digit email OTPs (only hashes are stored)
- Password hashing with Node.js `scrypt` and a unique salt per password
- Opaque bearer sessions (only token hashes are stored)
- Generic login failures and lockout after a configurable number of failed attempts
- Account status and profile retrieval
- Interactive Swagger/OpenAPI documentation
- Docker Compose configuration for the service and its own PostgreSQL database

Email and Telegram verification, password recovery and profile password changes are implemented. Email delivery still uses the development logger. Telegram uses a real verification bot when configured, or a development logger when running locally without a bot. Account deletion, account escalation and friendship management remain to be implemented.

## Swagger API documentation

While the User Service is running, open:

```text
http://localhost:8080/api-docs
```

The Swagger page lists every currently implemented endpoint and allows requests to be tried from the browser. After logging in, copy the returned token, select **Authorize**, and paste the token to call protected endpoints. Swagger automatically adds the `Bearer` prefix.

The raw OpenAPI 3.0 document is available at:

```text
http://localhost:8080/api-docs.json
```

## API implemented

All errors use:

```json
{
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE"
}
```

### Health

```http
GET /health
```

### Sign up

```http
POST /api/v1/user/signup
Content-Type: application/json

{
  "name": "Joshua Tan",
  "email": "e1234567@u.nus.edu",
  "password": "SecurePass1",
  "telegramHandle": "joshuatan"
}
```

All four fields are required. The name must contain between 2 and 100 characters and is stored as the user's immutable display name. Student matriculation email prefixes are not used as names. Both `u.nus.edu` and `nus.edu.sg` email domains are accepted.

### Verify email OTP

```http
POST /api/v1/user/verify-email
Content-Type: application/json

{
  "email": "student@u.nus.edu",
  "otp": "123456"
}
```

In development, the OTP is printed in the User Service log. A real email provider has not been selected yet.

### Resend verification OTP

```http
POST /api/v1/user/resend-verification
Content-Type: application/json

{
  "email": "student@u.nus.edu"
}
```

The response does not reveal whether an account exists.

### Forgot/reset password

```http
POST /api/v1/user/forgot-password
Content-Type: application/json

{"email":"student@u.nus.edu"}
```

The service always responds with `202` for a supplied email, whether or not the account exists. In development, it prints a reset link to the User Service log. The link points to `FRONTEND_BASE_URL/reset-password?token=...`; set `FRONTEND_BASE_URL` to the deployed frontend origin outside local development. Links expire after 30 minutes by default and a new request invalidates older links.

```http
POST /api/v1/user/reset-password
Content-Type: application/json

{"token":"token-from-reset-link","newPassword":"NewSecurePass1"}
```

A successful reset consumes the link, unlocks the account and revokes existing sessions. The user must log in again. Run the new Prisma migration before deploying this version of the service.

### Login

```http
POST /api/v1/user/login
Content-Type: application/json

{
  "email": "student@u.nus.edu",
  "password": "SecurePass1"
}
```

Successful response:

```json
{
  "token": "opaque-random-token",
  "tokenType": "Bearer",
  "expiresAt": "2026-09-30T00:00:00.000Z",
  "user": {
    "id": "uuid",
    "name": "Joshua Tan",
    "email": "e1234567@u.nus.edu",
    "status": "Created"
  }
}
```

### Authorize

```http
POST /api/v1/user/authorize
Authorization: Bearer <token>
```

Successful response:

```http
HTTP/1.1 200 OK
x-user-id: uuid
x-is-admin: false
x-permitted-action: false
Cache-Control: no-store
```

```json
{
  "authenticated": true,
  "userId": "uuid",
  "isAdmin": false,
  "permittedAction": false
}
```

`permittedAction` becomes true when the account is active and both email and Telegram have been verified.

The API gateway calls `/authorize` for every protected request (see `infra/docs/adr/0007-envoy-gateway-extauth.md`), so:

- **Any method is accepted.** The gateway's check uses the client's method (`GET /api/v1/orders` is checked as `GET /authorize`) and sends no body.
- **Identity is in the headers.** The gateway ignores the JSON body and copies `x-user-id`, `x-is-admin` and `x-permitted-action` onto the request it forwards. The JSON is for other callers.
- **Nothing is cached**, so a suspension applies to the next request.

### Telegram verification

Log in first, then request a challenge:

```http
POST /api/v1/user/request-telegram-verification
Authorization: Bearer <token>
```

The `202` response contains `{ telegramBotUrl, expiresAt }`. With a configured bot, open the link in Telegram and press Start using the handle supplied during signup. The bot checks that handle before sending the six-digit OTP. In local development without a bot, `telegramBotUrl` is null and the OTP is printed in the service log. This fallback cannot verify an account in production. Requests have a 60-second cooldown; codes expire using `OTP_TTL_MINUTES` and are revoked after `OTP_MAX_ATTEMPTS` failures.

```http
POST /api/v1/user/verify-telegram
Authorization: Bearer <token>
Content-Type: application/json

{"otp":"123456"}
```

Returns `{ status, nextSteps }`. Email and Telegram can be verified in either order. Only after both succeed does the account become `Verified` and gain permitted actions. Telegram account IDs are uniquely linked, in addition to the existing unique handles.

To enable actual Telegram messages:

1. Create a bot through [Telegram's BotFather](https://core.telegram.org/bots/features#botfather), using `/newbot`.
2. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` in the ignored `user-service/.env` file. Use the username without `@`; never commit the token.
3. Recreate the service with `docker compose up -d --build`, then use the request/verify endpoints above.

The implementation uses outbound long polling, so local testing does not require AWS or a public webhook. Run **one poller per bot**: if User Service has several replicas, set `TELEGRAM_POLLING_ENABLED=false` on all but one poller, or arrange a dedicated worker. Each environment should have its own bot. Production deployments must inject credentials through their secret configuration.

### Verification event and Credit integration

The `UserVerified` event is saved atomically in `UserVerifiedOutbox` after both verification checks. Email verification alone no longer publishes it. When Kafka is configured, a worker retries pending rows every five seconds and marks them published only after Kafka acknowledges the send. If Kafka is disabled, rows remain pending. Retries preserve the event ID and occurrence time; Credit must continue to handle duplicates idempotently.

The wire format remains compatible with the currently merged Credit consumer: `{ eventId, type: "UserVerified", occurredAt, data: { userId, email } }` on `foc.user.status`, keyed by user ID. Align the central contract with the team before changing that envelope. Local Compose tests do not prove the complete Kafka-to-Credit flow; that still needs the team's integration environment.

### Change password from the profile

```http
PATCH /api/v1/user/me/password
Authorization: Bearer <token>
Content-Type: application/json

{"newPassword":"ChangedProfilePass2"}
```

Uses the signup password rules, keeps the current session, revokes other sessions and invalidates outstanding reset links. Name and email remain immutable.

### Profile and status

```http
GET /api/v1/user/me
Authorization: Bearer <token>
```

```http
GET /api/v1/user/me/status
Authorization: Bearer <token>
```

`/me` returns `{ id, name, email, telegramHandle, status, isAdmin }`. The `id` is the user's UUID. `nextSteps` in signup, email verification, and `/me/status` uses the codes `VERIFY_EMAIL`, `VERIFY_TELEGRAM`, `CONTACT_ADMIN`, and `CANCEL_PENDING_DELETION`.

## Run without Docker

Install dependencies and generate the Prisma client:

```powershell
npm install
npm run prisma:generate
```

Copy `.env.example` to `.env`, provide a reachable PostgreSQL `DATABASE_URL`, then run:

```powershell
npm run prisma:migrate
npm run dev
```

## Run with Docker

After installing Docker Desktop:

```powershell
docker compose up --build
```

The database is exposed locally on port `5554`; the API is exposed on port `8080`.

## Verification commands

```powershell
npm test
npm run build
npx prisma validate
```

To test password recovery against the real local service and PostgreSQL, run these from `user-service` with Docker Desktop running:

```powershell
docker compose up -d --build
npm.cmd run prisma:generate
npm.cmd run test:integration:password-reset
```

The integration test uses the API on port `8080` and the development database on port `5554`. It creates one temporary account, checks reset-link expiry, replacement, single use and simultaneous requests, checks that password reset unlocks the account and invalidates old sessions, then deletes its test account and associated records. It reads development reset links from the container logs and does not send real emails.

For complete local onboarding and profile password checks, with no real Telegram bot configured:

```powershell
npm.cmd run build
npm.cmd run test:integration:onboarding
```

This checks verification in both orders, OTP expiry and concurrent attempt limits, the Telegram sender/handle check using a simulated bot, exactly one queued verification event, and profile password/session behavior. It removes its temporary accounts. Real Telegram delivery and Kafka/Credit delivery require separate integration tests after those services are configured.

## Team handoff and API contract updates

- Add authenticated `POST /api/v1/user/request-telegram-verification`, no body, response `202 { telegramBotUrl, expiresAt }`; errors include `401`, `429`, and `503`.
- Keep `POST /api/v1/user/verify-telegram` authenticated with `{ otp }`, response `{ status, nextSteps }`. Keep the existing password recovery and profile password endpoints.
- Don: run the normal migration Job with the new image, then test that Credit grants 20 credits only after both verification steps. The event format is unchanged; delivery now retries from the database.
- Jun Sen: the proposed frontend changes are isolated on the local `user-service-frontend-integration` branch for review. They send signup `name`, use email OTPs, map profile `id` to the frontend's `userId`, align the User Service port, and add verification/status screens.
- Still outstanding: real email delivery (including the login-lockout email), account deletion/cleanup, account escalation to Admin, agreed access rules for Order's Telegram lookup, and friendships. The complete frontend/Order/Credit/Admin journey has not been demonstrated by these service-level tests.
