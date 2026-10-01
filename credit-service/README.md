# Credit Service

Manages the closed credit economy for Friend on Campus (FoC): per-user balances,
credit reservations for orders, and an append-only audit log. See
[`docs/schema.md`](docs/schema.md) for the data model and requirement mapping (F1–F5).

## Stack

- **Fastify** (HTTP) + **pino** logging
- **Drizzle ORM** + **drizzle-kit** over **PostgreSQL**
- **TypeScript** (ESM), Node 22+

## Layout

```
credit-service/
├── src/
│   ├── server.ts            # entrypoint: boot + graceful shutdown
│   ├── app.ts               # Fastify instance + route registration
│   ├── config.ts            # env-driven config
│   ├── database/
│   │   ├── schema.ts        # Drizzle table definitions (credit_user/order/log)
│   │   └── index.ts         # Drizzle client (postgres.js)
│   ├── routes/              # HTTP endpoints (health + credit endpoints)
│   └── services/            # credit domain functions (transactions)
├── drizzle.config.ts        # drizzle-kit config
├── docker-compose.yml       # local Postgres
└── Dockerfile               # production image
```

## Quickstart (local dev)

```bash
# 1. Start Postgres (Docker)
docker compose up -d

# 2. Install deps
npm install

# 3. (once table migrations exist) apply them
npm run db:generate   # generate SQL from src/database/schema.ts
npm run db:migrate    # apply migrations to the DB

# 4. Run the server (watch mode)
npm run dev
```

The app defaults to `postgres://credit:credit@localhost:5432/credit_db`, matching
`docker-compose.yml`. Override with `DATABASE_URL` (a local `.env` in this folder is
auto-loaded). See the repo-root `.env.example` for all variables.

Health checks: `GET /health` (liveness) and `GET /health/db` (Postgres reachability).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Run with hot reload (tsx watch) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` | Type-check without emitting |
| `npm run db:generate` | Generate migration SQL from the schema |
| `npm run db:migrate` | Apply migrations |
| `npm run db:push` | Push schema directly (dev only) |
| `npm run db:studio` | Open Drizzle Studio |
