# Admin Service

FastAPI + PostgreSQL + Kafka service for Friend on Campus (FoC) admin operations:
user search/promote/demote/suspend/reinstate (F1), and delivery-conflict intake,
AI evaluation, claim, and resolution (F3).

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
│   │   ├── security.py           # require_admin: User Service every request, 404 not 403
│   │   └── service_auth.py       # X-Service-Token for Order Service intake
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
│   │   ├── ai_client.py          # Anthropic VLM fault recommendation
│   │   ├── audit.py              # single write path into audit_logs
│   │   ├── conflict_resolution.py# the only resolve path (manual + auto)
│   │   └── scheduler.py          # job registration / cancel (APScheduler)
│   └── jobs/
│       └── conflict_jobs.py      # AI eval, reminder, auto-resolve (own DB session)
├── alembic/                      # migrations (init + conflict stages)
├── tests/
├── mock_user_service.py          # local stub for User Service
├── docker-compose.yml            # Postgres, Kafka, mock User Service, app
├── Dockerfile
├── requirements.txt
└── .env.example
```

## Why it's laid out this way

- **`core/security.py` is the one place admin authorization lives.** Admin routes
  depend on `AdminDep`, so “check User Service on every request, 404 not 403”
  cannot be skipped or duplicated inconsistently.
- **`core/service_auth.py` is separate** because Order Service is not an admin.
  Intake uses `X-Service-Token` (`SERVICE_API_KEY`), still returning 404 on failure.
- **`services/` talks to infra outside this service’s DB** — Kafka, the AI
  provider, downstream HTTP. Routers stay thin.
- **`jobs/` is separate from `services/scheduler.py`:** scheduler only registers
  or cancels jobs; `conflict_jobs.py` is the work that runs later, outside a
  request, so it opens its own DB session.
- **`services/conflict_resolution.py` is the only resolve path** (manual and
  deadline auto-resolve). One conditional `UPDATE` enforces the state machine.
- **`services/audit.py` is the only write path** for `audit_logs`. Nothing else
  should `UPDATE`/`DELETE` that table.
- **`services/ai_client.py` isolates the VLM call.** Provider, prompt, or
  response shape changes stay in that file.

## Auth

| Caller | Mechanism | Failure |
|---|---|---|
| Admin UI / admin user | `Authorization: Bearer <token>` → User Service `GET /api/v1/user/me/authorize`; `role` must be `admin` | **404** (never 403) |
| Order Service (intake) | `X-Service-Token` matching `SERVICE_API_KEY` | **404** |

If User Service is unreachable, admin checks fail closed (404).

With the bundled mock User Service, any token starting with `admin-` is treated
as an admin (e.g. `Authorization: Bearer admin-sahana`).

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

**Intake (service token, not admin):**

```http
POST /api/v1/admin/conflicts
X-Service-Token: <SERVICE_API_KEY>
```

```json
{
  "orderId": "ord-123",
  "reporterUserId": "u-1",
  "comment": "Item arrived damaged",
  "photos": ["https://.../before.jpg", "https://.../after.jpg"]
}
```

Returns **201**. Idempotent per `orderId`: a retry returns the existing case.
The case is saved as `created` immediately; AI runs as a background job so a
slow VLM cannot time out Order Service.

**Admin:**

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/admin/conflicts?status=` | Filter by status; aliases `pending` → `ai_evaluated`, `non_deadline` → `ai_failed` |
| GET | `/api/v1/admin/conflicts/{case_id}` | Detail |
| POST | `/api/v1/admin/conflicts/{case_id}/review` | Claim: `ai_evaluated` \| `ai_failed` → `under_review`; Kafka `OrderUnderReview` |
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

Envelope (all topics):

```json
{
  "eventId": "<uuid>",
  "eventType": "<Type>",
  "version": 1,
  "timestamp": "<ISO-8601 UTC>",
  "payload": {}
}
```

| Event | Default topic | When |
|---|---|---|
| `ConflictCaseCreated` | `admin.conflict-case-created` | After intake commit |
| `OrderUnderReview` | `admin.order-under-review` | After an admin claims a case |
| `ConflictResolved` | `admin.conflict-resolved` | After resolve (manual or auto); Order Service fans out to Credit/Rating |
| `UserPromoted` | `admin.user.promoted` | After User Service accepts promote |
| `UserDemoted` | `admin.user.demoted` | After demote |
| `UserSuspended` | `admin.user.suspended` | After suspend |
| `UserReinstated` | `admin.user.reinstated` | After reinstate |

Keys: `orderId` for conflict events, `userId` for user events. Intake and
resolve **commit the DB first**; Kafka failures are logged, not returned as 500.

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

```bash
docker compose up --build
```

Starts Postgres, Zookeeper, Kafka, mock User Service, and the app on **8084**.
The container talks to `db:5432`, `kafka:9092`, and `http://mock-user-service:8000`.

Apply migrations against the mapped Postgres (from the host, with `.env` pointing at `localhost:5434`):

```bash
cp .env.example .env
pip install -r requirements.txt
alembic upgrade head
```

Set `SERVICE_API_KEY` in `.env` (and in compose `environment` if Order Service
will call intake against this stack). It is empty by default, which rejects intake.

## Running the API on the host

`.env.example` is for **host-side** tools (`alembic`, `pytest`, local `uvicorn`).
Hostnames `db` / `kafka` only work inside the Compose network.

```bash
cp .env.example .env
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8084
```

You still need Postgres (and Kafka if you want publishes to succeed). Easiest
path: `docker compose up db kafka zookeeper mock-user-service` then run uvicorn
on the host.

## Tests

```bash
pytest
```

`tests/test_conflicts.py` covers the 404-not-403 admin check (ASGI, no live stack).
`tests/conftest.py` also exposes a live-API client fixture against
`http://localhost:8084` with `Authorization: Bearer admin-sahana` (skips if the
stack is down).

## Still open

- Deadline reminder does not notify anyone. `send_deadline_reminder` only sets
  `reminder_sent_at`. Email or an in-app notice is still a TODO.
- Audit logs are not locked at the database. The app never updates or deletes
  `audit_logs`, but the `REVOKE UPDATE, DELETE` for the app role is only written
  on the model. There is no migration that applies it.
- User Service is still the mock. Compose points `USER_SERVICE_BASE_URL` at
  `mock-user-service`. That stub should be removed once the real User Service
  contract is wired.
- Kafka from the host may not connect. Compose advertises `kafka:9092`, which
  works inside the Docker network. A producer on the host using `localhost:9092`
  can fail until extra advertised listeners are added.
- A failed Kafka publish is only logged. The database commits first, and if
  Kafka is down the API still succeeds. There is no outbox to retry that event
  later.
- First admin. Promote requires an existing admin, so this service cannot create
  the first one. The mock treats any `admin-*` bearer token as an admin. There
  is no bootstrap or seed for a real first admin account.
- AI integration. `ai_client.py` calls the vision model after intake, but Compose
  sets `AI_PROVIDER_API_KEY` to a dummy key, so evaluation records `ai_failed`
  until a real provider is wired.
