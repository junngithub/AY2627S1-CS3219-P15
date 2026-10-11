# ADR-0011: Schema migrations run as a per-service pre-deploy Job

- **Status:** Accepted. Local chart and images built and tested; cloud (Argo CD) untested.
- **Date:** 2026-10-01

## Context

ADR-0010 decided that migrations run as a pre-deploy Job, not at app startup,
but didn't build it. Until it exists, User and Supplier start against an empty
database and fail on their first query, and Credit only passes its health
check because `/health/db` runs `select 1`.

The runtime images are slim on purpose (`node dist/...`, production
dependencies only, so they fit the 256Mi limit). They contain neither the
`prisma` CLI nor `drizzle-kit`, so they can't migrate.

## Decision

- **Each service owns its migrations**, in its own repository folder, and
  they ship in its own image. One bundled "migrate everything" script was
  rejected: it would need every service's credentials (breaking one database
  per service), both toolchains, and one failure would block every deploy.
- **A `migrate` Dockerfile stage** (`FROM build AS migrate`) holds the CLI and
  the migration files. It sits before `runtime`, so a plain `docker build`
  still produces the slim runtime image. It runs as `node`.
- **Same repository, tag `<tag>-migrate`.** No new ECR repository is needed.
  `deploy/push-local.sh` builds and pushes it for any Dockerfile with a
  `migrate` stage. CI must do the same in the cloud.
- **One shared Job template** in `charts/foc-service`
  (`templates/migrate-job.yaml`), switched on by `migrate.enabled` and given
  the service's `migrate.command`:
  - User, Supplier: `node_modules/.bin/prisma migrate deploy`
  - Credit: `npm run db:migrate` (`drizzle-kit migrate`)
- The Job is a Helm `pre-install`/`pre-upgrade` hook (Argo CD PreSync), so a
  failed migration fails the release and the old pods keep running. It reads
  `DATABASE_URL` from Secret `<svc>-db` (ADR-0010) and takes `env` inline,
  because a hook runs before the release's ConfigMap exists on first install.
- The `foc-database` release deploys before the services, so the database and
  login exist by the time a migration runs. In Argo CD, give the database
  application an earlier sync wave.

## Consequences

- Migrations must be **backward compatible**: during a rolling update the old
  pods run against the new schema. Add a column in one release, stop using
  the old one in the next, drop it in a third.
- Use `migrate deploy` (apply existing migrations), never `migrate dev`.
- Locally, `user` and `supplier` still run the connectivity stub, so
  `migrate.enabled: false` in their local values. Remove it together with the
  stub override.
- Credit's `.dockerignore` no longer excludes `drizzle/`: the migrate stage
  needs the SQL files.
- Still to do: build and push the `-migrate` image in CI, and confirm the
  hook and sync-wave ordering under Argo CD.
