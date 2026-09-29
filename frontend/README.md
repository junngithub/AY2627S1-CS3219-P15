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

- Signed out: `/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password`
- Signed in: `/browse`, `/my-requests`, `/my-deliveries`, `/requests/new`,
  `/orders/:orderId`, `/suppliers`, `/suppliers/new`, `/profile`, `/account-status`
- Admin: `/admin`, `/admin/suppliers`, `/admin/users`, `/admin/escalations`, `/admin/ratings`

## Not wired yet

- No API calls. Backend ports, base paths and whether requests go through a
  gateway are still to be agreed; `vite.config.ts` and `nginx.conf` have
  marked spots for the proxy.
- No auth. Signed-in routes are reachable without logging in until User Service
  defines its token flow.
- The nav credit balance shows a placeholder: Credit Service has no read-balance
  requirement in the backlog.

## AI assistance

The initial scaffold was generated with Claude Code (Claude Opus 5) on 2026-09-22;
per-file disclosure headers are in place and the prompts belong in
`/ai/usage-log.md`. Author review pending.
