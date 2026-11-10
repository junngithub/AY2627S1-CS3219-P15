# Interfaces

What the browser app calls, how often, and what it keeps in the browser. Every call goes through `src/lib/api.ts`; pages never call `fetch` themselves.

## How requests leave the browser

Every call is a relative `/api/v1/{service}/...` request to the page's own origin, so there is no cross-origin request and no service needs CORS. What sits behind that origin depends on how the app is run:

| How it runs | Who answers `/api/v1` | Token check |
| --- | --- | --- |
| Dev environment (`deploy/push-frontend-dev.sh`, the frontend-dev workflow) | CloudFront serves the built files from S3 and sends `/api/v1` to the gateway | Gateway, with User's authorize endpoint (ADR-0007) |
| Local cluster: `npm run dev` with `API_GATEWAY_URL` set | Vite proxies all of `/api` to the gateway port-forward | Gateway |
| `npm run dev` without a gateway | Vite proxies User, Admin, Supplier and Badges only | None. Order, Credit and Rating are not reachable |
| The frontend container on the `foc` Docker network (`nginx.conf`) | nginx proxies User, Admin, Supplier, Order, Credit and Badges | nginx repeats the gateway's authorize subrequest for Order and Credit only. There is no Rating route |

The gateway removes any client-sent identity headers and sets `X-User-Id`, `X-Is-Admin` and `X-Permitted-Action` from User's authorize response. The browser never sends them.

## Sign-in and the token

| Step | Detail |
| --- | --- |
| Log in | `POST /user/login` returns `{ token, ... }`. Only the token is kept |
| Keep it | In memory, mirrored to sessionStorage `foc.token` so a reload keeps the session. Closing the tab ends it |
| Send it | `Authorization: Bearer <token>` on every request. `credentials: 'include'` is also set, so moving to an HttpOnly cookie later would only change `session.ts` and `api.ts` |
| Who am I | `GET /user/me` on every app load and after login. Any failure means signed out |
| Unverified | A `Created` account is sent to `/verify-telegram` (`RequireVerified`) until User marks it `Verified` |
| Admin | `isAdmin` from `/user/me` shows the Admin tab. The Admin Service enforces it; the route guard only hides pages |
| 401 from anything | The token is cleared and the app returns to `/login` |
| Log out | Clears the token locally. User has no logout endpoint |

## Errors

Services answer `{ error, code }`. `api.ts` turns any non-2xx response into an `ApiError` with the status, `code` and message; Admin's FastAPI `{ detail }` string is used as the message when present. Pages show:

| Case | Message |
| --- | --- |
| 401 | "Your session has ended. Log in again." |
| 403 | "You do not have permission to do that." |
| Any other error with a body | The service's `error` text |
| No response, or 10 s timeout | A page-specific "Could not reach the ... Service" message |

404 is left to each page, because Admin answers non-admins with 404 on purpose.

## Calls by page

Paths are under `/api/v1`. Pages under `/admin` are owned by the admin frontend's maintainer and listed for completeness.

| Page or component | Calls |
| --- | --- |
| Every load (`AuthProvider`) | `GET /user/me` |
| `/login` | `POST /user/login`. A suspended account can send `POST /user/appeals` |
| `/signup`, `/verify-email` | `POST /user/signup`, `POST /user/verify-email`, `POST /user/resend-verification` (60 s cooldown) |
| `/verify-telegram` | `GET /user/me/status`, `POST /user/request-telegram-verification`, `POST /user/verify-telegram` |
| `/forgot-password`, `/reset-password` | `POST /user/forgot-password`, `POST /user/reset-password` |
| Nav bar (`AppShell`, `AlertsBell`) | `GET /credit/me/balance`, `GET /orders/alerts?page=0&size=20`, `GET /user/friends/requests?direction=incoming&page=1&pageSize=1` (badge count) |
| Rating prompt (`RatingPrompt`) | `GET /rating/me/pending`, `POST /rating/orders/{orderId}`, `POST /rating/orders/{orderId}/skip` |
| `/browse` | `GET /orders?page=0&size=100[&latitude&longitude]`, `POST /orders/{id}/accept` |
| `/requests/new` | `GET /supplier?pageSize=100`, `GET /orders/delivery-points`, `GET /orders/delivery-points/my-locations`, `POST /orders` |
| `/my-requests` | `GET /orders/mine?page=0&size=100`, `GET /user/friends` (names) |
| `/my-deliveries` | `GET /orders/deliveries/active`, `GET /orders/deliveries/past` (both `size=100`), `GET /user/friends` (names) |
| `/orders/{id}` (requester) | `GET /orders/{id}`, `POST /orders/{id}/cancel`, `POST /orders/{id}/acknowledge`, `POST /orders/{id}/escalate` (JSON, or multipart with a photo), `GET /supplier/{id}`, `GET /user/friends`, `POST /user/friends/request`, `POST /user/reports` |
| `/deliveries/{id}` (courier) | `GET /orders/{id}`, `POST /orders/{id}/cancel` (release), `POST /orders/{id}/collect` and `/deliver` (multipart `photo`, up to 10 MB), `GET /supplier/{id}`, `GET /user/friends`, `POST /user/friends/request`, `POST /user/reports` |
| `/suppliers`, `/suppliers/{id}`, `/suppliers/new` | `GET /supplier?...`, `GET /supplier/{id}`, `POST /supplier` |
| `/friends` | `GET /user/friends?page&pageSize`, `GET /user/friends/requests?direction=incoming\|outgoing&page&pageSize`, `POST /user/friends/{requestId}/accept\|reject`, `DELETE /user/friends/{friendUserId}`, `POST /user/friends/request` |
| `/profile` | `GET /rating/{userId}`, `GET /badges/{userId}`, `GET /orders/delivery-points/my-locations`, `PATCH` and `DELETE /orders/delivery-points/{id}`, `PATCH /user/me/password`, `DELETE /user/me` |
| `/admin` pages | `GET /admin/users`, `POST /admin/users/{id}/promote\|suspend\|reinstate`, `GET /admin/conflicts`, `GET /admin/conflicts/{caseId}`, `POST /admin/conflicts/{caseId}/review\|resolve`, `GET /admin/reports?status=open`, `POST /admin/reports/{id}/dismiss`, `GET /admin/appeals?status=open`, `POST /admin/appeals/{id}/reject`, `GET /supplier/admin`, `GET /supplier/admin/activity`, `PATCH /supplier/{id}/status`, `PATCH` and `DELETE /supplier/{id}`, `GET /rating/{userId}` |

The browser never calls a `/internal` path. The gateway and nginx both block them.

## Refreshing

Nothing pushes to the browser; shared data is polled while something on screen reads it. Each of these is one copy for the whole app (a `useSyncExternalStore` store), so two components never fetch the same thing twice. Polls skip hidden tabs and refresh at once when the tab becomes visible again.

| Data | When | Why that often |
| --- | --- | --- |
| Open order (`/orders/{id}`, `/deliveries/{id}`) | Every 5 s, and on focus | The other party's actions show up without a reload. Order F2.13 promises status alerts within a minute |
| Credit balance | Every 20 s, on focus, and after posting, cancelling, acknowledging or delivering | Credit settles from Kafka, outside this tab |
| Order alerts (bell) | Every 30 s, and on focus | Order F2.13, within a minute |
| Pending ratings | Every 30 s, on focus, and 1.5, 4 and 10 s after delivering or acknowledging | Grants reach Rating over Kafka a moment after the action |
| Incoming friend requests count | On load and on focus | A hint only |
| Friends' names on order pages | When an order page opens, and after a friend is added or removed | |
| Browse list | On load, and when the location changes | Order F4.2.1 ranks once per search |

Stores are cleared when nothing reads them, for example after signing out, so the next user never sees the previous user's balance, alerts or ratings.

## Browser storage

Everything here is a per-browser convenience. Each value is keyed by user id inside the JSON, every read and write is wrapped so blocked storage only loses the convenience, and nothing here is needed for correctness.

| Key | Where | Holds | Why it is not on a server |
| --- | --- | --- | --- |
| `foc.token` | sessionStorage | The login token | Keeps the session across a reload in one tab |
| `foc.alerts.seen` | localStorage | `{ [userId]: time }`, when the bell was last opened | Order keeps no read state for alerts |
| `foc.alerts.cleared` | localStorage | `{ [userId]: { before, ids } }`. Clear all sets `before`; clearing one row adds its id, latest 200 kept | Order cannot delete alerts |
| `foc.rating.promptedAt` | sessionStorage | `{ [userId]: time }`, when the rating prompt last closed | The prompt opens by itself at most once per tab session |
| `foc.rating.skipped` | localStorage | `{ [userId]: orderId[] }`, latest 200 | Fallback only: used when `POST /rating/orders/{id}/skip` fails |
