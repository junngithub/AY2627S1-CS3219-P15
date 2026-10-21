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

Email and Telegram verification, password recovery/change, and account deletion are implemented. Order can look up Telegram handles through a service-authenticated endpoint. An audited admin verification override is available for non-production load tests. Email delivery supports AWS SES when configured, with a development logger for local work. Local frontend signup, real SES OTP delivery, email/Telegram verification, login and password recovery were manually exercised on 20 October 2026; deployed-environment configuration and integration still need testing. Telegram uses a real verification bot when configured, or a development logger locally without a bot. Account escalation and friendship management remain to be implemented.

A deployment-only first-admin bootstrap command is available. It promotes an explicitly selected verified account; it is not an HTTP endpoint and never runs automatically.

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

#### Local acceptance evidence - 20 October 2026

- A single explicitly approved test email was sent from the local User Service container through SES Singapore; the recipient confirmed inbox delivery.
- The operator then used the real local frontend to sign up with a sandbox-verified NUS recipient, receive/submit the SES email OTP, complete Telegram verification through the real bot and log in.
- The operator confirmed that the frontend forgot-password/reset flow worked using the real emailed reset link.
- Telegram polling was temporarily disabled for the isolated email check, then re-enabled for the full onboarding test. Keep exactly one active poller per bot.
- These are manual local acceptance results, separate from the automated fake-SES tests. They do not prove deployed credentials, the gateway, Kafka-to-Credit allocation or the complete Order workflow. No personal email addresses, bot tokens, passwords or AWS credentials are recorded here.

#### Failure handling and limitations

- The SDK makes at most three attempts per call, with a 3-second connection timeout and a 10-second request timeout per attempt. A network timeout may mean SES accepted a message even though the response was lost, so duplicate emails are possible; codes/links remain subject to existing expiry/single-use checks.
- Signup delivery failures return sanitized `503`; the saved account stays unverified. Resend and password recovery keep their generic `202` even on delivery failures to avoid account enumeration. After resolving the issue, request a new code/link. Neither sending nor receiving an email automatically verifies a user.
- Email sending is synchronous and is **not** the durable Kafka verification outbox. A failed send is not queued across restarts; the user must request another message. Durable email jobs, application-level resend throttling and bounce/complaint automation remain production-hardening work. SES quotas apply, including the sandbox limit of one email per second; do not use real email for load-test users.
- Login-lockout notification emails are not implemented by this patch.
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

The `/api/v1/user/internal` prefix is blocked at the public Envoy gateway and the frontend nginx proxy. Internal authorization requires the user's bearer session; it does not use the separate Order lookup service token. `/api/v1/user/authorize` remains a temporary compatibility alias with identical authentication and responses, still blocked externally. Remove the alias and its exact-path blocks only after deployed Envoy, nginx and other direct callers have migrated. The canonical route is documented in Swagger; the legacy alias is not advertised as a separate operation.

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

See [API_CONTRACT_UPDATES.txt](API_CONTRACT_UPDATES.txt) for exact edits to the shared contract pasted on 18 October 2026, including the authentication exceptions, new endpoints, deletion behavior and the event-format question to resolve with the Credit Service owner. This is a copyable edit guide; the external shared document has not been changed.

- Add authenticated `POST /api/v1/user/request-telegram-verification`, no body, response `202 { telegramBotUrl, expiresAt }`; errors include `401`, `429`, and `503`.
- Keep `POST /api/v1/user/verify-telegram` authenticated with `{ otp }`, response `{ status, nextSteps }`. Keep the existing password recovery and profile password endpoints.
- Infrastructure and Credit Service owners: run the normal migration Job with the new image, then test that Credit grants 20 credits only after both verification steps. The event format is unchanged; delivery now retries from the database.
- Frontend owner: the current frontend's signup, email verification, Telegram verification, login and password recovery were exercised locally on 20 October 2026 without frontend source changes. The older `user-service-frontend-integration` proposal should not be merged wholesale over the current pages. The reported logout-control discoverability issue remains for frontend review.
- Infrastructure owner: rebuild the User image and configure `EMAIL_PROVIDER=ses`, `SES_FROM_EMAIL`, `AWS_REGION=ap-southeast-1` and the deployed `FRONTEND_BASE_URL`. Supply approved workload AWS access with `ses:SendEmail` scoped to the sender identity, not a developer's expiring local credentials. Configure bot secrets and one poller per bot as well. SES is still sandboxed: verify demo recipients in the same account/region. Do not enable development email logging in production.
- Still outstanding: deployed-environment email configuration/testing, login-lockout notification email, account escalation to Admin, Admin search/role/suspension endpoints and integration, and friendships. The complete frontend/Order/Credit/Admin journey has not been demonstrated by the local onboarding and service-level tests.

## Account deletion (F5)

```http
DELETE /api/v1/user/me
Authorization: Bearer <user-session-token>
Content-Type: application/json

{"confirm":true}
```

Returns `202 { message, scheduledDeletionAt }`. The deadline is six calendar months later, clamping month-end dates when necessary. All current sessions, outstanding reset links and verification challenges are revoked immediately. The last active administrator cannot schedule deletion (`409 LAST_ADMIN`).

Correct-password login before the deadline cancels deletion and creates a new session; old sessions remain revoked. Login and authorization reject an account whose deadline has passed, even if the cleanup worker has not run yet. The worker runs every `USER_DELETION_SWEEP_INTERVAL_SECONDS` (default 3600), removes up to 100 expired accounts per run, and uses database locks to coordinate with login and other workers. User-owned sessions, OTPs, challenges and verification outbox rows are removed through foreign-key cascades. A minimal audit trail stores UUIDs/action/reason, not profile fields. Other services retain their own records; no unagreed cross-service deletion event is invented here.

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

After success, the promoted account must **sign in again** using its existing password. `/api/v1/user/internal/authorize` then returns `isAdmin: true` and `permittedAction: true`. This fixes first-admin creation only: Admin Service must still use the agreed authorization URL/fields, and normal User-side role/search/suspension APIs remain separate integration work. There is no new bootstrap API row to add to the shared contract.

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
| GET | `/api/v1/user/internal/users/{userId}/telegram` | UUID path parameter | Dedicated `X-Service-Token`; returns `{ userId, telegramHandle }` for an active, verified, non-expired account. Private service DNS only; blocked at the gateway. |
| POST | `/api/v1/user/admin/users/{userId}/verify` | UUID path parameter; `{ reason }` (3–500 characters) | Verified admin bearer session, non-production feature flag; returns `{ userId, status, nextSteps, changed }`. |

### Order Service integration

```http
GET http://user:8080/api/v1/user/internal/users/<uuid>/telegram
X-Service-Token: <dedicated-shared-secret>
```

The infrastructure owner must configure the same dedicated `ORDER_USER_LOOKUP_TOKEN` in User Service and securely supply it to Order. Order sends that value in `X-Service-Token`; it must never be sent to or stored in the frontend. An empty or incorrect token returns `404`; invalid UUIDs return `400`, missing/suspended/expired accounts `404`, and unverified accounts `409`. Only user ID and handle are returned, with `Cache-Control: no-store`.

Order remains responsible for authenticating the requester/courier and enforcing order participation. Derive the acting UUID from the gateway's trusted `x-user-id`, rather than trusting a UUID supplied by the frontend. The service token authorizes the Order backend to perform lookups; it does not prove which user is acting.

### Admin Service / load tests

```http
POST /api/v1/user/admin/users/<uuid>/verify
Authorization: Bearer <actual-admin-session-token>
Content-Type: application/json

{"reason":"D3 load-test setup"}
```

This sets missing email/Telegram verification timestamps on synthetic non-production users. It does not grant admin roles, change Telegram identity IDs, unlock accounts, or reinstate suspended users. Suspended accounts and accounts pending deletion are rejected. The first actual change is audited with the admin UUID, target UUID, reason and time. Repeating the request is idempotent; `UserVerified` is queued once through the existing outbox.

It defaults to `404` unless `ENABLE_TEST_VERIFICATION=true` and `APP_ENV` is explicitly a permitted non-production environment (`local`, `development`, `dev`, `test`, `staging`, `stg`). When `APP_ENV` is absent it falls back to `NODE_ENV`; production/unknown environments remain disabled. Runtime Node images may use `NODE_ENV=production` even in non-production clusters, so set the real environment explicitly with `APP_ENV`. Never enable this override in production. The normal signup domain/password rules still apply to synthetic users.

Admin Service must forward its administrator's real `Authorization` header when calling this endpoint. Fake `admin-*` tokens and caller-supplied identity headers do not authenticate an admin. Use the deployment-only first-admin bootstrap command above to establish the first real admin; this test-verification endpoint does not grant roles. No public first-admin shortcut is introduced. The optional inverse operation is deliberately not added because reversing verification/credits needs a separate agreed workflow.

### Infrastructure and Admin Service integration review

- User Service uses opaque bearer session tokens, not JWTs. The gateway sends `Authorization` directly to `/api/v1/user/internal/authorize` (`POST` or the original request method is accepted). It then injects `x-user-id`, `x-is-admin`, and `x-permitted-action` from that response after stripping client-supplied copies early. The gateway and frontend nginx configurations now call this canonical path; existing deployed callers can temporarily use the legacy alias.
- Gateway authentication proves identity; each service must still check permission. `x-permitted-action=false` is a valid authenticated `Created` account and must not be allowed to create/accept orders. Services must not be publicly reachable through a route that bypasses this trusted gateway boundary.
- In the previously fetched Admin branch, `core/security.py` calls `/api/v1/user/me/authorize` and expects `role`/`email`. Its owner must migrate it to `/api/v1/user/internal/authorize` over private service DNS and check `authenticated`, `isAdmin`, and `permittedAction`; only `userId` is guaranteed as identity. That branch is not modified here. Its role/status/search relays also need an agreed User Service contract and forwarded credentials; they are not implemented by these two new endpoints.
- Rebuild the User image and run the migration Job. Configure the dedicated Order lookup secret. For load tests only, explicitly set the non-production `APP_ENV` and enable the override. Keep the production override disabled. Apply the gateway chart update to block `/api/v1/user/internal` externally.
- The local machine currently has no selected Kubernetes context. The gateway configuration was reviewed and chart checks run locally; no live Envoy cluster or full service-to-service flow was tested here. Run `helm test` and an authenticated end-to-end order test in the team's cluster before treating integration as complete.

### Isolated lifecycle integration test

With local PostgreSQL running on port 5554 and dependencies installed:

```powershell
npm.cmd run prisma:generate
npm.cmd run build
npm.cmd run test:integration:lifecycle
```

The script creates a uniquely named temporary database, applies all migrations, starts a test API, and exercises deletion, restoration, cleanup, last-admin concurrency, service-token access, non-admin denial and audited test verification. It then drops only its own temporary database. It neither changes the normal `user_db` records nor sends email/Telegram messages, and does not change your `.env`.
