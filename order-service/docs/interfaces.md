<!--
AI Assistance Disclosure
Tool: Cursor (Auto), date: 2026-10-15
Scope: Documentation wording for Order Service under author-fixed design.
Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
-->

# Interfaces

Every order and alert route sits under `order.api.base-path`, which is `/api/v1/orders`. Swagger is at `/swagger-ui.html`. Health is at `/actuator/health`.

## Caller

The gateway is the identity source. There is no JWT check in this service.

| Header | Required | Rule |
| --- | --- | --- |
| X-User-Id | yes | UUID. Blank or non-UUID returns 401 `Sign in is required` |
| X-Permitted-Action | yes | Must be `true`, ignoring case and surrounding space. Otherwise 403 `This account is not permitted to use orders` |

Outbound calls to Credit and Supplier send `X-User-Id`. They do not forward `X-Permitted-Action`. The Telegram handle stored on an order comes from User Service.

Errors use `{ "error": "...", "code": "<HTTP status name>" }`.

## REST

| Method | Path | Who | Effect |
| --- | --- | --- | --- |
| POST | `/` | requester | Create. Body: `itemDescription` (1–500), `credits` (integer ≥ 1), `expiryTime`, `deliveryTime`, `fromLocation` (Supplier id), optional `deliveryPointId`, or inline `dropoffName` / `dropoffBuilding` / `dropoffDescription` / `dropoffLat` / `dropoffLng` |
| GET | `/delivery-points` | any permitted user | Active seed catalogue. `page`/`size` max **100** |
| GET | `/delivery-points/my-locations` | requester | This user's used dropoffs (`nickname`, usage). Sort `use_count` then `last_used_at`. `page`/`size` max **100** |
| PATCH | `/delivery-points/{id}` | associated user | Optional place fields (COW rules) and/or `nickname` (association only; `""` clears). Returns effective id |
| DELETE | `/delivery-points/{id}` | associated user | Unassociate; soft-inactive last fork |
| GET | `/{orderId}` | requester or assigned courier | One order. Anyone else gets 404 |
| POST | `/{orderId}/accept` | courier, not the requester | CREATED → ACCEPTED. The requester gets 409 |
| POST | `/{orderId}/cancel` | requester or assigned courier | Requester cancels CREATED. Courier releases ACCEPTED inside the collection window |
| POST | `/{orderId}/collect` | assigned courier | Multipart field `photo`. ACCEPTED → COLLECTED |
| POST | `/{orderId}/deliver` | assigned courier | Multipart field `photo`. COLLECTED → DELIVERED |
| POST | `/{orderId}/acknowledge` | requester | COLLECTED or DELIVERED → ACKNOWLEDGED |
| POST | `/{orderId}/escalate` | requester | JSON `{ "disputeText" }` or multipart `disputeText` plus optional `photo` |
| GET | `/` | any permitted user | Open pool. Optional `latitude`, `longitude`, `page`, `size` |
| GET | `/search` | any permitted user | Open orders by `pickupLocationId` and/or `dropoffLocationId` |
| GET | `/mine` | requester | That caller's orders, newest `requestTime` first |
| GET | `/deliveries/past` | courier | That courier's `DELIVERED`, `ACKNOWLEDGED`, `UNACKNOWLEDGED`, and `COMPLETED` orders, newest `requestTime` first |
| GET | `/deliveries/active` | courier | That courier's in-progress deliveries: `ACCEPTED`, `COLLECTED`, `ESCALATED`, `UNDER_REVIEW`, newest `requestTime` first |
| GET | `/requests/active` | requester | That requester's open requests: `CREATED`, `ACCEPTED`, `COLLECTED`, `DELIVERED`, `ESCALATED`, `UNDER_REVIEW`, newest `requestTime` first |
| GET | `/requests/past` | requester | That requester's past requests: `ACKNOWLEDGED`, `UNACKNOWLEDGED`, `COMPLETED`, `EXPIRED`, `CANCELLED`, newest `requestTime` first |
| GET | `/alerts` | any | Alerts visible to the caller: `notifyRequester` as requester, or `notifyCourier` as courier (dispute lifecycle). Each row includes `asCourier` |

`page` and `size` default to 0 and 20. `page < 0`, `size < 0`, or `size > 1000` returns 400 `Page size must be between 0 and 1000`. `size = 0` returns an empty page and does not query.

List responses are `{ "content", "page", "size", "totalElements" }`. An order body matches `OrderResponse`: identities, ratings, description, amount, status, the five timestamps the API exposes (`requestTime`, `acceptanceExpiry`, `deliveryDeadline`, `collectionDeadline`, `acknowledgementDeadline`), both places, photo refs, `disputeText`, and `faultParty` (`requester` \| `courier` \| `no-fault` after admin resolve; otherwise null). `settledAt` and `caseId` stay in the database.

### Reads

- Pool with coordinates: CREATED orders whose pickup is inside a bounding box of `order.ranking.radius-km` (default 5), excluding the caller, sorted by pickup distance and then reward.
- Pool without coordinates: same open set, sorted by reward and then newest request.
- Search: at least one location id is required. `pickupLocationId` must be an approved supplier. `dropoffLocationId` matches the snapshotted order dropoff id (Order delivery point), with no Supplier check. Results are CREATED orders, excluding the caller, sorted by reward.
- Single-order GET and `/mine` are not ranked by proximity.

### Photos

Collect and deliver require a non-empty JPEG, PNG, or WebP. The dev profile stores objects in the `order-photos` bucket. The local profile stores files under `./data/photos`. The service deletes collection, delivery, and dispute photos when an order completes after the 7-day window or when an admin case is resolved.

### Synchronous calls

These HTTP calls finish before the order row changes. A failure leaves the previous status in place.

| When | Call |
| --- | --- |
| Create | `GET /api/v1/user/internal/users/{userId}/telegram`, then `GET /api/v1/supplier/{id}` for **pickup only**. Dropoff is resolved from Order `delivery_point` (seed∪mine id or inline in NUS bounds). Then `GET /api/v1/rating/{userId}` for the requester snapshot (`average` may be null). Then `POST /api/v1/credit/internal/reserve` with `{ orderId, requesterId, amount }`. On success: insert order + usage upsert in one DB transaction |
| Accept | `GET /api/v1/rating/{userId}` for the courier snapshot, then `GET /api/v1/user/internal/users/{userId}/telegram` before the order is claimed |
| Create, if the insert fails | `POST /api/v1/credit/internal/release` with `{ orderId }` |
| Requester cancels CREATED | `POST /api/v1/credit/internal/release` before the status becomes CANCELLED |
| Requester escalates, and a collected order that misses its delivery deadline | `POST /api/v1/admin/internal/conflicts` with `{ orderId, reporterUserId, comment, photos }` before the status becomes ESCALATED. A repeat for the same order is accepted |

Courier release does not call Credit. The reservation stays with the order.

Credit failures: insufficient balance and a non-positive amount are 400, an unknown reservation is 400, a duplicate reservation is 409, an unknown credit user is 404, and any other credit or supplier failure or timeout is 503.

## Kafka

Every published payload has `eventId`, `eventType`, `schemaVersion` (1), `occurredAt`, and `orderId`. The message key is the order id.

| Topic | eventType | When |
| --- | --- | --- |
| foc.order.status | order.status.changed | Every successful transition. Fields: `requesterId`, `courierId`, `fromStatus`, `toStatus`, `notifyRequester`, `notifyCourier`, `faultParty` (set only on case resolve → `COMPLETED`; otherwise null). Values: `requester` \| `courier` \| `no-fault`. `notifyCourier` is true for Escalated / Under review / case-resolved Completed when a courier is set |
| foc.credit.commands | credit.reservation.return | Acceptance expiry (`EXPIRED`) or case resolve when `faultParty` is `courier` (`CASE_RESOLVED`) |
| foc.credit.commands | credit.reservation.release | Acknowledge / unacknowledge (`ACKNOWLEDGED` / `UNACKNOWLEDGED`), or case resolve when `faultParty` is `requester` or `no-fault` (`CASE_RESOLVED`). Includes `courierId` and `amount` |
| foc.rating.commands | rating.permission.granted | Deliver: courier rates requester. Acknowledge / unacknowledge: requester rates courier. Case resolve: requester rates courier; when courier is paid (`requester` / `no-fault`) also courier rates requester. Fields: `raterId`, `raterRole`, `rateeId`, `rateeRole` |
| foc.admin.events | OrderUnderReview / `admin.review.started` | Consumed. ESCALATED → UNDER_REVIEW when `caseId` is present |
| foc.admin.events | ConflictResolved / `admin.case.resolved` | Consumed. Requires `faultParty` (`requester` \| `courier` \| `no-fault`); missing/unknown → retry, no status change. Then ESCALATED or UNDER_REVIEW → COMPLETED (status event includes `faultParty`), photos deleted, credit + rating fan-out. `no-fault` pays the courier like acknowledge |
| foc.user.status | UserDeleted | Consumed. Deletes that user’s `user_delivery_point` rows; soft-inactivates orphan forks. Envelope uses `type` + `data.userId` (not `eventType`) |

`order.status.changed` has no consumer in this service. A duplicate `eventId`, a missing field, or a non-UUID order id is ignored and is not stored. A readable event for an unknown order is stored in `processed_events` and does not change a status. A known order stores the event, copies `caseId`, and changes status only when the current status allows that event. `UserDeleted` is also deduped by `eventId` in `processed_events`. A failure while applying a readable event is retried.

The outbox row is committed with the order change. The deadline sweeper publishes at most 50 unpublished rows per pass, waits up to 5 seconds for each send, and sets `published_at` only after the broker accepts it. A Kafka failure is logged and retried on the next sweep.

## Deadlines

Configured under `order.deadlines`.

| Window | Default | Result |
| --- | --- | --- |
| Sweep interval | 5s | Also publishes the outbox |
| Collection window | 5m after accept | ACCEPTED → CREATED, courier cleared |
| Acceptance expiry | supplied on create | CREATED → EXPIRED, credits returned on Kafka |
| Delivery deadline | supplied on create | COLLECTED → ESCALATED |
| Acknowledgement window | 1 day after the delivery deadline, stored at collect | DELIVERED → UNACKNOWLEDGED. A collected order past this instant stays COLLECTED until the delivery deadline escalates it |
| Completion window | 7 days after `settled_at` | ACKNOWLEDGED or UNACKNOWLEDGED → COMPLETED |

Terminal statuses are `CANCELLED`, `EXPIRED`, and `COMPLETED`.
