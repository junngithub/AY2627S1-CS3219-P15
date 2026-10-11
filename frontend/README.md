# Frontend

React + TypeScript single-page app built with Vite, served by nginx in its
container. Covers UI FR1-FR20 and UI NFR1-NFR12 from the D1 backlog.

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
- `src/components/ui/` - shared building blocks: Button, Card, Icon.
- `src/components/layout/` - AppShell (signed-in nav, hamburger below 768px)
  and AuthLayout (centered card).
- `src/pages/` - pages. Every route currently renders a placeholder naming the
  backlog items it will cover.
- `src/App.tsx` - the route table.

Breakpoint: 768px and up is desktop, below is mobile (UI FR20.1.1). CSS
variables cannot be used inside media queries, so `767px` is written literally.

## Routes

- Signed out: `/login`, `/signup`, `/verify-email` (enter the six-digit code;
  in development the User Service prints it in its log), `/forgot-password`,
  `/reset-password?token=`
- Signed in: `/browse`, `/my-requests`, `/my-deliveries`, `/requests/new`,
  `/orders/:orderId`, `/suppliers`, `/suppliers/new`, `/profile`, `/account-status`
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

## Not wired yet

Commented out in the pages, each with a TODO naming the missing piece:

- Names of requesters and couriers: orders carry user ids only.
- Order photos: they can be uploaded but no endpoint serves them.
- My deliveries: no endpoint lists the orders a courier is delivering.
- Credits reserved, the earned/spent breakdown and credit history: the
  balance endpoint returns the available figure only, and the ledger endpoint
  is not implemented.
- Ratings from the courier side: the Rating Service does not exist yet.

## AI assistance

The initial scaffold was generated with Claude Code (Claude Opus 5) on 2026-09-22;
per-file disclosure headers are in place and the prompts belong in
`/ai/usage-log.md`. Author review pending.
