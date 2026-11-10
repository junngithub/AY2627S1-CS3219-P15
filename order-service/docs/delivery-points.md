<!--
AI Assistance Disclosure
Tool: Cursor (Auto), date: 2026-10-15
Scope: Documentation wording for Order Service under author-fixed design.
Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
-->

# Delivery points (design)

Status: **implemented** (see Flyway `V6`/`V7`, `DeliveryPointService`, create/list/PATCH/DELETE + nickname + `UserDeleted` association cleanup). Scope is Order Service unless noted.

Pickup (`from`) stays with Supplier Service (approved catalogue). Dropoff (`to`) is owned by Order’s database: a seeded campus catalogue, plus per-user associations built only when a dropoff is used on a successful order.

Source list: campus CSV (`delivery-points.csv`) — 39 rows (`Id`, `Name`, `Building`, `Location Description`, `Latitude`, `Longitude`).

## Why Order owns dropoff

- Destinations are a FoC campus catalogue / user history, not supplier shops.
- Supplier approval does not apply to “COM1 lobby” style points.
- Create already snapshots place fields on the order; couriers see dropoff from that snapshot.
- Shared rows must not break other users, so edit/delete use association refcounts and copy-on-write.

Pickup validation stays `GET /api/v1/supplier/{id}` (approved only).

## CSV → columns

| CSV | Decision |
| --- | --- |
| Id (`com1`, …) | Stable **`code`** on seed rows only (not the PK) |
| Name / Building / Location Description | Keep as `name`, `building`, `description` |
| Latitude / Longitude | Keep |
| (missing) | `active` for retiring seed rows without deleting history |

## NUS geofence

Custom dropoffs must fall inside this axis-aligned box (from the campus geofence doc / `frontend` campus bounds; west edge **not** widened to include the mis-seeded Cheers outlier). North max bumped so seed `rc4` (`1.308243`) fits:

| | Min | Max |
| --- | --- | --- |
| Latitude | **1.288** | **1.309** |
| Longitude | **103.766** | **103.788** |

Roughly Kent Ridge MRT / NUH (south-east) through UTown / RC4 (north). Configured in Order (e.g. `order.delivery-points.bounds` in `application.yml`). Outside → 400 on create **and** on PATCH lat/lng. Seed ids are not re-checked against the box at create (catalogue is trusted).

## Identifier choice

**Numeric PK + unique `code` on seed rows.** Orders and APIs use numeric `id`. `code` is for CSV re-seed upsert and to mark catalogue rows (`code IS NOT NULL`) vs user forks / discovered points (`code` null). Seed rows are never hard-deleted by the user API.

## Two tables (place catalogue vs usage — not “copy seed on use”)

Yes, two tables — but they split **place rows** vs **who used them**, not predefined vs a second place table filled on every use:

| Table | Role |
| --- | --- |
| `delivery_point` | All places: CSV seed (`code` set) **and** user customs / COW forks (`code` null) |
| `user_delivery_point` | Usage only (`use_count`, `last_used_at`) — written **only on successful order** |

Using COM1 must keep the **same seed id** on the order so search-by-catalogue still works. Copying the seed into a personal place row on every use would mint a new id per user and break that. Customs / edits already get their own `delivery_point` rows (`code` null) when needed.

**Seed immutability:** user API never `UPDATE`s `code IS NOT NULL`. Editing a seed-associated point **always** forks, even if this user is the only associate.

### `delivery_point`

```text
delivery_point
  id          BIGSERIAL PRIMARY KEY
  code        TEXT                          -- CSV Id; NULL for forks / discovered
  name        TEXT NOT NULL
  building    TEXT NOT NULL
  description TEXT NOT NULL
  latitude    DOUBLE PRECISION NOT NULL
  longitude   DOUBLE PRECISION NOT NULL
  active      BOOLEAN NOT NULL DEFAULT true
```

Partial unique: `UNIQUE (code) WHERE code IS NOT NULL`. Seed with `ON CONFLICT (code) DO UPDATE` without renumbering ids. Ops may set seed `active = false`; users never hard-delete.

### `user_delivery_point`

```text
user_delivery_point
  user_id            VARCHAR(320) NOT NULL
  delivery_point_id  BIGINT NOT NULL
  use_count          INTEGER NOT NULL DEFAULT 1
  nickname           VARCHAR(80)                -- optional per-user label; not used as create key
  last_used_at       TIMESTAMPTZ NOT NULL
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  PRIMARY KEY (user_id, delivery_point_id)
```

**Associations only on successful order use** — no bookmark/save API. Insert with `use_count = 1`, `last_used_at = now()`, or bump both on repeat use. Optional `nickname` is owner-only display (my-locations / PATCH); create and search still use numeric `deliveryPointId`. Courier order snapshot keeps place name/building/description, not the nickname.

## Indexes (≈ 60k users)

```text
delivery_point
  PRIMARY KEY (id)
  UNIQUE (code) WHERE code IS NOT NULL

user_delivery_point
  PRIMARY KEY (user_id, delivery_point_id)           -- create upsert
  INDEX (delivery_point_id)                         -- edit/delete refcount
  INDEX (user_id, use_count DESC, last_used_at DESC) -- my-locations
```

Catalogue is ~39 rows; no heavy geo index for v1 (no snap-to-nearest).

## Create order — dropoff contract

**Request shape (chosen):** keep `fromLocation` (Supplier id). Drop required `toLocation`. Add optional `deliveryPointId` plus dropoff fields for the courier snapshot:

- `dropoffName`, `dropoffBuilding`, `dropoffDescription`, `dropoffLat`, `dropoffLng` — required when `deliveryPointId` is omitted; ignored for labels/coords when id is present (server snapshots from DB).

**Allowed ids:** seeded catalogue (`code IS NOT NULL`, `active`) **or** a point this requester already has in `user_delivery_point`. Another user’s fork id → 400.

**A. Known allowed id** — load row; snapshot **name, building, description, lat, lng** (+ id) onto the order from DB. On **success**: bump association usage.

**B. Inline only (no id)** — all dropoff fields required; must lie inside the NUS box. **No** snap. On **success**: insert new `delivery_point` (`code` null) + association (`use_count = 1`). Failed creates write nothing.

Pickup: Supplier only (`fromLocation`).

### What the courier sees (snapshot — chosen)

**Today:** order stores only `dropoff_name` + lat/lng (and location id). Name alone is thin — CSV also has **Building** and **Location Description** (e.g. name `Kent Ridge MRT, Exit A`, building `Kent Ridge MRT`, description `At Exit A, beside NUH`).

**Chosen:** snapshot full place onto the order: `dropoff_name`, `dropoff_building`, `dropoff_description`, `dropoff_lat`, `dropoff_lng`, plus plain `dropoff_location_id` for search / my-locations. Courier UI reads the **order row only** — no live join to `delivery_point`.

**Rejected:** live FK display, and the follow-on rule “never `UPDATE` any place row / always insert even for sole user.” With a snapshot, order history is already frozen, so append-only places are unnecessary. Sole-user forks may `UPDATE` in place; multi-user and seed edits still COW so other users’ catalogue / shared rows stay intact.

## Edit / delete

Caller must be associated. PATCH lat/lng must pass the NUS box. Response returns the **effective id** (unchanged on in-place update; new id after COW).

**Atomicity (required):** every mutating path runs in **one DB transaction**. No partial visibility of fork-without-moved-association, association-removed-without-inactive, or order-without-usage-bump.

**Edit** — single transaction:

1. Lock row; load association.
2. If `nickname` is present in the body → update association only (`""` clears). Nickname-only PATCH does **not** COW.
3. If any place field is present (`name` / `building` / `description` / lat / lng):
   - Seed (`code` set) → **always** fork (never mutate campus rows), even if count = 1.
   - Else if count = 1 and association is caller → **`UPDATE` fork in place**.
   - Else → insert fork (`code` null), **move association** and **copy `use_count` / `last_used_at` / `nickname`**.
4. Commit (or roll back the whole edit). Response returns the effective id + nickname.

**Delete (soft — active / inactive)** — single transaction:

No hard-delete of `delivery_point` rows from the user API.

1. Lock row; remove this user’s `user_delivery_point` association (drops them from `my-locations`).
2. If **no associations remain** and the row is a **user fork** (`code IS NULL`) → set `active = false` (inactive). Do not `DELETE` the row.
3. Seed rows (`code` set): only remove the association; leave `active` as ops/seed control (user delete never flips a campus point off for everyone).
4. Commit.

Inactive forks stay in the DB so old `dropoff_location_id` values still resolve if we ever join; create and lists reject `active = false`. User can place a new order with the same inline fields later (new row + new usage).

### Account deletion (`UserDeleted`)

User publishes final physical removal on `foc.user.status` (not schedule/cancel):

```json
{ "eventId": "<uuid>", "type": "UserDeleted", "occurredAt": "<ISO-8601>", "data": { "userId": "<uuid>" } }
```

Order consumes it (dedupe `eventId` in `processed_events`) and applies the same soft-delete rules in bulk:

1. Delete all `user_delivery_point` rows for `data.userId` (nicknames / usage go with them).
2. For each distinct place id that was linked: if it is a **fork** with **zero associations left** → `active = false`.
3. Never flip seed catalogue `active`. Never hard-delete `delivery_point`. Never rewrite order dropoff snapshots.

At-least-once: duplicate `eventId` is a no-op. Malformed / non-`UserDeleted` messages are ignored.

Open orders are **not** cancelled here: User only physically deletes after ~6 months of inactivity after a deletion request, while order lifetimes are days/weeks, so reserved credits and in-flight statuses should already be gone. Association cleanup is the remaining personal data on Order.

### What delete loses vs what orders keep

- **Kept on past orders:** snapshotted dropoff fields on the order row (extend snapshot to **name, building, description, lat, lng** so courier-visible detail survives even if the point is inactive).
- **Removed from my-locations:** association + that user’s `use_count` / `last_used_at` / `nickname` for that link (also on `UserDeleted`).
- **Not destroyed:** fork row becomes inactive; seed catalogue unchanged.

## Search / pool by dropoff

**Recommendation (chosen):** keep search as **exact match on snapshotted `dropoff_location_id`**. Do not rewrite search to follow forks or merge ids.

Why: after COW, “COM1” and “my edited COM1” are different ids on purpose. Pool already ranks by snapshotted lat/lng. Trying to search “same place across forks” needs snap/geo merge, which we rejected. Clients that mean “orders to this catalogue spot” pass the seed id; clients that mean “orders I created with my fork” pass that fork id. Document that clearly on the search param.

Optional later (not v1): search by lat/lng radius using order snapshot coords — separate from delivery-point id.

## Concurrency + atomic writes

COW is for **shared / seed integrity**, not for order history (snapshot handles that). Locking alone is not enough — multi-step mutations must be **atomic**:

| Operation | Atomic unit |
| --- | --- |
| `PATCH` edit | lock + count + (in-place `UPDATE` **or** insert fork + move association + copy usage) |
| `DELETE` | lock + delete association + optional `active = false` |
| `UserDeleted` | delete all associations for user + soft-inactive orphan forks |
| `POST` create order (success path) | order insert + dropoff resolve/insert + usage upsert (`INSERT … ON CONFLICT DO UPDATE`) |
| Inline new place on create | new `delivery_point` + `user_delivery_point` + order row together |

1. Begin transaction.
2. **Lock the `delivery_point` row** (`SELECT … FOR UPDATE`) when editing/deleting an existing id.
3. Count associations.
4. If seed (`code` set) **or** count > 1 → `INSERT` fork, move caller’s association (copy usage).
5. Else (fork, sole user) → `UPDATE` in place.
6. Commit once; on any failure roll back all steps in that request.

Without the lock, two users can both see count = 1 and both update in place (bad). Without one transaction, a crash between insert-fork and move-association leaves a half-applied edit.

## Pagination

Align with Supplier’s list caps: **`page` (1-based like Supplier, or document clearly)** and **`pageSize` default 20, max 100** for `my-locations` and catalogue list. Prefer matching Supplier query names (`page`, `pageSize`) on these new endpoints even though existing Order list APIs use 0-based `page` + `size` max 1000 — call that out in `interfaces.md` when implementing so clients don’t mix conventions, **or** use Order’s existing `page`/`size` with max **100** for these two endpoints only. **Chosen for plan:** use Order’s existing style (`page` 0-based, `size` default 20) but **cap `size` at 100** for delivery-point lists (Supplier’s max), not 1000.

## API sketch

| Method | Path | Role |
| --- | --- | --- |
| `GET` | `/api/v1/orders/delivery-points` | Active seed catalogue (`code IS NOT NULL`), paginated |
| `GET` | `/api/v1/orders/delivery-points/my-locations` | This user’s used places, `use_count DESC`, `last_used_at DESC`, paginated |
| `PATCH` | `/api/v1/orders/delivery-points/{id}` | Place edit + COW; optional `nickname` on association (no COW) |
| `DELETE` | `/api/v1/orders/delivery-points/{id}` | Unassociate; if last user on a fork, set `active = false` |
| `POST` | `/api/v1/orders` | Pickup → Supplier; dropoff → allowed id and/or full inline fields; geofence; associate only on success |

Auth: `X-User-Id` + `X-Permitted-Action`.

## Out of scope

- Supplier / frontend code changes (frontend already has the geofence numbers to mirror).
- Snap-to-nearest / merging duplicate coordinates.
- Using another user’s delivery point id.
- Dropoffs outside the NUS box.
- Hard-delete of `delivery_point` rows via user API (soft inactive only).
- Live FK / join for courier dropoff display (snapshot only).
- Append-only place rows / “always insert on edit even for sole user”.
- Promoting discovered points into seed (`code`) without ops re-seed.
- Courier-side associations (requester usage only).

## Implementation checklist

1. Flyway: tables + indexes; seed 39 CSV rows; config NUS bbox `1.288–1.309` × `103.766–103.788`.
2. Extend order dropoff snapshot with building + description (migration + `OrderResponse`); search dropoff no longer hits Supplier.
3. List catalogue + `my-locations` (sort + page/size cap 100).
4. Create: `fromLocation` Supplier; optional `deliveryPointId` + inline dropoff fields; seed∪mine or full inline in-bounds; no snap; associate/bump only on success.
5. PATCH/DELETE/create-usage in one DB transaction each (lock + COW/move or in-place; soft inactive); seed always COW; PATCH returns effective id.
6. Optional `user_delivery_point.nickname` (V7): PATCH association-only without COW; copy on place fork; expose on my-locations; not on courier snapshot / create key.
7. Bruno + unit tests (geofence, forbidden foreign id, COW usage/nickname copy, nickname-only PATCH, delete vs order snapshot).
8. Update `schema.md`, `interfaces.md`, create sequence; then update load-test dropoff ids away from Supplier `toLocation: "4"`.
9. Consume `foc.user.status` `UserDeleted`: purge that user’s associations; soft-inactive orphan forks; leave seed + order snapshots.
