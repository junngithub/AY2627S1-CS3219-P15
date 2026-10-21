# Interfaces

Every order and alert route sits under `order.api.base-path`, which is `/api/v1/orders`. Swagger is at `/swagger-ui.html`. Health is at `/actuator/health`.

## Caller

The gateway is the identity source. There is no JWT check in this service.

| Header | Required | Rule |
| --- | --- | --- |
| X-User-Id | yes | UUID. Blank or non-UUID returns 401 `Sign in is required` |
| X-Permitted-Action | yes | Must be `true`, ignoring case and surrounding space. Otherwise 403 `This account is not permitted to use orders` |
| X-User-Telegram | no | Stored on the order when this caller creates or accepts it |

Outbound calls to Credit and Supplier send `X-User-Id` and, when present, `X-User-Telegram`. They do not forward `X-Permitted-Action`.

Errors use `{ "error": "...", "code": "<HTTP status name>" }`.

## REST

| Method | Path | Who | Effect |
| --- | --- | --- | --- |
| POST | `/` | requester | Create. Body: `itemDescription` (1–500), `credits` (integer ≥ 1), `expiryTime`, `deliveryTime`, `fromLocation`, `toLocation` |
| GET | `/{orderId}` | requester or assigned courier | One order. Anyone else gets 404 |
| POST | `/{orderId}/accept` | courier | CREATED → ACCEPTED |
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
| GET | `/alerts` | requester | Alerts with `notifyRequester` true |

`page` and `size` default to 0 and 20. `page < 0`, `size < 0`, or `size > 1000` returns 400 `Page size must be between 0 and 1000`. `size = 0` returns an empty page and does not query.

List responses are `{ "content", "page", "size", "totalElements" }`. An order body matches `OrderResponse`: identities, ratings, description, amount, status, the five timestamps the API exposes (`requestTime`, `acceptanceExpiry`, `deliveryDeadline`, `collectionDeadline`, `acknowledgementDeadline`), both places, photo refs, and `disputeText`. `settledAt` and `caseId` stay in the database.

### Reads

- Pool with coordinates: CREATED orders whose pickup is inside a bounding box of `order.ranking.radius-km` (default 5), excluding the caller, sorted by pickup distance and then reward.
- Pool without coordinates: same open set, sorted by reward and then newest request.
- Search: at least one location id is required. Each given id must be an approved supplier. Results are CREATED orders, excluding the caller, sorted by reward.
- Single-order GET and `/mine` are not ranked by proximity.

### Photos

Collect and deliver require a non-empty JPEG, PNG, or WebP. The dev profile stores objects in the `order-photos` bucket. The local profile stores files under `./data/photos`. The service deletes collection, delivery, and dispute photos when an order completes after the 7-day window or when an admin case is resolved.

### Synchronous calls

These HTTP calls finish before the order row changes. A failure leaves the previous status in place.

| When | Call |
| --- | --- |
| Create | `GET /api/v1/supplier/{id}` for pickup and dropoff. Only an approved supplier with an id and a name is accepted. Then `POST /api/v1/credit/reserve` with `{ orderId, requesterId, amount }` |
| Create, if the insert fails | `POST /api/v1/credit/release` with `{ orderId }` |
| Requester cancels CREATED | `POST /api/v1/credit/release` before the status becomes CANCELLED |
| Requester escalates | `POST /escalations` on the admin client. Rating and admin clients are local stubs. Rating always returns 5.0. Admin accepts a non-blank comment |

Courier release does not call Credit. The reservation stays with the order.

Credit failures: insufficient balance and a non-positive amount are 400, an unknown reservation is 400, a duplicate reservation is 409, an unknown credit user is 404, and any other credit or supplier failure or timeout is 503.

## Kafka

Every published payload has `eventId`, `eventType`, `schemaVersion` (1), `occurredAt`, and `orderId`. The message key is the order id.

| Topic | eventType | When |
| --- | --- | --- |
| foc.order.status | order.status.changed | Every successful transition. Fields: `requesterId`, `courierId`, `fromStatus`, `toStatus`, `notifyRequester` |
| foc.credit.commands | credit.reservation.return | Acceptance expiry. `reason` is `EXPIRED` |
| foc.credit.commands | credit.reservation.release | Acknowledge or unacknowledge. `reason` is `ACKNOWLEDGED` or `UNACKNOWLEDGED`, and the payload includes `courierId` and `amount` |
| foc.rating.commands | rating.permission.granted | Deliver: courier rates requester. Acknowledge or unacknowledge: requester rates courier. Fields: `raterId`, `raterRole`, `rateeId`, `rateeRole` |
| foc.admin.commands | admin.escalation.opened | Sweeper only, when a COLLECTED order misses the delivery deadline. `reason` is `DELIVERY_DEADLINE_MISSED` |
| foc.admin.events | admin.review.started | Consumed. ESCALATED → UNDER_REVIEW when `caseId` is present |
| foc.admin.events | admin.case.resolved | Consumed. ESCALATED or UNDER_REVIEW → COMPLETED, and photos are deleted |

`order.status.changed` has no consumer in this service. A duplicate `eventId`, a missing field, or a non-UUID order id is ignored and is not stored. A readable event for an unknown order is stored in `processed_events` and does not change a status. A known order stores the event, copies `caseId`, and changes status only when the current status allows that event. A failure while applying a readable event is retried.

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
