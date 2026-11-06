# Load test

9600 virtual users go through the **API gateway**: each VU logs in once
(`POST /api/v1/user/login`), then calls Order with `Authorization: Bearer <session>`.
The gateway runs User’s authorize check and injects identity headers. Order still
makes the downstream service calls.

| Share | VUs | What they do |
| --- | --- | --- |
| 30% requesters | 2880 | Keep up to 3 open orders. Create at 1 credit, then acknowledge a delivered order. Every 20th close escalates instead. |
| 70% couriers | 6720 | Read the open pool, accept one order, upload a 1×1 PNG for collect, then the same for deliver. |

Reads are mixed in. Requesters also call `/requests/active`, `/requests/past`, `/mine`, and `/alerts`. Couriers also call `/deliveries/active`, `/deliveries/past`, and `/search`.

Downstream calls, as a share of that traffic:

| Service | When |
| --- | --- |
| User | Login + authorize on every gateway request; Order also looks up Telegram on create/accept |
| Supplier | Order validates **pickup only** (`fromLocation`) on create. Search re-checks that pickup id. |
| Order DB | Dropoff is Order-owned: create sends `deliveryPointId` (seeded campus catalogue from Flyway `V6`). |
| Credit | Order reserves 1 credit on create. Acknowledge publishes `credit.reservation.release`. The credit consumer has to be running for that second call to land. |
| Admin | Escalate calls Admin conflicts intake. About 1 in 20 closes. |
| Rating | Order reads `GET /api/v1/rating/{userId}` on create and accept. Deliver and acknowledge publish `rating.permission.granted` on `foc.rating.commands` for Rating Service to grant the modal. |
| MinIO / S3 | Collect and deliver store the PNG. |

Default duration is 10 minutes. A requester holds at most 3 orders so create rate follows how fast couriers finish. Accept collisions return 409 and count as normal contention. Defaults: Supplier pickup id `2` (approved), Order delivery-point id `1` (seeded `kent-ridge-mrt`).

Auth is an opaque Bearer **session** token (not a JWT). Seeded accounts share one password (`LOAD_PASSWORD`, default `LoadTestPass1`); the seed writes a real scrypt `passwordHash` (same format as User Service).

## Setup, then load

Signup stays out of k6. Accounts are seeded into the User and Credit databases before the run.

1. Build the roster and SQL (writes `data/users.json`, `data/users.sql`, `data/credits.sql`).
2. Apply that SQL to User DB and Credit DB.
3. Point k6 at the **gateway** and run with the same `VUS` / `REQUESTER_SHARE`.

`roster.mjs` only builds the shared list of emails and Telegram handles. `seed-users.mjs` adds stable user ids, a shared login password hash, writes the files, and can apply them locally. k6 reads `data/users.json` for emails/ids and the password.

### Local Compose

Services and gateway already up (`deploy/local.sh gateway` or equivalent → `:8080`). Seed, then run k6:

```powershell
node load-test/setup/seed-users.mjs --apply
k6 run load-test/k6/load.js
```

Short smoke:

```powershell
$env:VUS='30'; $env:DURATION='30s'
node load-test/setup/seed-users.mjs --apply
k6 run -e VUS=30 -e DURATION=30s -e BASE_URL=http://localhost:8080 load-test/k6/load.js
```

`--apply` uses Docker exec against `user-service-db-1` and `credit-postgres`. Override with `USER_DB_CONTAINER` / `CREDIT_DB_CONTAINER` if the names differ.

### EC2 against EKS

Services are in the cluster. This folder runs on the EC2 box.

1. Install Node and [k6](https://k6.io/docs/get-started/installation/) on the EC2 host.
2. Clone the repo (or copy `load-test/`).
3. Reach the User and Credit databases (RDS / port-forward / bastion, same as how you run `psql` today).
4. Generate the seed files:

```bash
export VUS=9600
node load-test/setup/seed-users.mjs
```

5. Apply the SQL to each database:

```bash
psql "$USER_DATABASE_URL" -v ON_ERROR_STOP=1 -f load-test/data/users.sql
psql "$CREDIT_DATABASE_URL" -v ON_ERROR_STOP=1 -f load-test/data/credits.sql
```

6. Confirm Supplier pickup id `2` is approved, and Order has migrated delivery points (seed id `1` exists).
7. Hit the **gateway** (public LB URL, or port-forward the gateway service):

```bash
k6 run -e BASE_URL=https://<gateway-host> load-test/k6/load.js
```

Use the same `VUS` and `REQUESTER_SHARE` for seed and k6. Re-running the seed resets balances and password hashes on the same ids.

## Env

| Variable | Default | Used by |
| --- | --- | --- |
| `VUS` | `9600` | seed + k6 |
| `REQUESTER_SHARE` | `0.3` | seed + k6 |
| `CREDIT_BALANCE` | `5000` | seed (requesters) |
| `COURIER_BALANCE` | `100` | seed (couriers) |
| `LOAD_PASSWORD` | `LoadTestPass1` | seed + k6 (shared login password) |
| `PASSWORD_SCRYPT_COST` | `16384` | seed (must match User Service) |
| `BASE_URL` / `GATEWAY_URL` | `http://localhost:8080` | k6 — API gateway base (no trailing slash) |
| `ORDER_URL` | (fallback for `BASE_URL`) | k6 — legacy alias; prefer `BASE_URL` |
| `DURATION` | `10m` | k6 |
| `THINK_SECONDS` | `1` | k6 |
| `ESCALATE_EVERY` | `20` | k6 |
| `PICKUP_ID` | `2` | k6 — Supplier approved place id (`fromLocation`) |
| `DROPOFF_ID` | `1` | k6 — Order `delivery_point.id` (`deliveryPointId`) |

## Metrics tags (Prometheus / Grafana)

Order ids appear in real request paths (`/orders/{id}/accept`, …). For streamed
metrics, `load.js` sets a stable `tags.name` per endpoint (`accept`, `collect`,
`get_order`, `login`, …) and omits the built-in `url` system tag so those UUIDs do not
create one time series per order. Thresholds still filter on custom `op`
(`login` / `create` / `read` / `fulfill` / `close`).
