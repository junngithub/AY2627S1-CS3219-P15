# Database schema

Drizzle owns the schema. `src/database/schema.ts` is the source; `npm run db:generate` writes migrations to `drizzle/`, and the migrate Job runs them before each deploy (ADR-0011). Migrations `0000` through `0003` produce the tables below. `user_badge.badge_id` is the only foreign key; order and user ids are plain UUIDs from other services.

`0001` added the parties and verdict to `disputed_order`. `0002` dropped the `job_run` table and `user_metrics.reconciled_at` when the scheduled poll was removed. `0003` added `deleted_user`.

## badge_catalog

One row per badge, upserted from `src/catalog/badges.json` at startup.

| Column | Type | Notes |
| --- | --- | --- |
| badge_id | TEXT | Primary key |
| title | TEXT | |
| description | TEXT | |
| target_role | badge_target_role | `courier`, `requester`, or `any` |
| display_order | INTEGER | Order on the profile |
| icon_earned_url | TEXT | |
| icon_unearned_url | TEXT | |
| conditions | JSONB | Array of `{ metric, op, value }`. All must hold |
| progress_metric | TEXT | Metric shown as progress. Null means the first condition's metric |
| updated_at | TIMESTAMPTZ | Changes only when the row's content changes |

## user_metrics

What badges are judged on. One row per user Badges has seen an event for.

| Column | Type | Notes |
| --- | --- | --- |
| user_id | UUID | Primary key |
| completed_deliveries | INTEGER | Courier `counted_order` rows. Check `>= 0`; decrements stop at 0 |
| completed_orders | INTEGER | Requester `counted_order` rows. Check `>= 0`; decrements stop at 0 |
| average_rating | DOUBLE PRECISION | From `user.rating.updated`. Null until rated |
| rating_count | INTEGER | From `user.rating.updated`. Check `>= 0`. Also the staleness check |
| last_order_event_at | TIMESTAMPTZ | Last time an order or admin event changed the counts |
| updated_at | TIMESTAMPTZ | Last change of any metric. Returned as `metricsAsOf` |

## counted_order

One row per order and role that counts towards a user's totals. The counts in `user_metrics` move by one exactly when a row here is inserted or deleted, in the same transaction.

| Column | Type | Notes |
| --- | --- | --- |
| order_id | UUID | |
| role | order_role | `COURIER` or `REQUESTER` |
| user_id | UUID | The courier or requester on the order |
| counted_at | TIMESTAMPTZ | |

Primary key `(order_id, role)`: a redelivered event or a later counted status inserts nothing. Index `counted_order_user_idx` on `user_id`.

## disputed_order

Orders that went to `ESCALATED`. Either half of a row can arrive first: the parties from `order.status.changed`, the verdict from `admin.case.resolved`.

| Column | Type | Notes |
| --- | --- | --- |
| order_id | UUID | Primary key |
| requester_id | UUID | From the escalation. Null if the verdict arrived first |
| courier_id | UUID | From the escalation |
| fault_party | fault_party | `requester`, `courier`, or `no-fault`. Null until resolved, then never changed |
| disputed_at | TIMESTAMPTZ | Row creation |
| resolved_at | TIMESTAMPTZ | When the verdict was stored |

## user_badge

One row per user and badge ever earned. Rows are not deleted on revocation, so re-checking is idempotent and history survives.

| Column | Type | Notes |
| --- | --- | --- |
| user_id | UUID | |
| badge_id | TEXT | References `badge_catalog.badge_id`, on delete cascade |
| state | badge_state | `earned` or `revoked` |
| first_earned_at | TIMESTAMPTZ | Set on the first earn, never changed |
| earned_at | TIMESTAMPTZ | Latest earn |
| revoked_at | TIMESTAMPTZ | Latest revocation. Cleared when earned again |
| updated_at | TIMESTAMPTZ | |

Primary key `(user_id, badge_id)`.

## deleted_user

Users whose account was deleted (`UserDeleted` on foc.user.status). Their rows in `user_metrics`, `user_badge` and `counted_order` are removed; this row stays so a late or replayed event for them is ignored, the way Credit keeps `deleted_at`.

| Column | Type | Notes |
| --- | --- | --- |
| user_id | UUID | Primary key. A repeated `UserDeleted` is a no-op |
| deleted_at | TIMESTAMPTZ | When Badges applied the deletion |

## Enums

| Type | Values |
| --- | --- |
| badge_target_role | `courier`, `requester`, `any` |
| order_role | `COURIER`, `REQUESTER` |
| badge_state | `earned`, `revoked` |
| fault_party | `requester`, `courier`, `no-fault` |
