# Rating Service

Stores the ratings couriers and requesters give each other after an order, and
keeps one average per user. Order Service decides who may rate whom; this
service only accepts a rating it has been told to expect.

## How a rating happens

1. Order Service publishes `rating.permission.granted` on `foc.rating.commands`
   when an order is delivered (the courier may rate the requester) and when it
   is acknowledged or unacknowledged (the requester may rate the courier).
2. This service stores that as a grant (`rating_grant`). A redelivered message
   is a no-op.
3. The rating modal in the frontend calls `GET /api/v1/rating/me/pending`, then
   `POST /api/v1/rating/orders/{orderId}` with a score of 1 to 5.
4. In one transaction the service stores the rating, adds it to the user's
   running total, and writes `user.rating.updated` to an outbox. A relay
   publishes outbox rows to `foc.user.rating` after the transaction commits.

## Endpoints

All under `/api/v1/rating`. The caller's identity is the `x-user-id` header the
gateway sets after User Service's authorize call.

- `GET /{userId}`: returns `{ userId, average, count }`. `average` is the
  unified average over every rating the user has received, in either role,
  rounded to 2 decimal places. It is `null` when `count` is 0.
- `GET /me/pending`: returns `{ pending: [{ orderId, rateeId, rateeRole, grantedAt }] }`,
  the caller's grants that have not been used yet.
- `POST /orders/{orderId}`: body `{ score, comment? }`. `score` is an integer
  from 1 to 5; `comment` is optional, at most 500 characters. Returns 201 with
  the stored rating.
  - 403 `RATING_NOT_PERMITTED`: the caller has no grant for this order.
  - 409 `RATING_ALREADY_SUBMITTED`: the caller already rated this order.
  - 400 `VALIDATION_ERROR`: bad score, comment, ids, or missing header.
- `GET /health`, `GET /health/db`.

Errors use the team's shape: `{ error, code }`, where `error` is a readable
message. Unknown routes return 404 `NOT_FOUND`; unexpected failures return 500
`INTERNAL_ERROR` with details only in the log.

## Messages

Flat catalog format: `{ eventId, eventType, schemaVersion, occurredAt, ...fields }`.

- Consumes `rating.permission.granted` from `foc.rating.commands`:
  `orderId, raterId, raterRole, rateeId, rateeRole`. Roles are `COURIER` or
  `REQUESTER`. Other event types are ignored; messages that don't match the
  contract are logged and skipped. A message that fails 4 times in a row (for
  example, the database is down) is logged and skipped (NFR3.1.1).
- Publishes `user.rating.updated` to `foc.user.rating`, keyed by user id:
  `userId, newAverage, totalRatings`. Delivery is at least once; deduplicate on
  `eventId`.

## Data

- `rating_grant`: one row per (order, rater), from Order's message.
- `rating`: every submitted rating, unique per (order, rater).
- `user_rating`: running `rating_sum` and `rating_count` per user, updated with
  one atomic upsert so concurrent ratings never lose an update.
- `outbox`: messages waiting to be published.

## Stack and layout

Fastify, TypeBox, Drizzle ORM on PostgreSQL, `@confluentinc/kafka-javascript`
(KafkaJS-style API), Vitest. Same layout as credit-service:

```
src/
  server.ts               boot, Kafka start, graceful shutdown
  app.ts                  Fastify instance + routes
  config.ts               environment settings
  database/               Drizzle schema and client
  routes/                 HTTP endpoints
  schemas/                TypeBox request/response schemas
  services/               rating logic (transactions)
  messaging/              grant handler, outbox relay, retries, Kafka wiring
drizzle/                  generated SQL migrations
```

## Running locally

```bash
docker compose up --build        # Postgres (host port 5433) + app on :8085
```

Or run Postgres in Docker and the app on the host:

```bash
docker compose up -d postgres
npm install
npm run db:migrate
npm run dev
```

Without `KAFKA_BROKERS` the app serves HTTP only: no grants arrive and outbox
rows wait. To try the flow without Kafka, insert a `rating_grant` row by hand.

## Tests

```bash
docker compose up -d postgres    # tests create and migrate rating_test on it
npm test
npm run test:coverage            # 90% floor on lines, branches, functions, statements
```

## Configuration

- `PORT` / `RATING_SERVICE_PORT`: default 8085.
- `DATABASE_URL`: default `postgres://rating:rating@localhost:5433/rating_db`.
- `DB_SSL`, `DB_POOL_MAX`, `LOG_LEVEL`: as in credit-service.
- `KAFKA_BROKERS`: comma-separated. Empty disables Kafka.
- `KAFKA_USERNAME`, `KAFKA_PASSWORD`, `KAFKA_CA_CERT`: injected by the deploy
  chart (TLS + SCRAM-SHA-512, ADR-0004). With no username the client connects in
  plaintext, for a local broker.
- `KAFKA_GROUP_ID`: default `rating-service`.
- `KAFKA_MAX_ATTEMPTS`: default 4. `OUTBOX_POLL_MS`: default 1000.

## Schema changes

Edit `src/database/schema.ts`, then `npm run db:generate` and commit the new
file under `drizzle/`.
