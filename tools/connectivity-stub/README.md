# connectivity-stub

A placeholder HTTP service that stands in for FoC services that don't have an
image yet, so the platform can be tested end to end: DNS, network policy,
image pulls from ECR, and Kafka credentials mounted into each service. It has
no business logic and no dependencies.

| Endpoint | Response |
|---|---|
| `GET /health` | `{"status":"ok","service":"<SERVICE_NAME>"}` |
| anything else | `{"service":"…","stub":true,"method":"…","path":"…","userId":…,"isAdmin":…}`. `userId`/`isAdmin` echo the `x-user-id`/`x-is-admin` headers the gateway added, so tests can see what reached the backend. |
| `* /api/v1/user/authorize` (only as `user`) | stands in for User's auth endpoint (ADR-0007). `Authorization: Bearer stub:<name>@u.nus.edu` (or `@nus.edu.sg`) gives `200` with headers `x-user-id: <email>` and `x-is-admin: true` if `<name>` starts with `admin`. Anything else gives `401`. |

Env: `PORT` (default 3000) and `SERVICE_NAME`. The `foc-service` chart sets both
for every service.

## How it's used

Only the **local** environment uses it. Each stubbed service keeps its real
image name in `deploy/values/services/<svc>.yaml`, and
`deploy/values/envs/local/services/<svc>.yaml` overrides it:

```yaml
image:
  name: foc/connectivity-stub
  tag: "0.2.0"
```

When a service's real image exists, delete those two lines. The same release
name, Service name, port and Kafka user then run the real code.

## Build and push to local ECR

```bash
deploy/push-local.sh connectivity-stub   # tag = "version" in package.json; restarts every service running the stub
```

The ECR repository `foc/connectivity-stub` comes from `var.tools` in
`infra/local/aws`. Tags are mutable locally, but bump `version` in
`package.json` and the tag in the values when the stub changes, so it's
obvious which build is running.

## Image practices followed

- Base image pinned to an exact version (`node:22.23.3-alpine`).
- Runs as the unprivileged `node` user.
- Production start (`node server.js`), with no dev tooling in the image.
- `.dockerignore` allow-lists only the two files the image needs.
- Handles `SIGTERM` so pods stop immediately on rollout.
