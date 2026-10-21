# Supplier Service

Stores campus supplier listings. A permitted user can submit one. A verified admin can edit, approve, reject, or delete it. The public catalogue and the single-supplier lookup stay open so the app and Order Service can read them without gateway identity headers.

## API

The gateway checks a session and sets `x-user-id`, `x-is-admin`, and `x-permitted-action`. `x-is-admin` is `true` only for role `ADMIN`. `x-permitted-action` is `true` only when the account is active and email and Telegram are verified. Client-sent copies of those headers are ignored.

Protected routes without `x-user-id` return **401**. A signed-in user who is not an admin gets **403** (`Admin access is required`). An admin who is not permitted gets **403** (`This account is not permitted to manage suppliers`).

| Method | Endpoint | Body / Params | Purpose |
| --- | --- | --- | --- |
| POST | `/api/v1/supplier` | `{ name, building, floor, locationDescription, latitude, longitude, startingTime, closingTime, categories[] }` | F1.1. Permitted user (`x-permitted-action=true`). Validates lat/long bounds and time format (F1.1.1/F1.1.2). Created as `pending`. Stores the caller as `createdByUserId` and logs `created` with a timestamp. |
| GET | `/api/v1/supplier` | `?category=&page=&pageSize=` public | F1.2/F1.4. No gateway check. `category` accepts one or more comma-separated values (e.g. `?category=Food,Coffee`), matched as OR. Pending/Rejected suppliers excluded (F1.4.1). |
| GET | `/api/v1/supplier/{id}` | — | No gateway check. Used by Order Service to validate pickup/dropoff locations (F1.5.1/F1.6.1 in Order FR). |
| GET | `/api/v1/supplier/admin` | `?status=` | F1.4.1. Verified admin (`x-is-admin=true` and `x-permitted-action=true`). Includes Pending/Rejected. |
| PATCH | `/api/v1/supplier/{id}` | Any of `{ name, building, floor, locationDescription, latitude, longitude, startingTime, closingTime, categories[] }` | Verified admin. Edits listing details only. Status is unchanged. Logged as `edited` with timestamp, admin user id, and the fields changed. |
| PATCH | `/api/v1/supplier/{id}/status` | `{ status: pending\|approved\|rejected }` | F1.3.1. Verified admin. Logged as `approved`, `rejected`, or `pending` with timestamp and admin user id. |
| DELETE | `/api/v1/supplier/{id}` | — | Verified admin. Removes the supplier. Logged as `deleted` with timestamp, admin user id, and supplier name. The log row is kept after the supplier is gone. |
| GET | `/api/v1/supplier/admin/activity` | `?supplierId=` | Verified admin. Returns who created, edited, approved, rejected, or deleted a supplier. |
| GET | `/health` | — | Liveness probe. |

## Tests

API checks live in `tests/`, separate from `src/`, same layout as Admin Service.

```powershell
npm test
```

`tests/suppliers.test.ts` stubs the database and checks the gateway rules: public reads, permitted create, verified-admin edit/approve/delete, and the activity log. It does not need Postgres.

## Run

```powershell
docker compose up --build
```

The API is on port `8081`. Postgres is on port `5555`. The container applies migrations on startup.
