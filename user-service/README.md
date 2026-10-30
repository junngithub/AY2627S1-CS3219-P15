# User Service

Owns user registration, verification, authentication, profile status, account lifecycle, friendships, and validated report/appeal intake for Friends on Campus.

## Current implementation

- Express + TypeScript service on port `8080`
- PostgreSQL schema managed by Prisma
- Six-digit email OTPs (only hashes are stored)
- Password hashing with Node.js `scrypt` and a unique salt per password
- Opaque bearer sessions (only token hashes are stored)
- Generic credential failures with an approved correct-password suspension exception, configurable login lockout, and lockout notifications through the configured email provider
- Account status and profile retrieval
- Interactive Swagger/OpenAPI documentation
- Docker Compose configuration for the service and its own PostgreSQL database

Email and Telegram verification, password recovery/change, account deletion, admin user search/role/status updates, login-lockout notifications, friendship management, user reports and suspension appeals are implemented in this checkout. Reports and appeals are validated here and stored/reviewed by Admin Service. Order can look up Telegram handles through a private endpoint whose caller access relies on the Order-only mesh policy. An audited admin verification override is available for non-production load tests. Email delivery supports AWS SES when configured, with a development logger for local work. Telegram uses a real verification bot when configured, or a development logger locally without a bot. Generic `/me/escalate` and Created-account verification help still need an agreed API. Cross-service integration still needs acceptance testing.

A deployment-only first-admin bootstrap command is available. It promotes an explicitly selected verified account; it is not an HTTP endpoint and never runs automatically.

## Architecture and database guides

- [Architecture and verification flow](docs/architecture.md): service boundaries, external integrations, design decisions and deployment assumptions.
- [Database schema](docs/schema.md): table relationship diagram, field explanations, constraints and account-state rules.

These guides describe the implementation in this checkout, not proof of what is currently deployed. The executable database definition is [prisma/schema.prisma](prisma/schema.prisma); Swagger remains the reference for implemented HTTP operations.

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
  "name": "Example User",
  "email": "e1234567@u.nus.edu",
  "password": "SecurePass1",
  "telegramHandle": "example_user"
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

With `EMAIL_PROVIDER=ses`, SES sends the OTP to the registered NUS address. With local `EMAIL_PROVIDER=development`, it is printed in the User Service log instead. See the SES setup below. Signup returns a sanitized `503 EMAIL_DELIVERY_FAILED` if SES rejects the request, or `503 EMAIL_NOT_CONFIGURED` if email is disabled. The account can already have been saved and remains unverified: use resend-verification after resolving delivery, rather than repeating signup.

### Resend verification OTP

```http
POST /api/v1/user/resend-verification
Content-Type: application/json

{
  "email": "student@u.nus.edu"
}
```

The response does not reveal whether an account exists. A supplied email receives the same `202` even when sending fails; the service logs a sanitized failure and a new request is needed after recovery.

### Forgot/reset password

```http
POST /api/v1/user/forgot-password
Content-Type: application/json

{"email":"student@u.nus.edu"}
```

The service responds with the same `202` for a supplied email whether or not the account exists, including when email sending fails. SES sends the link when configured; development mode prints it to the User Service log. The link points to `FRONTEND_BASE_URL/reset-password?token=...`; set `FRONTEND_BASE_URL` to the deployed frontend origin outside local development. Links expire after 30 minutes by default and a new request invalidates older links.

### Email delivery: AWS SES

Only User Service sends account emails. No database migration, frontend change or new public endpoint is required. The official AWS SDK uses its default credential chain; no AWS keys, Gmail password or SMTP password are embedded in the application.

| Setting | Meaning |
| --- | --- |
| `EMAIL_PROVIDER=ses` | Send OTPs and reset links using SES API v2. |
| `SES_FROM_EMAIL` | One bare sender address verified in the selected AWS account and region. Not the recipient domain restriction. |
| `AWS_REGION=ap-southeast-1` | Singapore; must match the verified SES identities. |
| `FRONTEND_BASE_URL` | Reachable frontend origin for password-reset links. |
| `EMAIL_PROVIDER=development` | Local/test only: logs OTPs/reset links. Rejected outside `NODE_ENV=development/test`. |
| `EMAIL_PROVIDER=disabled` | No sending or secret logging. Default outside development/test if the provider is unset; auth/profile endpoints can still run. |

Local development/test defaults to the development provider for compatibility. Selecting SES never falls back to logging on errors. Startup logs the provider name; SES acceptance/failure logs never contain addresses, OTPs, reset URLs or raw AWS errors. SES acceptance is not proof of final delivery; check the inbox and bounce feedback.

#### Local setup, step by step

1. In SES Singapore, verify the sender. In sandbox mode, also verify every intended demo recipient. A Gmail sender has been tested manually, but we cannot authenticate `gmail.com` for SES: delivery can still be filtered/rejected. Prefer a team-controlled domain with DKIM for production. Request SES production access in Singapore before sending to unverified recipients; approval is separate from IAM permissions.
2. Edit the existing ignored `user-service/.env` locally; do not replace it or erase existing bot/database settings. Set:

   ```dotenv
   EMAIL_PROVIDER=ses
   SES_FROM_EMAIL=YOUR_VERIFIED_SENDER@gmail.com
   AWS_REGION=ap-southeast-1
   FRONTEND_BASE_URL=http://localhost:5173
   ```

3. Supply AWS access securely. For a host Node run, use an AWS CLI v2 SSO profile (`aws configure sso`, `aws sso login --profile <profile>`, then set `AWS_PROFILE` in the process environment), or short-lived credentials. Do not create permanent IAM keys just for this demo. For the local Compose container, the host's console login/profile is not automatically available. Obtain temporary programmatic credentials from the approved AWS access portal/profile, if permitted, and put **all three** values (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`) only in the ignored `.env`. Compose forwards these at runtime, not image-build time. Never paste them into chat or run a configuration dump that displays them. Temporary values expire; refresh them when needed. If the portal does not offer programmatic access, ask the infrastructure owner rather than weakening account policy.
4. The AWS principal needs `ses:SendEmail` scoped to the approved identity, e.g. `arn:aws:ses:ap-southeast-1:<account-id>:identity/<verified-sender-address>`. The infrastructure owner must check IAM and university organization restrictions. Console sending success does not prove the container has permission. AWS region/account must match the identities; sandbox restrictions still apply.
5. From `user-service`, rebuild/recreate the service with `docker compose up -d --build user-service`. This also starts its database if needed. **Only one running process may poll the configured Telegram bot**; do not also start a host copy using that bot. To work without starting its poller, set `TELEGRAM_POLLING_ENABLED=false` locally before starting this email test.
6. In Swagger (`http://localhost:8080/api-docs`) or the real frontend, sign up using a verified NUS recipient and an unused Telegram handle. Retrieve the OTP from the inbox and submit `/verify-email`. Then request `/forgot-password`, open the emailed link in the frontend and reset the password. Check junk/bounce messages too. This is a live test: perform it only with the recipient owner's approval. If the account already exists, resend its OTP instead of signing up again.

For deployed containers, the infrastructure owner should supply `EMAIL_PROVIDER`, `SES_FROM_EMAIL`, `AWS_REGION` and the frontend origin via environment configuration, and grant the workload an email-only IAM role (or approved secret mechanism). Do not rely on a developer's login or temporary local credentials for an always-running deployment. No cluster/IAM/SES settings are changed by this code patch.

#### Failure handling and limitations

- The SDK makes at most three attempts per call, with a 3-second connection timeout and a 10-second request timeout per attempt. A network timeout may mean SES accepted a message even though the response was lost, so duplicate emails are possible; codes/links remain subject to existing expiry/single-use checks.
- Signup delivery failures return sanitized `503`; the saved account stays unverified. Resend and password recovery keep their generic `202` even on delivery failures to avoid account enumeration. After resolving the issue, request a new code/link. Neither sending nor receiving an email automatically verifies a user.
- Email sending is synchronous and is **not** the durable Kafka verification outbox. A failed send is not queued across restarts. Users can request another verification/reset message; lockout warnings are attempted only on the transition into lockout and are not automatically resent. A process failure after saving lockout but before sending can also lose the warning. Durable email jobs, application-level resend throttling and bounce/complaint automation remain production-hardening work. SES quotas apply, including the sandbox limit of one email per second; do not use real email for load-test users.
- Troubleshooting: `CredentialsProviderError` usually means missing AWS access; `AccessDeniedException` means permission/policy failure; `MessageRejected` may indicate identity/sandbox issues; `TooManyRequestsException` means throttling. Raw errors are deliberately not logged. Inspect AWS configuration with the infrastructure owner without exposing secrets.

References: [SES SendEmail](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html), [AWS SDK credentials](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html), [SES sandbox](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html), [DMARC alignment](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dmarc.html).

#### Automated email checks (no real messages)

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:integration:email
```

The unit tests use fake SES clients, including real SDK serialization/signing with an in-memory HTTP handler. The integration test uses its own randomly named local database on port `5554`, applies migrations, and drops only that database afterward. It tests signup failures/recovery via resend, OTP validation, password reset, session revocation and generic delivery-failure responses without sending email/Telegram or modifying normal accounts. Start only the existing local database with `docker compose start db` if necessary. Other local Compose onboarding/reset scripts now refuse SES mode before creating any synthetic accounts.

```http
POST /api/v1/user/reset-password
Content-Type: application/json

{"token":"token-from-reset-link","newPassword":"NewSecurePass1"}
```

A successful reset consumes the link, unlocks the account and revokes existing sessions. The user must log in again. Run the new Prisma migration before deploying this version of the service.

### Login

The fifth failed password attempt locks the account by default (`LOGIN_MAX_ATTEMPTS` is configurable). Attempts are counted under a database row lock, so concurrent failures cannot lose increments or each trigger a warning for the same lockout. A stale password check from before a password change is ignored. Correct-password login before the threshold resets the counter.

On the transition into lockout, the service attempts an account-locked warning through the existing email provider. It directs the owner to `FRONTEND_BASE_URL/forgot-password`, not a pre-created reset token. Resetting the password unlocks login and revokes old sessions. Already-locked accounts are not notified repeatedly; suspended and deletion-expired accounts do not trigger these warnings. Previously locked accounts are not backfilled on deployment.

Unknown accounts, wrong passwords, active locked accounts and deletion-expired accounts return the same `401 INVALID_CREDENTIALS`, including when notification delivery fails. With the correct password and before the deletion deadline, a suspended account returns `403 ACCOUNT_SUSPENDED` even when `lockedAt` is set: suspension is checked before lockout. No session is issued and the lock is not cleared. This is the explicitly approved exception to the backlog's generic-login-error rule. Appeals still reject locked accounts with generic `401`; password reset must clear the lock before an appeal can proceed. Suspension/reinstatement behavior is unchanged. SES uses the existing sender/region/permissions; development mode logs a generic notification marker without the recipient address or recovery link, and disabled email sends nothing. Delivery errors are sanitized. See the email limitations above: one application send attempt per transition does not guarantee exactly one delivered email or durable delivery.

The lockout notification needs the existing SES configuration and a reachable `FRONTEND_BASE_URL`, with no additional AWS permission or migration. The suspension response needs frontend handling and the separate appeal endpoint below.

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
    "name": "Example User",
    "email": "e1234567@u.nus.edu",
    "status": "Created"
  }
}
```

### Authorize

```http
POST /api/v1/user/internal/authorize
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

The API gateway calls `/api/v1/user/internal/authorize` directly for every protected request (see `infra/docs/adr/0007-envoy-gateway-extauth.md`), so:

- **Any method is accepted.** The gateway's check uses the client's method (`GET /api/v1/orders` is checked as `GET /api/v1/user/internal/authorize`) and sends no body.
- **Identity is in the headers.** The gateway ignores the JSON body and copies `x-user-id`, `x-is-admin` and `x-permitted-action` onto the request it forwards. The JSON is for other callers.
- **Nothing is cached**, so a suspension applies to the next request.

The `/api/v1/user/internal` prefix is blocked at the public Envoy gateway and the frontend nginx proxy. Internal authorization still requires the user's bearer session; removal of the Order lookup secret does not change that. `/api/v1/user/authorize` remains a temporary compatibility alias with identical authentication and responses, still blocked externally. Remove the alias and its exact-path blocks only after deployed Envoy, nginx and other direct callers have migrated. The canonical route is documented in Swagger; the legacy alias is not advertised as a separate operation.

Rollout order: deploy/rebuild the updated User Service first (it supports both routes), then update/reload the Envoy and nginx configurations. An older User image does not serve the new route, so switching callers first would break protected requests. Source/config validation here does not update running containers or the cluster automatically.

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

Repository deployment values now wire `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` from the optional `user-telegram` Kubernetes Secret. Dev values map both keys from Secrets Manager `foc/dev/user-telegram`, select one replica and enable polling. Terraform seeds empty placeholder values; this does not prove that real credentials have been supplied or deployed. Without a bot token outside development, challenge requests return `503 TELEGRAM_NOT_CONFIGURED`. Live secret values and bot delivery have not been verified by this documentation review.

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

### Friendships

All six operations require `Authorization: Bearer <real-user-session-token>` and return `Cache-Control: no-store`. User checks the actual session and current account state; identity headers alone do not authenticate the caller. The caller must be active with neither deletion requested nor scheduled. Following the contract's authentication-only rule, friendship operations do not additionally require completed email/Telegram verification or `permittedAction=true`. No Order participation lookup is performed.

Paths below are relative to `/api/v1/user`:

| Method and path | Body / query | Success response |
| --- | --- | --- |
| `POST /friends/request` | `{ "targetUserId": "<user-uuid>" }` | `201 { requestId, senderId, recipientId, status: "pending", createdAt }` |
| `GET /friends/requests` | `?direction=incoming&page=1&pageSize=20` | `200 { items: [{ requestId, status: "pending", createdAt, sender: { id, name }, recipient: { id, name } }], page, pageSize, total }` |
| `POST /friends/{requestId}/accept` | No body | `200 { requestId, status: "accepted", changed }` |
| `POST /friends/{requestId}/reject` | No body | `200 { requestId, status: "rejected", changed }` |
| `GET /friends` | `?page=1&pageSize=20` | `200 { items: [{ id, name }], page, pageSize, total }` |
| `DELETE /friends/{friendUserId}` | No body; other user's UUID in path | `204`, no body |

`direction` is `incoming` (default) or `outgoing`; the request list contains only pending invitations. Both lists default to page `1`, page size `20`; page must be an integer from `1` to `100000`, and page size from `1` to `100`. They sort by creation time descending, then request UUID ascending, and `total` counts all matching visible rows before pagination. User summaries contain only `id` and `name`; friendship responses expose no passwords, email, Telegram details or role.

Only the invitation's recipient may accept/reject. The first change returns `changed: true`; repeating the same action on that request returns `changed: false` while it remains in that resulting state. An incompatible state returns `409`. Deletion changes an accepted relationship to `REMOVED` and is idempotent, including when no accepted friendship exists; it does not cancel pending invitations. A new invitation after rejection/removal receives a fresh UUID. An old request ID cannot accept a later invitation.

At most one pending or accepted relationship may exist for an unordered pair, including crossed/concurrent sends. A second active request returns `409`; crossed invitations never auto-accept. Rejected and removed rows remain history until an account is physically deleted. Suspended users and users with deletion requested/scheduled are excluded as peers from both lists and cannot receive requests. Accepting requires the sender to remain available, including an acceptance retry. An available caller can still reject an existing invitation from an unavailable sender or remove an accepted friendship with an unavailable peer.

| Error | Meaning |
| --- | --- |
| `400 INVALID_USER_ID` | Missing/malformed UUID, including request IDs |
| `400 SELF_FRIEND_REQUEST` | Sending to yourself |
| `400 INVALID_PAGINATION` / `INVALID_DIRECTION` | Invalid list query |
| `401 UNAUTHORIZED` | Invalid/expired/revoked session, suspended caller or caller pending deletion |
| `404 USER_NOT_FOUND` | Send target is missing or unavailable |
| `404 FRIEND_REQUEST_NOT_FOUND` | Missing request or caller is not its recipient, including the sender |
| `409 FRIENDSHIP_ALREADY_EXISTS` | Pending or accepted relationship already exists in either direction |
| `409 FRIEND_REQUEST_NOT_PENDING` | Accept/reject conflicts with the request's current state |
| `409 USER_NOT_AVAILABLE` | Acceptance sender is unavailable |

The new [friendship migration](prisma/migrations/20261027000000_friendships/migration.sql) creates the table, not-self check and partial unique index on unordered active pairs. Apply it through the intended environment's migration workflow and regenerate Prisma Client before running the updated service. `prisma db push` alone does not install the custom SQL constraints. The friendship integration suite passed against a disposable local PostgreSQL database, including the migration and direct constraint checks; see the verification results below. This does not establish deployment or migration of the normal database.

### User reports and suspension appeals

| Operation | Request | Access / result |
| --- | --- | --- |
| `POST /api/v1/user/reports` | `{ reportedUserId, comment }` | Real bearer session; `201` Admin report record |
| `POST /api/v1/user/appeals` | `{ email, password, message }` | Public credential check for a suspended account; `201` Admin appeal record |

Both text fields are trimmed and must contain 1–4000 characters (`400 INVALID_SUPPORT_TEXT`). Responses use `Cache-Control: no-store`. Reports derive the reporter UUID from the actual session, ignoring supplied identity headers/body IDs; the caller must be active with neither deletion requested nor scheduled (`401 UNAUTHORIZED` otherwise). The session/account is rechecked transactionally. The reported UUID must be valid (`400 INVALID_USER_ID`), different from the reporter (`400 SELF_REPORT`), and belong to an existing account whose deletion deadline has not passed (`404 USER_NOT_FOUND`). A suspended target or one awaiting a future deletion deadline may still be reported. Submission does not suspend anyone.

Appeals normalize email and trim passwords using the same password verification as login. With valid input, unknown accounts, wrong passwords, locked accounts and deletion-expired accounts receive generic `401 INVALID_CREDENTIALS`; a correctly authenticated active account receives `409 ACCOUNT_NOT_SUSPENDED`. The suspended account is rechecked under its account lock. Submission creates no session, cancels no deletion and does not reinstate the account. Created-account verification help and generic `/api/v1/user/me/escalate` are not implemented.

The public appeal route has a best-effort limiter keyed by the normalized email's hash: 10 requests per 15 minutes per process, including unknown emails. It stores at most 10,000 entries and returns `429 TOO_MANY_APPEAL_ATTEMPTS` when the limit or live-entry capacity is reached. It resets on process restart and is not distributed; ingress rate limiting remains required.

User sends only `{ reporterUserId, reportedUserId, comment }` to Admin's `POST /api/v1/admin/reports`, or `{ userId, message }` to `POST /api/v1/admin/appeals`. Passwords and bearer tokens are never forwarded. Returned records are strictly validated, matched to the submitted user UUIDs and restricted to these camelCase fields, with no legacy snake_case fallback:

- Report: `{ id, reporterUserId, reportedUserId, comment, status, createdAt, closedAt, closedByAdminId }`; status is `open`, `dismissed` or `actioned`.
- Appeal: `{ id, userId, message, status, createdAt, closedAt, closedByAdminId }`; status is `open`, `rejected` or `reinstated`.

Both records require `closedAt` and `closedByAdminId`; either may be `null`.

Admin deduplicates one open report per ordered reporter/target pair and one open appeal per user. Retries return the existing row and retain its original text. This is open-record deduplication, not a lifetime submission limit; a closed record allows a later submission. User adds no report/appeal tables or migration and holds no account lock during the HTTP call. Admin owns persistence and review; existing suspension/reinstatement operations remain unchanged.

| Setting | Behavior |
| --- | --- |
| `ADMIN_SERVICE_BASE_URL` | Defaults to empty: eligible support submissions return `503 ADMIN_NOT_CONFIGURED`, while other account APIs remain usable. Must be an HTTP(S) origin with no credentials, path beyond `/`, query or fragment. |
| `ADMIN_REQUEST_TIMEOUT_MS` | Default `5000`, capped at `30000` ms. |

The example environment uses `http://localhost:8084`; User's local Compose default uses `http://host.docker.internal:8084`. No real `.env` is changed by this work. The client rejects redirects, limits responses to 32 KiB, uses the configured timeout and performs no automatic retry. Network/timeout errors and Admin `429`/`5xx` become sanitized `503 ADMIN_UNAVAILABLE`; malformed responses become `502 ADMIN_INVALID_RESPONSE`, other rejected statuses become `502 ADMIN_REQUEST_REJECTED`, and upstream `409` becomes `409 ADMIN_CONFLICT`. Raw upstream errors and payloads are not logged or returned. A failed response can follow a persisted Admin record; a manual retry uses the open-record deduplication above.

Malformed JSON returns `400 INVALID_JSON`; a request body over the 32 KiB parser limit returns `413 REQUEST_TOO_LARGE`. The global error handler sets `Cache-Control: no-store`, does not log raw parser/database errors, and logs only a constant message for unexpected `500 INTERNAL_ERROR` failures, avoiding credential/body disclosure.

camelCase response fix (30 October 2026): the TypeScript build, 86/86 unit tests, strict type checking of `account-support.test.ts` and `node --check` of the account-support integration script passed. After Docker started, the isolated account-support integration suite also passed with camelCase responses, using real User HTTP/PostgreSQL and an HTTP Admin stub. Its temporary database was removed; no normal database was migrated or real messages sent. The actual Admin application and deployed flow remain unverified. Earlier 83-test/all-seven-suite results below are historical, not evidence that all seven suites were rerun for this fix.

Historical checks before the camelCase response fix, reported on 30 October 2026, passed: TypeScript build, Prisma generation/validation, 83/83 unit tests, all seven isolated integration suites (email, lifecycle, admin-bootstrap, admin-users, lockout, friendships and account-support), strict new-unit-test type checking and integration-script syntax checks. All temporary databases were cleaned up. Support integration used real User HTTP/PostgreSQL with an HTTP Admin stub, not the actual Admin application or database. The Node 20 production Docker build and network-isolated smoke test passed (Node 20.20.2, non-root, 256 MiB, no `.env`, health/OpenAPI checks; no database or real Admin exercised). The 183-package install audit and Docker `npm ci` reported zero vulnerabilities. No normal database was migrated, no real email/bot messages were sent and no cloud deployment occurred. Actual Admin, cloud/frontend, gateway/mesh, load and full cross-service acceptance remain unproven; infrastructure changes are handoff only.

## Run without Docker

Dependency hardening: User's root `package.json` overrides `body-parser` to `1.20.9` and `qs` to `6.16.1`. These patch releases address the high-severity compressed-body trailing-bytes denial of service ([body-parser advisory](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828)) and the moderate-severity comma-array serialization denial of service ([qs advisory](https://github.com/ljharb/qs/security/advisories/GHSA-6pq8-jhm2-2vcw)). Express `4.22.3` pins the affected versions, so an ordinary targeted update cannot select the fixes; the overrides retain the same dependency major versions without adding a new dependency or upgrading Express's major version. Keep the overrides until upstream dependency declarations accept patched releases, then review removal with the lockfile and regression checks. The refresh changed only two lockfile package entries: `body-parser` `1.20.8` to `1.20.9` and `qs` `6.16.0` to `6.16.1`; Express remains `4.22.3`. Install and final Docker dependency audits reported zero vulnerabilities.

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

The database is exposed locally on port `5554`; the API is bound to `127.0.0.1:8080` so other computers cannot access its unauthenticated internal lookup through the host port. Compose networking is still private development infrastructure, not an authenticated mesh.

## Verification commands

`npm test` discovers `.test.ts` files recursively under `src` and passes explicit paths to Node with the `tsx` loader. This works on Windows and Linux/Node 20 without relying on shell wildcard expansion. It fails rather than silently succeeding if no tests are found.

```powershell
npm test
npm run build
npx prisma validate
```

For isolated database integration checks, start the local development PostgreSQL server on port `5554`, then run:

```powershell
docker compose start db
npm.cmd run test:integration:admin-users
npm.cmd run test:integration:lifecycle
npm.cmd run test:integration:admin-bootstrap
npm.cmd run test:integration:email
npm.cmd run test:integration:lockout
```

These five suites create and drop their own disposable databases, not the normal `user_db`. They do not send real messages or change normal accounts. Never point these fixtures at a shared or production database. The lockout suite uses fake SES and exercises the five-attempt threshold, concurrent attempts, one notification per lockout, generic failure responses during delivery failure, password-reset recovery, stale password checks, and unavailable-account handling.

For the friendship suite, with local PostgreSQL available on port `5554`, run:

```powershell
npm.cmd run prisma:generate
npm.cmd run build
npm.cmd run test:integration:friendships
```

The suite applies migrations to a randomly named `user_friendships_it_<random>` database, starts its own HTTP test server on an ephemeral loopback port, and drops that database afterward. It does not migrate normal `user_db` or start email/Telegram/Kafka workers. It covers all six HTTP endpoints, authentication denials and identity spoofing, input bounds, request discovery/privacy, bidirectional friendships and idempotency, fresh request IDs after rejection/removal, concurrent crossed sends and accept/reject races, direct database self/pair constraints, transactional revoked-session checks, pagination and deletion cascades.

Validation on 23 October 2026: 68 unit tests, TypeScript build, all five isolated suites, and the production Docker build passed. Local frontend signup, real SES email/Telegram verification, login and emailed password reset were manually tested on 20 October. Lockout-warning inbox delivery has not been manually exercised. These results do not prove live Linkerd enforcement, the real Admin relay, or the complete Kafka/Credit/Order flow.

Earlier checks on 27 October 2026, before the friendship implementation: 68/68 unit tests and the TypeScript build passed. Docker was initially unavailable (`dockerDesktopLinuxEngine` missing). That limitation was superseded when Docker started and all six isolated suites passed as recorded below; the earlier 68-test result remains historical.

Reported results on 27 October 2026: Prisma Client generation, `prisma validate`, the TypeScript build, 74/74 unit tests (including OpenAPI reference/path/security integrity) and `node --check scripts/friendships.integration.cjs` passed. All six isolated integration suites passed after the new migration/code: friendships, email, lifecycle, admin-bootstrap, admin-users and lockout. The friendship suite used real local PostgreSQL in a disposable `user_friendships_it_<random>` database. All temporary test databases were cleaned up by their scripts. Only the Compose `db` service was started; no normal database was migrated or normal account mutated, no real messages were sent, and the application container and Telegram poller were not started. Live/frontend friendship acceptance, deployed behavior, load acceptance and the complete cross-service end-to-end journey remain unproven.

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

See [API_CONTRACT_UPDATES.txt](API_CONTRACT_UPDATES.txt) for exact edits to the shared contract pasted on 18 October 2026, including the authentication exceptions, new endpoints, deletion behavior and the event-format question to resolve with the Credit Service owner. This is a copyable edit guide; the external shared document has not been changed.

- Add authenticated `POST /api/v1/user/request-telegram-verification`, no body, response `202 { telegramBotUrl, expiresAt }`; errors include `401`, `429`, and `503`.
- Keep `POST /api/v1/user/verify-telegram` authenticated with `{ otp }`, response `{ status, nextSteps }`. Keep the existing password recovery and profile password endpoints.
- Update the friendship rows and add `GET /api/v1/user/friends/requests` as described in section 13 of the contract edit guide. Clients discover recipient request IDs through that list; request actions use `requestId`, while removal uses `friendUserId`. These are manual shared-contract edits; this checkout has not edited the Google Docs contract.
- Infrastructure and Credit Service owners: run the normal migration Job with the new image, then test that Credit grants 20 credits only after both verification steps. The event format is unchanged; delivery now retries from the database.
- Infrastructure owner: rebuild the User image and configure `EMAIL_PROVIDER=ses`, `SES_FROM_EMAIL`, `AWS_REGION=ap-southeast-1` and the deployed `FRONTEND_BASE_URL`. Supply approved workload AWS access with `ses:SendEmail` scoped to the sender identity, not a developer's expiring local credentials. Configure bot secrets and one poller per bot as well. SES is still sandboxed: verify demo recipients in the same account/region. Do not enable development email logging in production.
- User-side Admin search/role/status endpoints, Admin's bearer-header forwarding, friendships, reports and suspension appeals are implemented; see the integration sections. Generic `/me/escalate` and Created-account verification help still need an agreed API. Deployed-environment verification, frontend integration, controlled lockout-warning inbox delivery and the complete frontend/Order/Credit/Admin journey remain unproven.

Moderation handoff only; this PR is User Service only and does not change infrastructure, Admin or frontend source:

- Gateway owner: add the exact public `POST /api/v1/user/appeals` route without the usual bearer-authorization prerequisite. Keep `POST /api/v1/user/reports` protected by the real user bearer session. Add ingress rate limiting to the public credential-checking appeal route.
- Infrastructure owner: configure User's `ADMIN_SERVICE_BASE_URL=http://admin:8084` and allow private User-to-Admin access only to the two intake POST routes. The current Admin mesh callers allow gateway/order and deny User, so this policy needs an explicit update before deployment.
- Gateway/mesh owners: block external `POST /api/v1/admin/reports` and `POST /api/v1/admin/appeals`, including trailing-slash requests that FastAPI can redirect to those routes. Preserve authenticated Admin GET queues/detail and review operations. Admin's current intake has no application authentication and trusts User's validation, so direct public intake must not bypass User.
- Frontend owner: add report and appeal forms, handle login `403 ACCOUNT_SUSPENDED`, and implement friendship UI separately. Apply the shared-contract edits in section 14 of the edit guide. Deployment still needs the friendship migration; report/appeal intake adds no User migration.

## Account deletion (F5)

```http
DELETE /api/v1/user/me
Authorization: Bearer <user-session-token>
Content-Type: application/json

{"confirm":true}
```

Returns `202 { message, scheduledDeletionAt }`. The deadline is six calendar months later, clamping month-end dates when necessary. All current sessions, outstanding reset links and verification challenges are revoked immediately. The last active administrator cannot schedule deletion (`409 LAST_ADMIN`).

Correct-password login before the deadline cancels deletion and creates a new session; old sessions remain revoked. Login and authorization reject an account whose deadline has passed, even if the cleanup worker has not run yet. The worker runs every `USER_DELETION_SWEEP_INTERVAL_SECONDS` (default 3600), removes up to 100 expired accounts per run, and uses database locks to coordinate with login and other workers. User-owned sessions, OTPs, challenges, verification outbox rows and friendships in either participant role are removed through foreign-key cascades. A minimal audit trail stores UUIDs/action/reason, not profile fields. Other services retain their own records; no unagreed cross-service deletion event is invented here.

## First-admin bootstrap (deployment only)

This resolves the initial setup problem: normal Admin APIs require an existing admin, but a fresh User database has none. The privileged deployment operator uses this command to promote a specific existing user. The command does not call Admin Service, create an account, bypass verification, or expose a public/internal HTTP endpoint. Normal signup always creates an ordinary user.

1. Have the intended administrator register and complete both email and Telegram verification. Obtain that account's UUID from signup or authenticated `GET /api/v1/user/me`.
2. Deploy/rebuild the updated User image and apply existing migrations, including `UserAuditLog`. No new migration is required by bootstrap itself.
3. Confirm the environment/database and exact user UUID with the deployment owner. Only an operator with approved container-exec/database access should run the command. Do not expose execution through a web form or ordinary user's token.
4. Replace `REPLACE_WITH_USER_UUID` below with that UUID and run **once in the intended environment**.

Local Docker Compose, from `user-service` with the updated service container running:

```powershell
docker compose exec -T user-service node dist/bootstrap-admin.js --user-id "REPLACE_WITH_USER_UUID" --confirm
```

Kubernetes, using the approved namespace and deployment access:

```text
kubectl -n <namespace> exec deployment/user -- node dist/bootstrap-admin.js --user-id <user-uuid> --confirm
```

For a compiled host run, `npm run bootstrap:admin -- --user-id <user-uuid> --confirm` uses `DATABASE_URL` from the process environment or the ignored `.env`. Check the database target before using it. Prefer execution inside the intended deployment to avoid pointing at the wrong database. Do not paste database credentials into chat or commit them.

Safe help, which does not change any account:

```powershell
npm.cmd run build
node dist/bootstrap-admin.js --help
```

The command requires explicit `--confirm`. It refuses missing/invalid UUIDs, missing users, unverified users, locked/suspended users and accounts with deletion requested or scheduled. It also refuses if **any** admin already exists, including an inactive one, or if a `FIRST_ADMIN_BOOTSTRAPPED` audit marker exists. The marker remains after account deletion, so this is not an automatic account-recovery backdoor. Recovery after lost admin access needs a separate privileged, reviewed procedure.

Promotion, revocation of the account's existing sessions and outstanding password-reset links, and the audit record commit in one transaction. Failure rolls back the whole change. Concurrent commands coordinate using the same database advisory lock as last-admin lifecycle checks, so only one can succeed. Future role-changing operations must use `lockAdminRoleChanges` as well. Names, password hashes, email/Telegram verification and other users are unchanged; the command does not publish verification events or award credits.

Audit action: `FIRST_ADMIN_BOOTSTRAPPED`, with target UUID, reason and time. `actorUserId` is null because this is an out-of-band deployment operation, not an authenticated application admin; retain platform access logs to identify the human operator. Success/help exits `0`; rejected setup or database failure exits nonzero, without printing connection credentials. Successful output includes the target UUID and role, not profile or password fields.

After success, the promoted account must **sign in again** using its existing password. `/api/v1/user/internal/authorize` then returns `isAdmin: true` and `permittedAction: true`. Normal User-side search/role/status endpoints are documented below; Admin must forward the real administrator's bearer token. There is no new bootstrap API row to add to the shared contract.

### Isolated bootstrap integration test

With local development PostgreSQL running on port 5554:

```powershell
npm.cmd run build
npm.cmd run test:integration:admin-bootstrap
```

The test creates its own uniquely named database, applies migrations, runs the real compiled CLI, tests rejection, atomic rollback, fresh admin login and concurrent processes, then drops only its disposable database. It does not promote any account in the normal `user_db`, send email/Telegram messages, or start the real service/bot. It requires permission to create/drop temporary databases on that local development server; never point this fixture at a shared or production database.

## New integration endpoints

Copy these rows into the shared API contract; keep the standard `{ error, code }` convention.

| Method | Endpoint | Body / Params | Access and result |
| --- | --- | --- | --- |
| DELETE | `/api/v1/user/me` | `{ confirm: true }` | Account owner's bearer session; returns `202 { message, scheduledDeletionAt }`, revokes sessions, allows cancellation by login before the six-month deadline. Last active admin: `409 LAST_ADMIN`. |
| GET | `/api/v1/user/internal/users/{userId}/telegram` | UUID path parameter; no body | Caller access enforced by Linkerd's Order-only policy, with no application shared token. Returns `{ userId, telegramHandle }` for an active, verified, non-expired account. Private service DNS only; blocked at the gateway. |
| POST | `/api/v1/user/admin/users/{userId}/verify` | UUID path parameter; `{ reason }` (3–500 characters) | Verified admin bearer session, non-production feature flag; returns `{ userId, status, nextSteps, changed }`. |

### Order Service integration

```http
GET http://user:8080/api/v1/user/internal/users/<uuid>/telegram
```

No `X-Service-Token` is required. Caller authentication is delegated to Linkerd mTLS **and its Order-only route authorization policy**, not a shared application secret. There is no token/mesh mode switch. Ordinary login, gateway authorization and Admin operations still require their existing bearer sessions.

Before deploying this version, the infrastructure owner must verify sidecar injection, the Order service-account identity, the Order-only `/api/v1/user/internal/users` route policy, denied access for gateway/unmeshed/unlisted callers, and no public or unprotected port bypass. The current User mesh values declare this policy, but source configuration is not proof of live enforcement. mTLS encryption alone is insufficient.

Order's merged client no longer sends `X-Service-Token` or reads its lookup-token configuration; its application configuration, Compose file and example environment have been updated. Obsolete `ORDER_USER_LOOKUP_TOKEN` references still remain in User/Order deployment values and environment secret wiring, and Terraform still defines the shared secret. Infrastructure must review and remove those references before deleting any shared secret resource. These documentation edits do not change deployment configuration or delete secrets. The old `ORDER_USER_LOOKUP_TOKEN` and `ORDER_USER_LOOKUP_AUTH` settings are no longer read by User; stale entries in an existing ignored `.env` can be removed locally.

For isolated local Postman testing, call `http://localhost:8080/api/v1/user/internal/users/<uuid>/telegram` without a token. Without Linkerd, **any caller that can reach this route can perform lookups**. Keep Compose on a trusted development machine/network, do not expose it through a tunnel or public port, and do not use a raw host server bound to all interfaces. A loopback host binding does not authenticate other local processes or containers on the Compose network.

Invalid UUIDs return `400`, missing/suspended/expired accounts `404`, and unverified accounts `409`. Only user ID and handle are returned, with `Cache-Control: no-store`. Order remains responsible for authenticating the requester/courier and enforcing order participation. Derive the acting UUID from the gateway's trusted `x-user-id`, rather than trusting a UUID supplied by the frontend.

### Admin Service: persistent user management

These match the relay routes requested by Admin Service. No schema migration is needed. Every call requires `Authorization: Bearer <real-admin-session>`; Admin must forward this header from its inbound request. Being inside the cluster or sending `x-is-admin:true` is not enough. Missing/invalid/non-admin/locked/unverified/deletion-pending callers receive `404`. User rechecks the actor and session inside each mutation transaction.

| Method | Route | Body / params | Result |
| --- | --- | --- | --- |
| GET | `/api/v1/user/search` | `?q=&page=`; bearer header | `{ items: [{ id, name, email, role, status }], page, total }` |
| POST | `/api/v1/user/{userId}/role` | `{ role: "admin" }` or `{ role: "user" }`; bearer header | `200 { userId, role, status, changed }` |
| POST | `/api/v1/user/{userId}/status` | `{ status: "suspended" }` or `{ status: "verified" }`; bearer header | `200 { userId, role, status, changed }` |

- Roles in these responses are lowercase `admin/user`; status is `Created/Verified/Suspended`. Search defaults to page 1 and 20 records, accepts pages 1-100000, and bounds `q` to 100 characters. Matches name/email case-insensitively or exact UUID; ordering is stable and already-expired deletion records are excluded. Passwords, tokens, Telegram identifiers and verification timestamps are never returned. Results use `Cache-Control: no-store`.
- Promotion requires both verifications and an active, unlocked target without pending deletion. No public first-admin shortcut is introduced. The first admin still uses the privileged bootstrap command.
- Demotion/suspension cannot remove the last available admin. Self-demotion is rejected. Counts exclude suspended, locked, unverified and deletion-pending admins; the advisory lock is shared with bootstrap and account deletion. Concurrent attempts serialize and recheck the actor's current eligibility.
- Actual role/status changes increment `authVersion`, revoke target sessions/reset links and append a minimal User audit record in one transaction. Suspension also revokes OTP/Telegram challenges. Repeated unchanged commands return `changed:false` without another User audit or forced logout. After promotion/demotion/reinstatement the target must log in again; old sessions do not become valid again.
- `status:"verified"` is the agreed **reinstate command**, not permission to manufacture verification. It clears suspension while preserving verification timestamps and login lockout. A previously unverified user returns `Created` and must finish normal verification. Reinstatement does not issue a second credit grant or create a verification event. Pending-deletion targets are rejected with `409 USER_PENDING_DELETION`.
- Errors use `{ error, code }`: `400 INVALID_USER_ID/INVALID_ROLE/INVALID_STATUS/INVALID_PAGE/INVALID_QUERY/SELF_DEMOTION_FORBIDDEN`; `404 NOT_FOUND/USER_NOT_FOUND`; `409 LAST_ADMIN/USER_NOT_ELIGIBLE/USER_PENDING_DELETION`.
- These three are admin-authorized routes with the agreed existing paths, not token-free service-only routes. A later migration under `/internal` needs coordinated Admin client/gateway/mesh changes; it is not silently performed here. The internal Telegram route remains private.

Admin's own audit/events occur after User returns 200. User's transactional audit is not a distributed transaction or a replacement for Admin's audit/outbox.

Client integration status and remaining handoff:

- `admin-service/app/routers/users.py` now forwards the inbound administrator's `Authorization` header through `_user_call` for search, promote, demote, suspend and reinstate, and explicitly handles downstream non-200 responses. Deployment values set `USER_SERVICE_BASE_URL=http://user:8080`. This is source/configuration evidence; the real relay still needs acceptance testing. The non-production test-verification override has no relay route in this file; any future caller must also supply the real admin bearer session.
- Linkerd identifies the calling workload; the bearer session identifies the administrator. Removing the Order lookup secret does not remove these admin-session checks.
- In `frontend/src/lib/adminUsers.ts`, read `result.items` instead of an array/`content`; map `userId = item.id`, `isAdmin = item.role === "admin"`, and `hasMore = result.page * 20 < result.total`. Keep frontend-to-Admin routes unchanged.

Admin forwards only the authorization credential to User, not gateway identity headers as a substitute for it. Never log this header.

Isolated local test (PostgreSQL on port 5554, no real messages/accounts):

```powershell
npm.cmd run build
npm.cmd run test:integration:admin-users
```

The test creates/drops only its own `user_admin_routes_it_<random>` database. It exercises real HTTP authorization, search, persistent promote/demote/suspend/reinstate, credential revocation, rollback on audit failure, concurrency and the token-free lookup contract. It is **not** proof of live Linkerd enforcement or real Admin-to-User integration.

### Admin Service / load tests

```http
POST /api/v1/user/admin/users/<uuid>/verify
Authorization: Bearer <actual-admin-session-token>
Content-Type: application/json

{"reason":"Synthetic load-test setup"}
```

This sets missing email/Telegram verification timestamps on synthetic non-production users. It does not grant admin roles, change Telegram identity IDs, unlock accounts, or reinstate suspended users. Suspended accounts and accounts pending deletion are rejected. The first actual change is audited with the admin UUID, target UUID, reason and time. Repeating the request is idempotent; `UserVerified` is queued once through the existing outbox.

It defaults to `404` unless `ENABLE_TEST_VERIFICATION=true` and `APP_ENV` is explicitly a permitted non-production environment (`local`, `development`, `dev`, `test`, `staging`, `stg`). When `APP_ENV` is absent it falls back to `NODE_ENV`; production/unknown environments remain disabled. Runtime Node images may use `NODE_ENV=production` even in non-production clusters, so set the real environment explicitly with `APP_ENV`. Never enable this override in production. The normal signup domain/password rules still apply to synthetic users.

Admin Service must forward its administrator's real `Authorization` header when calling this endpoint. Fake `admin-*` tokens and caller-supplied identity headers do not authenticate an admin. Use the deployment-only first-admin bootstrap command above to establish the first real admin; this test-verification endpoint does not grant roles. No public first-admin shortcut is introduced. The optional inverse operation is deliberately not added because reversing verification/credits needs a separate agreed workflow.

### Deployment acceptance checklist

- User Service uses opaque bearer session tokens, not JWTs. The gateway sends `Authorization` directly to `/api/v1/user/internal/authorize` (`POST` or the original request method is accepted). It then injects `x-user-id`, `x-is-admin`, and `x-permitted-action` from that response after stripping client-supplied copies early. The gateway and frontend nginx configurations now call this canonical path; existing deployed callers can temporarily use the legacy alias.
- Gateway authentication proves identity; each service must still check permission. `x-permitted-action=false` is a valid authenticated `Created` account and must not be allowed to create/accept orders. Services must not be publicly reachable through a route that bypasses this trusted gateway boundary.
- Verify the exact-route Linkerd allow/deny checks above before deploying the token-free lookup. Rebuild the User image and apply existing migrations through the migration Job; this token removal needs no new migration. Coordinate unused Order header/configuration and deployment-secret cleanup with their owners. For load tests only, set the non-production `APP_ENV` and enable the override. Keep the production override disabled.
- Verify public access to `/api/v1/user/internal` is blocked. Test the real Admin relay with ordinary-user denial and admin success, then test sign-in, both verification steps, Kafka/Credit's one-time starting grant, and Order create/accept/contact with two consenting accounts. Contact links open Telegram; the app does not host or store chat messages. Verify unrelated users cannot access another order's contact details.
- Run cluster policy tests and authenticated end-to-end checks before treating deployment as complete. Local application tests do not prove live gateway or Linkerd enforcement.

### Isolated lifecycle integration test

With local PostgreSQL running on port 5554 and dependencies installed:

```powershell
npm.cmd run prisma:generate
npm.cmd run build
npm.cmd run test:integration:lifecycle
```

The script creates a uniquely named temporary database, applies all migrations, starts a test API, and exercises deletion, restoration, cleanup, last-admin concurrency, token-free lookup eligibility, non-admin denial and audited test verification. It then drops only its own temporary database. It neither changes the normal `user_db` records nor sends email/Telegram messages, and does not change your `.env`.
