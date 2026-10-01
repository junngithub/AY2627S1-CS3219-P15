# ADR-0007: Envoy Gateway checks auth once at the edge

- **Status:** Accepted. Implemented and tested locally on 2026-10-01; cloud NLB pending.
- **Date:** 2026-09-29

## Context

The API contract has every service call User `POST /api/v1/user/authorize`
itself on each request. We want one place that authenticates external
traffic. The usual choice, ingress-nginx, has been retired (maintenance
ended March 2026).

## Decision

- Use **Envoy Gateway** (Gateway API) behind an NLB. A `SecurityPolicy` with
  `extAuth` calls User `/api/v1/user/authorize` and forwards `X-User-Id` and
  `X-Is-Admin` to the backends.
- The gateway strips any client-supplied `X-User-*` headers.
- Public routes (signup, login, `GET /supplier`) are HTTPRoutes without the
  policy.
- NetworkPolicy lets services accept external traffic only from the gateway.
- Service-to-service calls go directly through in-cluster DNS, not through
  the gateway.

## Consequences

- **Contract change:** `/authorize` must return `200` with identity
  **headers**, or `401`. Results must not be cached for longer than about
  30s, so suspensions take effect within Admin F1.2.1's 60s.
- The Admin "404 instead of 403" rule stays inside the Admin service, which
  reads `X-Is-Admin`.

## Implementation (2026-10-01)

- `deploy/charts/envoy-gateway`: Envoy Gateway v1.9.2 (Gateway API v1.6.1),
  pinned and stored in the repo, plus GatewayClass `envoy`. One per cluster,
  namespace `envoy-gateway-system`.
- `deploy/charts/foc-gateway`: one per environment:
  - `EnvoyProxy`: the proxy's Service is `envoy-<namespace>`, type
    `LoadBalancer`. Locally k3s ServiceLB fulfils it; on EKS the AWS Load
    Balancer Controller creates the NLB.
  - `Gateway` `foc`: an HTTP listener on 80.
  - `ClientTrafficPolicy`: `earlyRequestHeaders.remove` strips `x-user-id` and
    `x-is-admin` from every request before anything else runs.
  - `HTTPRoute` `foc-protected`: a path prefix per service. `SecurityPolicy`
    `foc-auth` uses `extAuth` with
    `pathOverride: /api/v1/user/authorize`. (`path` would *append* the
    request path.) It sends only the `authorization` header and forwards
    `x-user-id` / `x-is-admin` from the auth response. It fails closed.
  - `HTTPRoute` `foc-public`: exact paths and methods for signup, login,
    email verification, password reset, and `GET /api/v1/supplier`. Exact
    matches take precedence over the protected prefixes.
  - `/api/v1/user/authorize` from outside: answered with 404 by an
    `HTTPRouteFilter` `directResponse`, never forwarded.
- The namespace NetworkPolicy allows `envoy-gateway-system` in.
- Until the real User service exists, the connectivity stub (running as
  `user`) implements `/authorize`: `Bearer stub:<name>@u.nus.edu` gives 200 +
  identity headers (`admin*` names → `x-is-admin: true`); anything else gives
  401.
- `helm test gateway` (in `deploy/local.sh check`): 22 checks covering routing
  to all 7 services, 401 without or with a bad token, the admin flag,
  identity-header spoofing on protected and public routes, public routes,
  and blocked and unknown paths. All pass locally.
- **Still owed by the User service:** the contract change above (identity
  **headers**, `200`/`401`, short or no caching).
