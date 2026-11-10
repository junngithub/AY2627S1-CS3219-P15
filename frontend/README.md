# Frontend

React + TypeScript single-page app built with Vite, served by nginx in its
container. Covers UI FR1-FR20 and UI NFR1-NFR12 from the D1 backlog.

Flows across services (sign-in, posting a request, the courier's task,
acknowledging and rating, the bell) are drawn in [docs/README.md](docs/README.md).
Every API call by page, the polling intervals, error handling and browser
storage keys are in [docs/interfaces.md](docs/interfaces.md).

## Running it

```
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check, then production build into dist/
```

With Docker, from the repo root:

```
docker network create foc    # once
docker compose -f supplier-service/docker-compose.yml up -d --build
docker compose -f user-service/docker-compose.yml up -d --build
docker network connect --alias supplier-service foc supplier-service-supplier-service-1
docker network connect --alias user-service foc user-service-user-service-1
docker build -t foc-frontend ./frontend
docker run -d --rm --name foc-frontend -p 3000:80 --network foc foc-frontend   # http://localhost:3000
```

Host port 3000, because the User Service publishes 8080. nginx reaches each
backend by service name on the `foc` network, so the connect step is repeated
whenever a backend's containers are recreated. In development the verification
code is printed by `docker logs user-service-user-service-1`.

## Layout

- `src/styles/tokens.css` - every colour, size and spacing value (UI NFR10.1.2).
  Values marked APPROX were read off the low-resolution D1 wireframes.
- `src/styles/global.css` - reset, focus ring, base type.
- `src/components/ui/` - shared building blocks: Button, Card, Dialog, Icon,
  StatusBadge and the form fields.
- `src/components/layout/` - AppShell (signed-in nav, hamburger below 768px,
  the bell), AdminLayout and AuthLayout (centered card).
- `src/components/` (other folders) - pieces used by one area: browse, order,
  rating, friends, map, moderation, supplier, admin.
- `src/pages/` - one file per route.
- `src/lib/` - every call to a service (`api.ts` shapes all of them), the
  shared polled stores (credit, alerts, pending ratings, friends) and helpers.
- `src/auth/` - AuthProvider (who is signed in), RequireAuth and
  RequireVerified route guards.
- `src/App.tsx` - the route table.

Breakpoint: 768px and up is desktop, below is mobile (UI FR20.1.1). CSS
variables cannot be used inside media queries, so `767px` is written literally.

## Routes

- Signed out: `/login`, `/signup`, `/verify-email` (enter the six-digit code;
  in development the User Service prints it in its log), `/forgot-password`,
  `/reset-password?token=`
- Signed in, not yet verified: `/verify-telegram`
- Signed in: `/browse`, `/my-requests`, `/my-deliveries`, `/requests/new`,
  `/orders/:orderId` (requester), `/deliveries/:orderId` (courier),
  `/suppliers`, `/suppliers/new`, `/suppliers/:supplierId`, `/profile`, `/friends`
- Admin: `/admin`, `/admin/suppliers`, `/admin/users`, `/admin/escalations`, `/admin/ratings`

## Backends

There is no demo mode: every page talks to the real services, and signing in
needs the User Service. Pages whose service is not running show an error
rather than sample data.

The dev server (`npm run dev`) proxies the User, Admin, Supplier and Badges
Services, overridable in `frontend/.env.local`:

```
USER_SERVICE_URL=http://localhost:8080
ADMIN_SERVICE_URL=http://localhost:8084
```

The Order and Credit Services identify the caller from an `X-User-Id` header
that only the gateway's authorize check sets (infra ADR-0007). `nginx.conf`
repeats that check for local runs, so the order pages and credit balance work
in the container but not on the dev server.

The nginx authorization subrequest calls User Service's canonical
`/api/v1/user/internal/authorize` directly. Public requests to the User Service
internal prefix and the legacy `/api/v1/user/authorize` alias receive `404`.
Rebuild/recreate the frontend container when changing this proxy configuration;
this migration does not change any React pages or forms.

### Against the local cluster (all services, through the API gateway)

Start the local stack and the gateway port-forward
(see [`deploy/README.md`](../deploy/README.md)):

```bash
deploy/local.sh gateway     # keep running: the gateway on http://localhost:8080
```

Then use this `frontend/.env.local` instead, and `npm run dev`:

```
API_GATEWAY_URL=http://localhost:8080
```

Every `/api` call then goes through the gateway, which checks the token. Only
signup/login-style routes and `GET /api/v1/supplier` work without one. To get a login, sign up and verify the email with the OTP
from `kubectl -n foc logs deploy/user`, or use the local test users in
`deploy/README.md`.

## Not wired yet

Commented out in the pages, each with a `TODO(service)` naming the missing piece:

- Names of requesters and couriers: orders carry user ids and Telegram handles
  only. The order pages show the handle, or the name once the two are friends
  (the friends list is the only place a name can be read).
- The requester's rating on the courier's task page: hidden for now. Request
  cards on Browse show it from Order's snapshot.
- Credits reserved, the earned/spent breakdown and credit history: the
  balance endpoint returns the available figure only, and the ledger endpoint
  is not implemented.
- Admin credit adjustments and other users' balances: Credit has no admin
  endpoint for either.
- Real paging on Browse: one page of 100 for now.

Order photos are deliberately not shown: the requester does not see the
courier's collection and delivery photos (UI FR7.4 dropped on 2026-11-03).

Without the gateway, Rating is not reachable (neither `nginx.conf` nor the dev
server proxies it), and both send Badges to port 4006, which is not the port
Badges listens on (8086). Use the local cluster through the gateway for the
rating prompt and the profile's rating and badges.

## AI assistance

The initial scaffold was generated with Claude Code (Claude Opus 5) on 2026-09-22;
per-file disclosure headers are in place and the prompts belong in
`/ai/usage-log.md`. Author review pending. `docs/` was written with Claude Code
(Claude Opus 5.5) on 2026-11-09 from the code as it stands.
