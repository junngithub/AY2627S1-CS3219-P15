# Frontend on S3 + CloudFront: readiness

> **Update (2026-10-21):** the infrastructure below is now written:
> `infra/nonprod/aws/frontend.tf` and `gateway-lb.tf`, plus
> `.github/workflows/frontend-dev.yml`. The `/api/*` origin is an internal NLB
> behind a CloudFront VPC origin, so the origin-TLS question below is settled
> ([ADR-0013](adr/0013-cloudfront-vpc-origin-and-external-secrets.md)).
> Bring-up steps are in [`cloud-dev.md`](cloud-dev.md). The rest of this page
> is the original assessment.

> **Status (2026-10-18):** the **app is ready with small infra-side changes**;
> the **AWS infrastructure is not**. The frontend is a pure client-side SPA
> with no runtime config, cookies or websockets, so it can move off nginx.
> What's missing is everything it would sit on: no S3/CloudFront Terraform,
> no `infra/nonprod`, and no services deployed to dev for `/api` to reach.
> Assessed against `main` at `31da7c3` plus the gateway fixes listed below.

## Target shape

One CloudFront distribution, one domain, two behaviours:

```text
browser ──▶ CloudFront (one domain)
             ├─ /api/*  ──▶ Envoy gateway (NLB)  ──▶ services   (no cache)
             └─ default ──▶ S3 bucket (private, OAC)            (SPA files)
```

Keeping `/api` on the **same origin** as the app is the key decision:

- The app calls relative paths only (`fetch(\`/api/v1${path}\`)`,
  `frontend/src/lib/api.ts:70`), so **one build serves every env**. No
  `VITE_*` variable or `/config.js` is needed.
- **No CORS.** No service or gateway configures CORS today, and none has to.
- Login is a bearer token in `sessionStorage` sent as `Authorization`; there
  are no cookies or OAuth redirects. The one place the domain matters:
  password-reset emails link to `FRONTEND_BASE_URL/reset-password`
  (`user-service/src/config.ts`), so each env's user-service needs
  `FRONTEND_BASE_URL` set to that env's CloudFront domain. The link is a deep
  link, so it relies on the SPA fallback below.

A separate API domain (`api.<domain>`) would instead need an API base URL
in the build, one build per env, and a CORS block (with an `OPTIONS`
preflight that skips extAuth) in the `foc-gateway` SecurityPolicy.

## What nginx does today, and where each job goes

`frontend/nginx.conf` + `proxy_headers.conf` + `Dockerfile`:

| nginx job | S3 + CloudFront equivalent | Status |
|---|---|---|
| Serve `dist/` | S3 origin, private bucket, Origin Access Control | ✅ |
| SPA fallback (`try_files … /index.html`) | **CloudFront Function (viewer-request) on the default behaviour only**: a URI without a file extension is rewritten to `/index.html` | ⚠️ see [below](#spa-fallback-not-custom-error-responses) |
| `/assets/` cached 1 year, immutable | `Cache-Control: public,max-age=31536000,immutable` set at upload; CachingOptimized policy | ✅ |
| `index.html` not cached | upload with `Cache-Control: no-cache`, invalidate `/index.html` per deploy | ✅ |
| Proxy `/api/v1/*` to each service by Docker DNS name | one `/api/*` behaviour → Envoy gateway; the gateway already routes by prefix | moves to the gateway |
| `auth_request /_authorize` + set `X-User-Id`, `X-Is-Admin`, `X-Permitted-Action` | can't run in CloudFront, and doesn't need to: Envoy's extAuth does it ([ADR-0007](adr/0007-envoy-gateway-extauth.md)) | ✅ already in the gateway |
| Overwrite `X-User-Telegram` with `""` | gateway strips it (`identityHeaders`) | ✅ fixed 2026-10-18 |
| `/api/v1/user/authorize` (legacy) and `/api/v1/user/internal/*` → 404 | gateway `blockedPaths` / `blockedPrefixes` | ✅ |
| `/api/v1/badges/internal` → 404 | gateway `blockedPrefixes` | ✅ fixed 2026-10-18 |
| `client_max_body_size 11m` (10 MB photos) | CloudFront has no small body limit for custom origins; check Envoy's buffer limit with a real 10 MB photo | verify |
| Websocket upgrade | none needed: live order updates poll `GET /orders/{id}` every 10 s (`useLiveOrder.ts:20`) | ✅ |
| Security headers | **nginx sets none today**; add a CloudFront response headers policy (HSTS, CSP, X-Frame-Options) | optional improvement |

Gateway fixes made while assessing this (2026-10-18, `deploy/charts/foc-gateway`):
`blockedPrefixes` now also block credit's reserve and release (order's
internal calls, which let any logged-in user spend or refund anyone's
credits; since 2026-10-21 both sit under `/api/v1/credit/internal`, which
is the blocked prefix) and `/api/v1/badges/internal`;
`x-user-telegram` was added to `identityHeaders`.

Note that behaviour through CloudFront will match the **gateway**, not
today's nginx container: the gateway puts supplier, badges and admin behind
auth (except the exact `GET /api/v1/supplier`), which nginx did not.

### SPA fallback: not custom error responses

The common recipe, distribution-wide custom error responses `403/404 →
/index.html (200)`, **breaks the API**. Those rules apply to every behaviour,
so a real API 404 would come back as a 200 HTML page, and `api.ts` would fail
to parse it as JSON. The app relies on API 404s:

- Admin answers non-admins with 404 on purpose (`api.ts:123-124`).
- Order answers 404 for an order that is missing or not yours
  (`useLiveOrder.ts:44`).
- The gateway answers blocked and unknown paths with 404.

Use a **viewer-request CloudFront Function on the default (S3) behaviour
only**:

```js
function handler(event) {
  var req = event.request;
  // /orders/123 → index.html; /assets/app.js and /favicon.ico pass through.
  if (!req.uri.includes('.')) req.uri = '/index.html';
  return req;
}
```

The app uses `BrowserRouter` (`frontend/src/main.tsx:22`) with deep routes
(`/orders/:orderId`, `/deliveries/:orderId`, `/suppliers/:supplierId`,
`/admin/*`) and its own catch-all page, so this is required.

## The `/api/*` behaviour

- **Origin:** the Envoy gateway's NLB (the `envoy-foc-<env>` LoadBalancer
  Service, once the AWS Load Balancer Controller is installed).
- **Cache policy:** `CachingDisabled`.
- **Origin request policy:** `AllViewerExceptHostHeader`, so `Authorization`,
  query strings and the multipart body reach the gateway. Check `Authorization`
  actually arrives with this combination before relying on it.
- **Allowed methods:** all (the app uses `PATCH` and `DELETE`).
- **Origin TLS:** the gateway listens on **plain HTTP :80**
  (`foc-gateway/values.yaml` `listenerPort: 80`). CloudFront → NLB would cross
  the internet unencrypted. Either terminate TLS on the NLB (ACM cert) or use a
  CloudFront **VPC origin** with an internal NLB, which also keeps the gateway
  off the public internet.
- The NLB's DNS name is assigned by the controller at runtime. Give it a
  fixed name (Service annotation) or look it up with a data source, so
  Terraform can reference it.

## Required work, in order

1. **Dev has an API at all.** Build `infra/nonprod/{aws,bootstrap}`
   (`infra/README.md` lists it; it doesn't exist yet), install the AWS Load
   Balancer Controller, and add `deploy/values/envs/dev/services/*.yaml`.
   Today `deploy/values/envs/dev/` holds only `kafka.yaml` and
   `namespace.yaml`, so the `foc-services` ApplicationSet creates nothing.
2. **Gateway origin TLS** or a VPC origin (above).
3. **Terraform for the frontend**, e.g. in `infra/nonprod/aws/frontend.tf`:
   S3 bucket + OAC + bucket policy, the distribution with both behaviours,
   the CloudFront Function, a response headers policy, and ACM + Route 53 if
   using a custom domain (ACM for CloudFront must be in `us-east-1`).
4. **CI deploy step** for the frontend (todo: GitHub Actions):
   `npm ci && npm run build`, then
   `aws s3 sync dist/assets s3://<bucket>/assets --cache-control "public,max-age=31536000,immutable"`,
   `aws s3 cp dist/index.html s3://<bucket>/index.html --cache-control no-cache`,
   then `aws cloudfront create-invalidation --paths /index.html`.
   The frontend isn't a Kubernetes workload, so Argo CD doesn't deploy it.
5. **Retire or keep nginx.** `frontend/Dockerfile`, `nginx.conf` and
   `proxy_headers.conf` can stay for local container runs; update
   `frontend/README.md` ("served by nginx"). Note `nginx.conf` sends credit
   traffic to `credit-service:8082`, but credit listens on **3000**.

## Not blocking the move, but block a usable dev env

These were found in the same local integration test (2026-10-18) and apply
however the frontend is hosted:

- **Emails are only logged** (`user-service/src/email.ts` has only
  `DevelopmentEmailSender`): signup OTPs and password-reset links. On dev,
  nobody can read pod logs to sign up; an SES sender is needed.
- **Telegram verification needs a bot per env.** User verifies Telegram
  through a bot (`user-service/src/telegram.ts`), configured by
  `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME`. Without it, signups never
  get `telegramVerifiedAt`, so `x-permitted-action` stays false and every
  order call is a 403.
- Order photos are stored on the pod's filesystem (`application-k8s.yml`)
  unless `order.photos.mode: s3` is set (`S3PhotoConfig.java`); on EKS they'd
  be lost on every restart.
