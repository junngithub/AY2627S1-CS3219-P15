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
docker compose up frontend   # http://localhost:8080
```

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

- Signed out: `/login`, `/signup`, `/verify-email`, `/verify-email/confirm?token=`
  (where the verification email should link), `/forgot-password`,
  `/reset-password?token=`
- Signed in: `/browse`, `/my-requests`, `/my-deliveries`, `/requests/new`,
  `/orders/:orderId`, `/suppliers`, `/suppliers/new`, `/profile`, `/account-status`
- Admin: `/admin`, `/admin/suppliers`, `/admin/users`, `/admin/escalations`, `/admin/ratings`

## Sign-in and demo mode

Sign-in is off by default, because the User Service does not exist yet. While
it is off, every visitor is the demo user in `src/samples/account.ts` (an
admin), and every User and Admin Service call is stubbed. Supplier calls are
always real.

To use the real services, create `frontend/.env.local`:

```
VITE_AUTH_ENABLED=true
# Placeholders until the team agrees ports; see vite.config.ts.
USER_SERVICE_URL=http://localhost:8082
ADMIN_SERVICE_URL=http://localhost:8083
```

For the Docker image, pass `--build-arg VITE_AUTH_ENABLED=true`.

### Against the local cluster (all services, through the API gateway)

Start the local stack and the gateway port-forward
(see [`deploy/README.md`](../deploy/README.md)):

```bash
deploy/local.sh gateway     # keep running: the gateway on http://localhost:8080
```

Then use this `frontend/.env.local` instead, and `npm run dev`:

```
VITE_AUTH_ENABLED=true
API_GATEWAY_URL=http://localhost:8080
```

Every `/api` call then goes through the gateway, which checks the token. Only
signup/login-style routes and `GET /api/v1/supplier` work without one, so
sign-in must be on. To get a login, sign up and verify the email with the OTP
from `kubectl -n foc logs deploy/user`, or use the local test users in
`deploy/README.md`.

## Not wired yet

- The nav credit balance shows a placeholder, though
  `GET /api/v1/credit/me/balance` now exists.
- Order pages run on sample data; see `src/samples/README.md`.

## AI assistance

The initial scaffold was generated with Claude Code (Claude Opus 5) on 2026-09-22;
per-file disclosure headers are in place and the prompts belong in
`/ai/usage-log.md`. Author review pending.
