# Badges Service

Awards and revokes profile badges for FoC users (Badges F1-F4, NFR1-NFR2; UI
FR12.2.2 shows them). It has its own PostgreSQL database and learns about
activity two ways: order and rating **events** for immediate updates, and a
**daily run** that reconciles counts with Order Service and is how a stale badge
is corrected by the next day at the latest (NFR2.1.1).

Stack mirrors rating-service: Fastify + TypeBox, Drizzle + postgres.js, Vitest
(90% coverage floor), `@confluentinc/kafka-javascript`.

## Decisions this implementation follows

- Events plus daily reconciliation (2026-10-30), replacing polling only.
- Rating metrics come from `user.rating.updated` only; Badges never calls Rating.
- An order counts once, the first time it reaches DELIVERED, ACKNOWLEDGED,
  UNACKNOWLEDGED or COMPLETED (2026-10-30). Same list as Order Service's
  completed deliveries.
- An order that goes to ESCALATED never counts, whatever the admin decides
  (2026-10-30). Fault-aware counting is future work with Order Service.
- `GET /api/v1/badges/{userId}`, readable by its owner only (2026-09-21, path from the contract).
- The manual run is an admin route through the gateway (2026-10-30).
- Users are keyed by user ID; badges can be revoked (2026-09-21).
- Daily run at 22:00 UTC (D1 Badges F2.1).

## How badges change

Event path (`src/messaging`), one consumer group `badges-service`:

- `order.status.changed` (foc.order.status): on a counted status, adds a
  `counted_order` row per role (requester → completed requests, courier →
  completed deliveries) and re-checks both users. The primary key makes later
  statuses and redeliveries no-ops. On ESCALATED, records the order in
  `disputed_order`, removes its rows and takes the counts back.
- `user.rating.updated` (foc.user.rating): stores the whole average and count.
  Ratings are never deleted, so a message with a lower or equal count is older
  and is ignored.
- A message that fails 4 times is logged and skipped (NFR3.1.1).

Daily run (`src/jobs/evaluationRun.ts`), also started by the admin route:

1. Pages through user IDs from User Service, at most 1,000 at a time (NFR1.1.1).
2. Asks Order Service for those users' counts and overwrites the stored ones,
   except for a user an order event changed after the run asked (that event is
   newer than Order's answer).
3. Re-checks every user's badges, awarding and revoking.
4. Records the run in `job_run`. A partial unique index allows one running run
   at a time; a run cut off by a restart is closed when the service starts.

Known gap: an order event consumed between Order answering and the run writing
that user's counts is counted twice until the next run. The window is the
consumer lag, so this is rare and self-correcting.

## Endpoints

Identity comes from the gateway's `x-user-id` / `x-is-admin` headers.

- `GET /health`, `GET /health/db`.
- `GET /api/v1/badges/{userId}`: every catalog badge with `earned`, `earnedAt`,
  the unlock `criteria` (F4.1) and `progress` `{current, target}` for unearned
  ones (F4.1.1), plus `metricsAsOf`. 404 unless `x-user-id` is `userId`.
- `POST /api/v1/badges/admin/evaluate`: admins only (404 otherwise, Admin
  F2.2.1). Starts a run in the background, answers `202 { runId, status }`;
  409 `RUN_IN_PROGRESS` if one is running.
- `GET /api/v1/badges/admin/jobs`: admins only. The last 20 runs.

## Badge catalog

`src/catalog/badges.json` is upserted into `badge_catalog` at startup, so a new
badge or threshold on an existing metric needs no code change. A badge on a new
metric needs it added to `MetricName` and to `user_metrics`. All conditions on
a badge must hold. Thresholds are placeholders for the demo.

## What this service needs from teammates

Neither endpoint exists yet; paths are in `src/clients/peers.ts`. The mesh
policies allowing Badges to call them are already in
`deploy/values/services/user.yaml` and `order.yaml`.

- User Service: `GET /api/v1/user/internal/user-ids?offset&limit` →
  `{ userIds: string[], total: number }`, every user, stable order.
- Order Service: `POST /api/v1/orders/internal/badge-counts` with `{ userIds }` →
  `[{ userId, completedDeliveries, completedOrders }]`. Count orders in
  DELIVERED, ACKNOWLEDGED, UNACKNOWLEDGED or COMPLETED with no `caseId`
  (never escalated); courier ID for deliveries, requester ID for requests.
  Users with no orders may be left out.

Until they exist the daily run fails and is recorded as failed; events keep
working.

## Running it

```bash
docker compose up -d postgres   # Postgres on localhost:5434
npm install
npm run db:migrate
npm run dev                     # http://localhost:8086
npm run test:coverage           # creates badges_test and migrates it
```

Set `KAFKA_BROKERS` to consume events; without it only the daily and manual
runs change badges. `BADGES_SCHEDULE_ENABLED=false` turns the schedule off.
Schema changes: edit `src/database/schema.ts`, then `npm run db:generate`.

## AI assistance

Generated with Claude Code (Claude Opus 5 on 2026-09-21 for the original
scaffold, Claude Opus 5.5 on 2026-10-30 for this port); each file names its
scope in a header. Reviewed by Ngooi Jun Sen.
