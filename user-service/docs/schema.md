# User Service database schema

A **schema** is the database blueprint: the tables, their columns, allowed values and relationships. A table is like a spreadsheet; a row is one record and a column is one field.

We already have an executable schema in [prisma/schema.prisma](../prisma/schema.prisma). This guide explains it; it does not introduce another schema or change the database. [Prisma migrations](../prisma/migrations) record the SQL changes applied to existing databases. See the [architecture guide](architecture.md) for how the database fits into the service.

## Table relationships

All eight tables belong to the User Service PostgreSQL database. They are not separate databases or containers. The diagram shows selected columns; the tables below explain every stored field.

User report and suspension-appeal intake adds no User table or migration. Admin Service owns report/appeal records and review state in its own database; they are intentionally absent from this diagram. User checks accounts and forwards only the necessary UUIDs and trimmed text, never passwords or bearer tokens. Submission does not change suspension status or create a session. The appeal attempt limiter is bounded process memory keyed by normalized email hash, not a Prisma table; it resets on restart and is not distributed. Generic `/me/escalate` and Created-account verification help still need an agreed API.

```mermaid
erDiagram
    User ||--o{ EmailVerificationOtp : has
    User ||--o{ AuthSession : has
    User ||--o{ PasswordResetToken : has
    User ||--o{ TelegramVerificationChallenge : has
    User ||--o| UserVerifiedOutbox : queues
    User ||--o{ Friendship : sends
    User ||--o{ Friendship : receives

    User {
        uuid id PK
        string email UK
        string name
        string passwordHash
        string telegramHandle UK
        string telegramUserId UK "nullable"
        datetime emailVerifiedAt "nullable"
        datetime telegramVerifiedAt "nullable"
        UserRole role
        AccessStatus accessStatus
    }
    Friendship {
        uuid id PK "API requestId"
        uuid senderId FK
        uuid recipientId FK
        FriendshipStatus status
        datetime createdAt
        datetime updatedAt
    }
    EmailVerificationOtp {
        uuid id PK
        uuid userId FK
        string otpHash
        datetime expiresAt
    }
    AuthSession {
        uuid id PK
        uuid userId FK
        string tokenHash UK
        datetime expiresAt
    }
    PasswordResetToken {
        uuid id PK
        uuid userId FK
        string tokenHash UK
        datetime expiresAt
    }
    TelegramVerificationChallenge {
        uuid id PK
        uuid userId FK
        string linkHash UK
        string otpHash "nullable"
        datetime expiresAt
    }
    UserVerifiedOutbox {
        uuid id PK
        uuid userId FK,UK
        datetime publishedAt "nullable"
    }
    UserAuditLog {
        uuid id PK
        uuid actorUserId "nullable; not a foreign key"
        uuid targetUserId "not a foreign key"
        string action
        string reason
        datetime createdAt
    }
```

- **PK (primary key):** uniquely identifies a row. Every table uses an application-generated UUID `id`.
- **FK (foreign key):** a database-enforced reference to another row. Five child tables use `userId` to reference `User.id`; `Friendship` references `User.id` twice, through `senderId` and `recipientId`.
- **UK (unique key):** prevents duplicate values. Nullable unique fields allow multiple rows with no value, but not duplicate non-null values.
- **Nullable:** the field can be empty (`null`), usually meaning an action has not happened yet.
- **One-to-many:** one user may have zero or many OTPs, sessions, reset tokens and Telegram challenges. A user may also send and receive many friendship rows; each friendship has exactly one sender and one distinct recipient.
- **One-to-zero-or-one:** one user may have at most one verification-outbox row, enforced by its unique `userId`.

`UserAuditLog` intentionally has no relationship line: its UUID references are **not foreign keys**. This lets the minimal audit record survive account removal. UUIDs still identify records and should be treated as sensitive, not as anonymous data.

## Common types and conventions

Prisma `String @db.Uuid` is a PostgreSQL UUID; ordinary `String` fields are text. `DateTime` records timestamps and `Int` stores whole numbers. See the schema and migration SQL for exact database types and defaults.

Every table has `id` (UUID, primary key, generated with `uuid()`) and `createdAt` (timestamp, defaults to creation time). Each table section below lists its remaining stored fields. Prisma relation properties such as `User.sessions` are navigation helpers, not extra columns storing copies of child rows.

### User: the account

| Field | Meaning / rule |
| --- | --- |
| `email` | Required unique normalized email. Signup accepts configured NUS domains. |
| `name` | Required display name. The API trims it and enforces 2-100 characters; it is not derived from the email prefix. |
| `passwordHash` | Required encoded scrypt value containing algorithm, cost, random salt and derived hash. Not a recoverable encrypted password. |
| `telegramHandle` | Required unique normalized username, without the leading `@`. |
| `emailVerifiedAt` | Nullable timestamp; set after successful email verification. |
| `telegramVerifiedAt` | Nullable timestamp; set after successful Telegram verification. |
| `telegramUserId` | Nullable unique Telegram account ID, stored as text. Linked during real bot verification; distinct from the username. |
| `role` | `USER` or `ADMIN`; defaults to `USER`. |
| `accessStatus` | `ACTIVE` or `SUSPENDED`; defaults to `ACTIVE`. This is not the public Created/Verified/Suspended status. |
| `failedLoginAttempts` | Required counter, defaults to `0`; used for login lockout. |
| `lockedAt` | Nullable timestamp indicating login lockout; password reset clears it. |
| `lastLoginAt` | Nullable timestamp of the most recent successful login. |
| `deletionRequestedAt` | Nullable timestamp of a deletion request. |
| `scheduledDeletionAt` | Nullable removal deadline, normally six calendar months after the request. |
| `suspendedAt` | Nullable suspension timestamp. |
| `suspensionReason` | Nullable stored suspension reason. |
| `authVersion` | Integer starting at `0`, incremented by credential/administrative changes. It is not a JWT version claim or the sole revocation mechanism; sessions are explicitly revoked too. |
| `updatedAt` | Timestamp maintained by Prisma on account updates. |

The name/email/handle rules are application validation; the schema does not impose a 100-character database limit on `name` or a database email-domain check. Required/unique fields, UUID types, enums and foreign keys are database constraints.

### Friendship: invitations, accepted friends and history

| Field | Meaning / rule |
| --- | --- |
| `senderId` | Required UUID FK to `User.id`; relation role `FriendshipSender`. Physical sender deletion cascades the row. |
| `recipientId` | Required UUID FK to `User.id`; relation role `FriendshipRecipient`. Physical recipient deletion cascades the row. |
| `status` | `FriendshipStatus`: `PENDING` (default), `ACCEPTED`, `REJECTED` or `REMOVED`. API responses use lowercase. |
| `updatedAt` | Timestamp maintained by Prisma when the row changes. |

The common `id` is the API's `requestId`; `createdAt` records the invitation's creation. `User.sentFriendships` and `User.receivedFriendships` are Prisma navigation properties for the two roles, not additional account columns. An accepted friendship is mutual even though its original sender/recipient remain stored.

The [20261027000000_friendships migration](../prisma/migrations/20261027000000_friendships/migration.sql) adds two custom SQL constraints that Prisma 5 cannot fully express:

- `Friendship_not_self` CHECK enforces `senderId <> recipientId`.
- `Friendship_active_pair_key` is a unique index on `(LEAST(senderId, recipientId), GREATEST(senderId, recipientId))` only where status is `PENDING` or `ACCEPTED`. This enforces at most one active relation for the unordered pair, including crossed/concurrent requests.

Rejected/removed rows do not occupy the active-pair index, so history can coexist with a later invitation. Resending inserts a new row with a fresh UUID; it never repurposes an old request ID. A crossed request conflicts instead of auto-accepting. The application permits `PENDING` to become `ACCEPTED` or `REJECTED`, and removal changes only `ACCEPTED` to `REMOVED`. These transition/actor rules are application checks; the enum alone does not enforce them. Same-action accept/reject retries are idempotent while the resulting state remains current; removal never cancels a pending request.

Only an active caller with no deletion requested/scheduled may use friendship APIs; completed email/Telegram verification is not an additional requirement. Suspended/deleting peers are excluded from friend/request lists and send targets. Acceptance requires an available sender, including retries; rejection/removal can operate on an existing relation with an unavailable peer. These availability rules filter/check account rows rather than deleting friendship history or changing its status. API user summaries expose only `id`/`name`, never email, Telegram, role or credentials.

### EmailVerificationOtp: email verification attempts

| Field | Meaning / rule |
| --- | --- |
| `userId` | Required FK to the account. |
| `otpHash` | Required HMAC-SHA-256 digest bound to the normalized email and server OTP secret; not the six-digit code itself. |
| `expiresAt` | Required expiry timestamp. |
| `attemptCount` | Failed-attempt counter, defaults to `0`. |
| `usedAt` | Nullable timestamp marking a consumed code. |
| `revokedAt` | Nullable timestamp marking an invalidated code. |

Historical rows can remain after use, expiry or revocation. The verification handler selects/checks eligible records; row existence does not mean a code is valid.

### AuthSession: successful logins

| Field | Meaning / rule |
| --- | --- |
| `userId` | Required FK to the account. |
| `tokenHash` | Required unique SHA-256 hash of a random bearer token; not the raw client token. |
| `expiresAt` | Required session expiry. |
| `revokedAt` | Nullable timestamp; set to invalidate a session before expiry. |
| `lastUsedAt` | Nullable timestamp updated during authentication. |

One account can have multiple sessions, such as separate browser logins. Authentication also checks current account restrictions; a stored row is not proof of usable access.

### PasswordResetToken: password-recovery links

| Field | Meaning / rule |
| --- | --- |
| `userId` | Required FK to the account. |
| `tokenHash` | Required unique SHA-256 hash of the random token in the reset link. |
| `expiresAt` | Required expiry timestamp. |
| `usedAt` | Nullable timestamp; a successful reset consumes the token. |
| `revokedAt` | Nullable timestamp; invalidates replaced or cancelled links. |

The raw reset token is delivered in the link, not stored in this table. A successful reset changes the password, clears login lockout and revokes existing sessions.

### TelegramVerificationChallenge: linking and verifying Telegram

| Field | Meaning / rule |
| --- | --- |
| `userId` | Required FK to the account. |
| `linkHash` | Required unique hash of the random token in the bot deep link. |
| `otpHash` | Nullable HMAC digest; set when an OTP is prepared for the matching Telegram sender. |
| `telegramUserId` | Nullable Telegram sender ID, stored as text. The unique linked-account constraint is on `User.telegramUserId`, not this history field. |
| `expiresAt` | Required challenge/code expiry. |
| `sentAt` | Nullable timestamp recording OTP sending. |
| `attemptCount` | Failed-attempt counter, defaults to `0`. |
| `usedAt` | Nullable timestamp marking successful consumption. |
| `revokedAt` | Nullable timestamp invalidating the challenge. |

The bot checks the sender against the registered handle. The user then submits the OTP through the authenticated application. Merely pressing Start does not finish verification. The local development logger is a separate testing path, not proof of real Telegram ownership.

### UserVerifiedOutbox: reliable intention to publish verification

| Field | Meaning / rule |
| --- | --- |
| `userId` | Required unique FK to the account: at most one outbox record per user. |
| `email` | Required email snapshot included in the verification event. This table contains personal data. |
| `publishedAt` | Nullable timestamp. `null` means pending; otherwise Kafka acknowledged publication and the marker was saved. |

The common `id` becomes `eventId`, and `createdAt` becomes `occurredAt` in the event. They remain stable on retries. The outbox row is saved in the same transaction as completion of verification, so an event intention is not lost between those database writes.

The worker publishes to `foc.user.status` (configurable), keyed by user UUID, with `{ eventId, type: "UserVerified", occurredAt, data: { userId, email } }`. If publication succeeds but saving `publishedAt` fails, another delivery is possible. Consumers must handle duplicates. A published marker does not prove Credit has finished processing. This is an event outbox, not an email-delivery queue or the full verification history.

### UserAuditLog: minimal administrative audit trail

| Field | Meaning / rule |
| --- | --- |
| `actorUserId` | Nullable UUID of the acting administrator; not an FK. Bootstrap uses `null` because an operator runs it outside an application session. |
| `targetUserId` | Required UUID of the affected account; not an FK. |
| `action` | Required action identifier, such as `FIRST_ADMIN_BOOTSTRAPPED`. |
| `reason` | Required reason text supplied by the operation. |

The table has no dedicated email, name, Telegram or credential columns. It survives deletion and is not automatically cascaded away. Do not put personal data or secrets in free-text reasons. It is not a log of every login or every profile read, and it does not replace Admin Service's separate audit/event responsibilities.

## Status is computed, not a single stored label

The API's account status comes from [status.ts](../src/status.ts):

| Stored account fields | Public status |
| --- | --- |
| `accessStatus = SUSPENDED` | `Suspended`, regardless of verification timestamps |
| `accessStatus = ACTIVE` and both verification timestamps are set | `Verified` |
| `accessStatus = ACTIVE` and either timestamp is missing | `Created` |

`ACTIVE` therefore does **not** mean fully verified. `role = ADMIN` is a separate question from verification or suspension.

Login lockout (`lockedAt`) and pending deletion (`scheduledDeletionAt`) are also separate from this public label. A `Verified` label alone is not an access-control decision; session validity, account restrictions and operation-specific checks still apply. Reinstatement clears suspension, not missing verification or login lockout. The non-production verification override is a separately gated exception and is not a production onboarding path.

With the correct password before the deletion deadline, suspended login returns `403 ACCOUNT_SUSPENDED` even if `lockedAt` is set, without creating a session or clearing the lock. Active locked login remains generic `401`. Appeals also reject locked accounts with generic `401`; the existing password-reset flow must clear the lock before an appeal can proceed. These checks add no stored state or schema change.

## Expiry, deletion and indexes

All six FK-linked child tables use `onDelete: Cascade`: physically deleting a `User` also deletes its OTPs, sessions, reset tokens, Telegram challenges, outbox row and friendships where it is sender or recipient. Scheduling deletion is not immediate physical deletion. It revokes credentials, sets a deadline and lets the cleanup worker remove the account after that deadline. Correct-password login before the deadline can cancel the request; it does not restore old revoked sessions.

There is no automatic retention sweep for all expired OTP/session/reset/challenge rows described by this schema. Expiry makes a credential unusable through application checks; it does not by itself delete its row. Audit retention and any future cleanup policy need separate operational decisions.

Explicit non-unique indexes are:

| Table | Indexed fields |
| --- | --- |
| `User` | `accessStatus`; `scheduledDeletionAt` |
| `Friendship` | `(senderId, status, createdAt, id)`; `(recipientId, status, createdAt, id)` |
| `EmailVerificationOtp` | `(userId, createdAt)`; `expiresAt` |
| `AuthSession` | `userId`; `expiresAt` |
| `PasswordResetToken` | `userId`; `expiresAt` |
| `TelegramVerificationChallenge` | `(userId, createdAt)`; `expiresAt` |
| `UserVerifiedOutbox` | `(publishedAt, createdAt)` |
| `UserAuditLog` | `(targetUserId, createdAt)` |

An index helps PostgreSQL locate matching rows without scanning the whole table. Primary/unique constraints also create indexes. Indexes do not independently enforce code expiry or application permissions.

The custom unique `Friendship_active_pair_key` described above is additional to these non-unique indexes. Use the migration SQL to install it and the not-self CHECK; `prisma db push` alone does not reproduce those protections.

## Changing the schema safely

Report/appeal intake leaves the executable User schema unchanged. The friendship migration `20261027000000_friendships` still needs deployment through the normal migration workflow; adding moderation forwarding does not install it. Admin's open-record deduplication keeps one open appeal per user and one open report per ordered reporter/target pair, preserving original text on retries; it is not a lifetime limit or a User database constraint. Admin-owned retention and account-deletion handling require their own contract, beyond User's existing cascades.

Historical checks before the camelCase response fix, reported on 30 October 2026, passed: TypeScript build, Prisma generation/validation, 83/83 unit tests, all seven isolated integration suites (email, lifecycle, admin-bootstrap, admin-users, lockout, friendships and account-support), strict new-unit-test type checking and integration-script syntax checks. All temporary databases were cleaned up. Support integration used real User HTTP/PostgreSQL with an HTTP Admin stub, not the actual Admin application or database. The Node 20 production Docker build and network-isolated smoke test passed (Node 20.20.2, non-root, 256 MiB, no `.env`, health/OpenAPI checks; no database or real Admin exercised). The 183-package install audit and Docker `npm ci` reported zero vulnerabilities. No normal database was migrated, no real email/bot messages were sent and no cloud deployment occurred. Actual Admin, cloud/frontend, gateway/mesh, load and full cross-service acceptance remain unproven; infrastructure changes are handoff only.

Changing documentation does not change PostgreSQL. A future structural change normally requires updating `schema.prisma`, generating/reviewing a migration, applying it to the intended database through the project's migration workflow, regenerating Prisma Client and testing the affected flows. Existing databases need migrations; rebuilding an application image alone is not enough.

Keep this guide aligned with the executable schema and custom migration SQL. Friendship storage is implemented in this checkout by migration `20261027000000_friendships`. Reported validation on 27 October 2026 passed Prisma Client generation, `prisma validate`, the TypeScript build, 74/74 unit tests and the friendship integration script's `node --check`. All six isolated integration suites passed after the new migration/code: friendships, email, lifecycle, admin-bootstrap, admin-users and lockout. The friendship suite applied migrations to real local PostgreSQL in a disposable `user_friendships_it_<random>` database; it checked direct self/pair constraints, concurrency, fresh request IDs and cascades alongside HTTP behavior. All temporary test databases were cleaned up by their scripts. No normal database was migrated or normal account mutated, no real messages were sent, and the application container and Telegram poller were not started. Live/frontend, deployed, load and cross-service end-to-end acceptance remain unproven. Generic account-escalation storage remains unimplemented; implemented report/appeal storage is Admin-owned and absent from this User diagram. For setup and existing test commands, use the [README](../README.md) rather than copying credentials or duplicating command lists here.
