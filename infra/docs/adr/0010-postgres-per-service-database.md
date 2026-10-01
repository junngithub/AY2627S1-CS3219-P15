# ADR-0010: One Postgres instance per cluster, one database per service

- **Status:** Accepted. Local implemented and tested on 2026-10-01; cloud not built.
- **Date:** 2026-10-01

## Context

User, Supplier and Credit need Postgres (Prisma or Drizzle); Order, Rating,
Badges and Admin will later. The architecture already chose "one RDS, a
database per service". We still needed to decide:

- what runs Postgres locally;
- how many instances the shared nonprod cluster gets;
- who creates the per-service databases and logins;
- how credentials reach pods;
- how TLS works.

### Spike: Floci's RDS (2026-10-01)

Floci runs each RDS instance as a real `postgres` container behind a proxy
inside the Floci container, on ports 7001–7099
([docs](https://floci.io/floci/services/rds/)). Tested with a throwaway
instance:

| Check | Result |
|---|---|
| Create (Postgres 16) | Available in seconds. Endpoint is the Floci container's IP on the Docker network k3s shares (`172.19.0.2:7001`). |
| Reach from pods, including `foc` behind its NetworkPolicy | Works by IP. Docker names (`floci`, `host.docker.internal`) don't resolve in pods. |
| Per-service login and database through the proxy | Works. Another service's database: `permission denied`. Wrong password: refused. |
| Floci restart | Same address and port, and data kept (persistent storage). Readable from pods on the recreated k3s. |
| `manage_master_user_password` | Not supported. |

## Decision

- **Instances**
  - local: Floci RDS (`infra/local/aws/rds.tf`);
  - nonprod: **one shared RDS**, with dev and stg as separate databases;
  - prod: its own RDS.

  Terraform creates each instance. Services connect to the address Terraform
  reports, as in the cloud.
- **Names:** database and login `<env>_<service>` (e.g. `local_credit`,
  `dev_credit`, `stg_credit`). Unique on the shared nonprod instance, and
  avoids reserved words such as `user`.
- **Databases and logins** are created by `deploy/charts/foc-database`, as a
  Job running in the cluster (post-install/upgrade hook; Argo CD runs it as
  PostSync) with the admin login. It is safe to rerun: an existing login gets
  its password reset to the current one. Not Terraform's Postgres provider,
  because cloud RDS is in private subnets that a laptop or CI can't reach.
- **Each service sees** Secret `<service>-db`, which holds `DATABASE_URL` (and
  `PG*`). `charts/foc-service` sets `DATABASE_URL` when `database.enabled` is
  true. Same in every env.
- **Passwords**
  - local: Terraform `random_password` → `terraform output -json database` →
    a values file → the chart writes the Secrets;
  - cloud: Terraform `random_password` → Secrets Manager → External Secrets
    Operator creates the same Secrets (`createSecrets: false`);
  - the admin password is RDS-managed (`manage_master_user_password`) in the
    cloud and Terraform-generated locally.
- **TLS:** locally `DB_SSL=false` (Floci's proxy has a self-signed CA, and
  traffic stays inside Docker). The cloud keeps TLS on and verifies RDS's
  certificate: each image ships AWS's RDS CA bundle, with
  `NODE_EXTRA_CA_CERTS` pointing at it (Node doesn't trust Amazon's RDS CAs
  by default).
- **Schema migrations** belong to each service. They run as a pre-deploy Job
  (Helm `pre-install`/`pre-upgrade` hook, i.e. Argo CD PreSync), not at app
  startup where replicas would race. Built in [ADR-0011](0011-migration-jobs.md).

## Consequences

- Locally `deploy/local.sh` needs `terraform` and `infra/local/aws` applied.
  `deploy/local.sh check` runs `helm test database`: each login uses its own
  database and is refused by every other one.
- A service only gets a database once it's in `var.databases`
  (`infra/local/aws`) and has `database.enabled` set in
  `deploy/values/services/<svc>.yaml`.
- Credit's `/health/db` is checked by its `helm test`, which proves real code
  reaches its database end to end.
- Still to build for the cloud: `rds.tf` for nonprod and prod (private
  subnets, a security group allowing EKS nodes, backups, deletion protection
  in prod), Secrets Manager entries, External Secrets Operator, the RDS CA
  bundle in images, and migration Jobs.
