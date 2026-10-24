# Admin Service

FastAPI + PostgreSQL + Kafka service for Friend on Campus (FoC) admin operations:
user search/promote/demote/suspend/reinstate (F1), and delivery-conflict intake,
AI evaluation, claim, and resolution (F3). See
[`docs/schema.md`](docs/schema.md) for the data model.

Listens on **8084**. Interactive docs at `http://localhost:8084/docs` once the app is up.

## What this service owns

- Admin-only HTTP APIs (authorization checked against User Service on every request).
- Conflict cases and an append-only `audit_logs` table (its own Postgres).
- Kafka **producer** events that other services consume (Order, User, etc.).
- Durable APScheduler jobs for AI evaluation, deadline reminders, and auto-resolve.

It does **not** own user records. Search, role, and status changes are relayed to User Service.

## Folder structure

```
admin-service/
├── app/
│   ├── main.py                   # FastAPI app, lifespan (Kafka + scheduler), /health
│   ├── config.py                 # env-driven settings (pydantic-settings)
│   ├── database.py               # async SQLAlchemy engine/session
│   ├── core/
│   │   └── security.py           # require_admin: gateway identity headers, 404 not 403
│   ├── models/
│   │   ├── conflict_case.py      # conflict_cases + ConflictStatus / FaultParty
│   │   └── audit_log.py          # append-only audit trail
│   ├── schemas/
│   │   ├── admin.py              # user list / action DTOs
│   │   └── conflict.py           # conflict request/response DTOs
│   ├── routers/
│   │   ├── users.py              # /api/v1/admin/users*
│   │   └── conflicts.py          # /api/v1/admin/conflicts*
│   ├── services/
│   │   ├── kafka_producer.py     # shared event envelope + topic publishes
│   │   ├── kafka_consumer.py     # listener; no topics subscribed yet
│   │   ├── ai_client.py          # Gemini Flash fault recommendation
│   │   ├── order_photos.py       # fetch evidence bytes from Order Service
│   │   ├── audit.py              # single write path into audit_logs
│   │   ├── conflict_resolution.py# the only resolve path (manual + auto)
│   │   └── scheduler.py          # job registration / cancel (APScheduler)
│   └── jobs/
│       └── conflict_jobs.py      # AI eval, reminder, auto-resolve (own DB session)
├── alembic/                      # migrations (init + conflict stages)
├── tests/
├── mock_user_service.py          # local stub for User Service
├── docker-compose.yml            # Postgres, mock User Service, app (Kafka is Order's)
├── Dockerfile
├── requirements.txt
└── .env.example
```

## Why it's laid out this way

- **`core/security.py` is the one place admin authorization lives.** Admin routes
  depend on `AdminDep`, so “read the gateway identity headers, 404 not 403”
  cannot be skipped or duplicated inconsistently. Conflict intake is open:
  Order Service calls it directly and does not send gateway headers.
- **`services/` talks to infra outside this service’s DB** — Kafka, the AI
  provider, downstream HTTP. Routers stay thin.
- **`jobs/` is separate from `services/scheduler.py`:** scheduler only registers
  or cancels jobs; `conflict_jobs.py` is the work that runs later, outside a
  request, so it opens its own DB session.
- **`services/conflict_resolution.py` is the only resolve path** (manual and
  deadline auto-resolve). One conditional `UPDATE` enforces the state machine.
- **`services/audit.py` is the only write path** for `audit_logs`. Migration
  `0003_audit_logs_append_only` rejects `UPDATE`, `DELETE`, and `TRUNCATE` in
  the database as well.
- **`services/ai_client.py` isolates the VLM call.** Provider, prompt, or
  response shape changes stay in that file.

## Auth

| Caller | Mechanism | Failure |
|---|---|---|
| Admin UI / admin user | Gateway sets `x-user-id`, `x-is-admin=true`, and `x-permitted-action=true` (role `ADMIN`, account active, email and Telegram verified). Search and role/status changes also forward that caller's `Authorization` bearer to User Service | **404** (never 403) |
| Order Service (intake) | No auth. `POST /api/v1/admin/conflicts` is open | — |

A missing user id, a non-admin, and an admin who is not permitted all get the same **404**.

`tests/test_gateway.py` checks those headers without Docker. The live tests in `tests/` send the same headers. User search, promote, demote, suspend, and reinstate still call User Service for the user record itself.

## HTTP API

Health (no auth): `GET /health` → `{ "status": "ok" }`.

### Users — `/api/v1/admin/users` (admin)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/admin/users?search=&page=1` | Relays to User Service search |
| POST | `/api/v1/admin/users/{user_id}/promote` | Relays role=`admin`; audits; Kafka `UserPromoted` |
| POST | `/api/v1/admin/users/{user_id}/demote` | Cannot demote self; role=`user`; `UserDemoted` |
| POST | `/api/v1/admin/users/{user_id}/suspend` | Relays status=`suspended`; `UserSuspended` |
| POST | `/api/v1/admin/users/{user_id}/reinstate` | Relays status=`verified`; `UserReinstated` |

### Conflicts — `/api/v1/admin/conflicts`

**Intake (no auth):**

```http
POST /api/v1/admin/conflicts
```

```json
{
  "orderId": "ord-123",
  "reporterUserId": "u-1",
  "comment": "Item arrived damaged",
  "photos": [
    "<orderId>/collection.jpg",
    "<orderId>/delivery.png",
    "<orderId>/dispute.webp"
  ]
}
```

Returns **201**. Idempotent per `orderId`: a retry returns the existing case.
`photos` are Order's private object keys, in collection / delivery / dispute
order. The case is saved as `created` immediately; AI runs as a background job
so a slow VLM cannot time out Order Service. That job reads each key from
Order's photo bucket (`GetObject`) and sends the bytes to Gemini. A missing
object records `ai_failed`.

**Admin:**

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/admin/conflicts?status=` | Filter by status; aliases `pending` → `ai_evaluated`, `non_deadline` → `ai_failed` |
| GET | `/api/v1/admin/conflicts/{case_id}` | Detail |
| POST | `/api/v1/admin/conflicts/{case_id}/review` | Claim: `ai_evaluated` \| `ai_failed` → `under_review`; Kafka `admin.review.started` |
| POST | `/api/v1/admin/conflicts/{case_id}/resolve` | Body `{ "faultParty": "requester\|courier\|no-fault", "decision": "accept\|reject" }` |

Claim is idempotent for the same admin. Another admin (or wrong status) gets **409**.

## Conflict state machine

```
created  →  ai_evaluated  →  under_review  →  resolved
         →  ai_failed     ↗
```

- **created:** persisted; AI job queued.
- **ai_evaluated:** VLM returned a valid `fault_party` + confidence.
- **ai_failed:** timeout, HTTP error, or invalid model output (no default verdict). Admins still claim and resolve by hand.
- **under_review:** claimed by an admin.
- **resolved:** manual resolve, or deadline auto-resolve following the AI verdict (if present and above `AUTO_RESOLVE_MIN_CONFIDENCE`).

Default deadline is 168 hours (7 days); a reminder job is scheduled
`REMINDER_BEFORE_DEADLINE_HOURS` before expiry (default 24h).

`faultParty` values: `requester`, `courier`, `no-fault`.

## Kafka events (producer)

Order consumes two flat events on `foc.admin.events`. The Kafka key is the order id.

```json
{ "eventId": "<uuid>", "eventType": "admin.review.started", "schemaVersion": 1, "occurredAt": "<ISO-8601 UTC>", "orderId": "<id>", "caseId": "<id>" }
```

`admin.case.resolved` uses the same fields. `schemaVersion` is `1`. `eventId` is the idempotency key.

The other events still use the wrapped envelope `{ eventId, eventType, version, timestamp, payload }`.

| Event | Default topic | When |
|---|---|---|
| `ConflictCaseCreated` | `admin.conflict-case-created` | After intake commit |
| `admin.review.started` | `foc.admin.events` | After an admin claims a case |
| `admin.case.resolved` | `foc.admin.events` | After resolve (manual or auto). Order completes the order; this message has no credit or rating fields |
| `UserPromoted` | `admin.user.promoted` | After User Service accepts promote |
| `UserDemoted` | `admin.user.demoted` | After demote |
| `UserSuspended` | `admin.user.suspended` | After suspend |
| `UserReinstated` | `admin.user.reinstated` | After reinstate |

Keys: `orderId` for conflict events, `userId` for user events. Intake and
resolve **commit the DB first**; Kafka failures are logged, not returned as 500.

`kafka_consumer.py` starts with the app as group `admin-service-listener` and
currently subscribes to no topics.

**In Kubernetes** (`deploy/values/services/admin.yaml`) only `foc.admin.events`
is published. It is the one admin topic in the cluster's event catalog
(`deploy/charts/foc-kafka`, ADR-0004), and nothing consumes the others yet.
The other topic settings are set to `""`, which skips that publish, and the
listener is off (`KAFKA_CONSUMER_ENABLED=false`): the ACLs only let admin read
`foc.admin.commands`. To publish another event, add its topic and ACL to
`foc-kafka` first. The chart's `KAFKA_BROKERS`, `KAFKA_USERNAME`,
`KAFKA_PASSWORD` and `KAFKA_CA_CERT` switch the client to SASL_SSL with
SCRAM-SHA-512. Without a username it stays plaintext, as in compose.

## Local port scheme (team convention)

| Service | Host port |
|---|---|
| User Service | 8080 |
| Supplier Service | 8081 |
| Credit Service | 8082 |
| Order Service | 8083 |
| **Admin Service** | **8084** |
| Rating Service | 8085 |
| Badges Service | 8086 |
| Admin Service Postgres | 5434 (container: 5432) |
| Admin Service mock User Service | 8090 (stand-in for 8080 until the real service is wired) |

Each service should map its own Postgres to a distinct host port if you run
several compose files on one machine.

## Running with Docker Compose

From `admin-service/`:

From `order-service/` (so the network is named `order-service_default`):

```bash
docker compose up -d kafka
```

Then from `admin-service/`:

```bash
docker compose up --build
```

Start Order's Kafka first. This file does not start a broker. It starts Postgres,
mock User Service, and the app on **8084**, and joins Order's Compose network so
the container can use `kafka:29092`. The container talks to `db:5432` and
`http://mock-user-service:8000`.

Apply migrations against the mapped Postgres (from the host, with `.env` pointing at `localhost:5434`):

```bash
cp .env.example .env
pip install -r requirements.txt
alembic upgrade head
```

## Running the API on the host

`.env.example` is for **host-side** tools (`alembic`, `pytest`, local `uvicorn`).
Hostname `db` only works inside this Compose network. `localhost:9092` is
Order's broker, the same one Credit uses from the host.

```bash
cp .env.example .env
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8084
```

You still need Postgres, and Order's Kafka if you want publishes to succeed.
Easiest path: start Order's Kafka, then `docker compose up db mock-user-service`,
then run uvicorn on the host with `KAFKA_BOOTSTRAP_SERVERS=localhost:9092`.

## Tests

```bash
pytest
```

`tests/test_settings.py` covers the Kubernetes settings: the database URL form
and the Kafka login (no live stack).
`tests/test_conflicts.py` covers the 404-not-403 admin check (ASGI, no live stack).
`tests/conftest.py` also exposes a live-API client fixture against
`http://localhost:8084` with `Authorization: Bearer admin-sahana` (skips if the
stack is down).

## Still open

- Deadline reminder does not notify anyone. `send_deadline_reminder` only sets
  `reminder_sent_at`. Email or an in-app notice is still a TODO.
- User Service is still the mock. Compose points `USER_SERVICE_BASE_URL` at
  `mock-user-service`. That stub should be removed once the real User Service
  contract is wired.
- A failed Kafka publish is only logged. The database commits first, and if
  Kafka is down the API still succeeds. There is no outbox to retry that event
  later.
- First admin. Promote requires an existing admin, so this service cannot create
  the first one. The mock treats any `admin-*` bearer token as an admin. There
  is no bootstrap or seed for a real first admin account.
- AI integration. `ai_client.py` calls Gemini 3.8 Flash after intake. Photos
  are read from Order's bucket and sent as inline base64 (`inline_data`),
  each with a collection / delivery / dispute label. Copy `.env.example` to
  `.env` and set `AI_PROVIDER_API_KEY` to a Google AI Studio key. Compose
  reads that file. An empty key, a timeout, a missing object, or an unusable
  reply records `ai_failed`.
