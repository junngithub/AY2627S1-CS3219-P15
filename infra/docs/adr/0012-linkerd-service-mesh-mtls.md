# ADR-0012: Linkerd secures service-to-service traffic with mTLS and per-service policy

- **Status:** Accepted (2026-10-18). Spiked locally the same day (results
  below); implementation record at the end.
- **Date:** 2026-10-18

## Context

[ADR-0007](0007-envoy-gateway-extauth.md) authenticates **external** traffic
once, at Envoy Gateway. Inside the cluster nothing is authenticated or
encrypted:

- Services call each other over plain HTTP by DNS name (`http://credit:3000`).
- Services trust the identity headers (`x-user-id`, `x-is-admin`,
  `x-permitted-action`) on any request that reaches them. Only the gateway
  strips client-supplied copies, so any pod in the namespace can call credit
  with any user ID.
- Internal endpoints are protected only by the gateway's blocked-path list. On
  2026-10-18 credit's `/reserve` and `/release` were found reachable through the
  gateway because they were missing from that list; one misconfiguration exposed
  an endpoint that moves money.
- The NetworkPolicy only isolates **namespaces**; every pod in `foc-<env>` can
  reach every other.
- One service (user) checks a static `X-Service-Token` on one internal endpoint;
  the rest check nothing.

Kafka is already authenticated and encrypted (SCRAM-SHA-512 + TLS + per-topic
ACLs, [ADR-0004](0004-kafka-scram-acls.md)). Postgres is outside the cluster;
order requires TLS to it (`sslmode=require`), and the other services' database
TLS settings should be aligned separately. The gap this ADR closes is **HTTP
between services**.

Login uses opaque session tokens, not JWTs: User issues a random 32-byte token,
stores only its SHA-256 hash (`AuthSession`) and resolves it on every request
through `/api/v1/user/internal/authorize`. This ADR does not change how users
are authenticated; it secures the hops after the gateway.

## Decision

### Mesh

- Use **Linkerd** (open-source **edge** releases, pinned per environment) as
  the service mesh for the app namespaces. Linkerd is Apache 2.0; since 2.15 the
  open-source project publishes only edge builds (stable builds come from Buoyant
  Enterprise for Linkerd, free for small teams). Edge builds may break between
  versions, so upgrades are deliberate, tested locally first.
- **Meshed:** every service in `foc-<env>` and the Envoy Gateway proxies
  (through the `EnvoyProxy` pod template), so gateway → service traffic is mTLS
  and policies can name the gateway's identity. Injection is set **per
  workload** by the charts (`foc-service`, `foc-gateway`), not on the namespace,
  so Kafka, the database setup Job and test pods stay unmeshed without opt-outs,
  and Argo CD never has to manage namespace annotations.
- **Not meshed:** Kafka (Strimzi brokers and operators). Kafka already has its
  own TLS, logins and ACLs; meshed clients reach it through plain TCP
  pass-through. Postgres is outside the cluster.
- The proxy runs as a **native sidecar** (Linkerd's default from 2.20), so
  migration Jobs ([ADR-0011](0011-migration-jobs.md)) finish normally.

### Identity

- **One ServiceAccount per service** (`foc-service` chart). Linkerd's workload
  identity is the ServiceAccount
  (`<sa>.<ns>.serviceaccount.identity.linkerd.cluster.local`); with the shared
  `default` account, policies cannot tell order from any other pod.
- **The gateway's ServiceAccount is named explicitly**, `envoy-<namespace>` in
  `envoy-gateway-system` (`EnvoyProxy.spec.provider.kubernetes.envoyServiceAccount`),
  instead of Envoy Gateway's generated `envoy-<ns>-<gateway>-<hash>`, so policies
  name a stable identity.

### Authorization

- Default inbound policy on every meshed service pod: **deny unless
  authenticated by the mesh** (`config.linkerd.io/default-inbound-policy:
  all-authenticated`). The gateway's proxies keep the cluster default, because
  their traffic arrives from the NLB, outside the mesh.
- Per service, a Linkerd `Server` on its port, with Gateway API `HTTPRoute`s
  attached and an `AuthorizationPolicy` per route listing the allowed callers
  (`MeshTLSAuthentication` by ServiceAccount):

  | Service | Allowed callers today | Planned (configured in values, not yet coded) |
  |---|---|---|
  | user | gateway (incl. `/internal/*`) | order (Telegram lookup), admin, badges |
  | credit | gateway; `/api/v1/credit/internal/*` and the legacy `/reserve`, `/release`: **order only** | — |
  | order | gateway | badges (metrics) |
  | supplier | gateway, order | — |
  | rating | gateway | order (ratings) |
  | admin | gateway | order (escalations) |
  | badges | gateway | — |

  **Rule:** a caller is added to a service's policy in the same change that adds
  the call. A new call failing with 403 means a policy is missing; access is
  never granted ahead of the code that needs it.

- Every `Server` gets an explicit **probe route** (`GET` on the health paths,
  Exact: `/health` and the database health path where there is one) authorized
  by a `NetworkAuthentication`, because Linkerd stops auto-authorizing kubelet
  probes once routes are attached.
- Policies are **per route only**. A policy on the whole `Server` is unioned
  with the route policies and silently widens them.
- **Mesh routes and ingress routes stay apart.** Linkerd's `HTTPRoute`s are
  parented only to a Linkerd `Server` and named `<svc>-mesh-*`; Envoy's are
  parented only to the Envoy `Gateway`. Never parent an ingress route to a
  `Service` (Linkerd would treat it as mesh routing) or a mesh route to the
  Gateway (Envoy would expose it).
- Internal endpoints live under `/api/v1/<svc>/internal/...`. The gateway blocks
  that prefix for every route (defence in depth), and the mesh policy restricts
  who may call it. With the mesh in place, service tokens are not required.

### Certificates

```text
trust anchor (root CA)        cert-manager, self-signed, ECDSA P-256
  └── identity issuer         cert-manager, 48 h, renewed 25 h before expiry
        └── workload certs    Linkerd identity, per pod, 24 h, renewed by the proxy
```

- **cert-manager** issues the trust anchor (a self-signed `ClusterIssuer`) and,
  through a CA `Issuer`, the `linkerd-identity-issuer` certificate in `linkerd`.
- **trust-manager** publishes the anchor's public certificate to Linkerd.
- Linkerd is installed from its Helm charts with `identity.externalCA: true` and
  `identity.issuer.scheme: kubernetes.io/tls`, reading the issuer from the
  cert-manager Secret. No private key is stored in Git.
- The same path runs locally (`deploy/local.sh`) and in the cloud (Argo CD).
- **Trust-anchor lifetime:** dev and local are rebuilt often
  ([dev teardown when idle](../../../cost-estimate/dev-environment.md)), so each
  cluster gets a fresh anchor. Prod uses a long-lived anchor and rotates it with
  a trust-manager bundle that carries the old and new roots during the switch.

### Install order

cert-manager → trust-manager → identity certificates → `linkerd-crds`
(`installGatewayAPI=false`) → `linkerd-control-plane` → app namespaces. Locally
this is the order of steps in `deploy/local.sh`; in the cloud, Argo CD sync
waves.

## Consequences

- **Gateway API is shared with Envoy Gateway.** Envoy Gateway v1.9.2 installs
  and owns the Gateway API v1.6.1 CRDs; Linkerd must not install them
  (`installGatewayAPI=false`). Linkerd's documented range for 2.20 is Gateway
  API 1.2.1–1.5.1, so **v1.6.1 is outside it**. The spike shows it working
  (routes accepted and enforced), but every Linkerd or Envoy Gateway upgrade
  must re-run the policy tests. Linkerd's controller also reads Envoy Gateway's
  HTTPRoutes and logs a harmless "ExtensionRef filter is not supported" warning,
  so a clean log proves nothing: the checks assert that every mesh route shows
  `Accepted=True` from `linkerd.io/policy-controller`.
- **Proxy resources must be set explicitly** (annotations or Helm values). Left
  to the namespace LimitRange default (500m CPU / 512 Mi limit), each proxy pushed
  the `foc` ResourceQuota over its `limits.cpu` and stalled every rolling update.
  Use small values (about 10m/200m CPU, 32/64 Mi) and raise the quota's CPU
  limit by about 0.2 per meshed pod.
- **Footprint** (measured locally): ~4–6 MiB and ~2–4m CPU per proxy, ~125 MiB
  for the control plane, plus cert-manager and trust-manager (~100 MiB). It fits
  the minimal dev node's headroom.
- **Services can trust identity headers again**, but only because policy
  guarantees the caller is the gateway or an allowed service. The headers are
  still unsigned; signed short-lived tokens (JWTs) between services remain a
  future option, not part of this decision.
- **`X-Service-Token` becomes optional.** User's existing token check can stay
  as a second layer; new internal endpoints don't need one.
- **Tests:** `deploy/local.sh check` gains mesh checks (mTLS on every edge, an
  unmeshed pod gets 403 on a protected route, a disallowed service gets 403 on an
  internal route, probes still pass). New test pods must wait a few seconds or
  retry: k3s's NetworkPolicy controller rejects a brand-new pod's connections
  until it has been added to the allow-list.
- **Operational:** pods must be restarted to pick up injection; a Linkerd
  control-plane outage stops new certificates from being issued (existing ones
  last up to 24 h).

## Alternatives considered

- **Service tokens only.** Cheap and already used by user, but static shared
  secrets: no encryption, no workload identity, manual rotation, and one token
  per caller → callee pair. Kept as a fallback, not the plan.
- **In-namespace NetworkPolicy allow-lists only.** Free and worth keeping as a
  layer, but Layer 4 only: it can't restrict paths, can't distinguish the
  gateway's `/me/balance` call from an internal one, and doesn't encrypt.
- **Istio.** More features (L7 policy, ambient mode) but heavier and more
  operational surface than this project needs. Linkerd's per-pod cost was
  measured at a few MiB.
- **ECS Service Connect with mTLS.** Only on ECS; we run EKS
  ([ADR-0002](0002-terraform-aws-argocd-cluster.md)).
- **Linkerd's CLI-generated certificates.** Static, one-year, rotated by hand;
  fine for the spike only. Helm installs require supplied certificates anyway.
- **Root key kept offline, issuer in cert-manager.** The textbook prod setup;
  more process than this project needs. Revisit if prod outlives the course.

## Spike results (2026-10-18, local k3s v1.34, Linkerd edge-26.10.1)

- `linkerd check --pre` and `linkerd check` passed with Envoy Gateway's
  Gateway API v1.6.1 CRDs in place (`installGatewayAPI=false`).
- Meshed user, credit, order, supplier and the Envoy proxy. Proxy metrics showed
  `tls="true"` with workload identities on gateway → user/credit/order and
  order → credit/supplier. Kafka traffic passed through unmeshed.
- Full order flow through the gateway (create → accept → collect → deliver →
  acknowledge) passed with Kafka settlement, before and after policies.
- Policy: an unmeshed pod got **403** from credit; with per-route policy,
  credit `/release` restricted to the gateway's identity gave **403** to a meshed
  pod while `/health` and other routes kept working. Linkerd accepted both
  HTTPRoutes (`Accepted=True`) on Gateway API v1.6.1.
- Found during the spike: the quota stall, the probe 403s (credit went NotReady
  and restarted once until a probe route was added), the Server/route policy
  union, the shared `default` identity, and the k3s NetworkPolicy warm-up, all
  reflected in the decision above.

## References

- Linkerd: [Gateway API](https://linkerd.io/docs/features/gateway-api/),
  [native sidecars](https://linkerd.io/docs/features/native-sidecars/),
  [generating certificates](https://linkerd.io/2/tasks/generate-certificates/),
  [rotating control-plane credentials](https://linkerd.io/2/tasks/automatically-rotating-control-plane-tls-credentials),
  [hands-off certificate rotation](https://linkerd.io/2025/10/20/hands-off-linkerd-certificate-rotation/)
- Buoyant: [Gateway API versions](https://docs.buoyant.io/buoyant-enterprise-linkerd/latest/guides/managing-gateway-api),
  [trust anchor rotation with cert-manager](https://www.buoyant.io/blog/a-guide-to-linkerd-trust-anchor-rotation-with-cert-manager),
  [licensing](https://www.buoyant.io/articles/how-linkerd-licensing-actually-works-apache-2-0-edge-releases-and-what-bel-pays-for)

## Implementation (2026-10-18)

- **Platform charts** (vendored, pinned): `deploy/charts/cert-manager`
  (v1.21.2, CRDs on), `trust-manager` (v0.25.0), `linkerd-crds` (edge
  2026.10.1, `installGatewayAPI: false`), `linkerd` (control plane edge
  2026.10.1: `identity.externalCA`, `issuer.scheme: kubernetes.io/tls`, proxy
  10m/200m CPU, 32/64 Mi). Ours: `linkerd-identity` (self-signed
  `ClusterIssuer` → trust anchor, 10 y, key kept on renewal → CA
  `ClusterIssuer` → `linkerd-identity-issuer`, 48 h / renewed at 25 h, key
  rotated; trust-manager `Bundle` → `linkerd-identity-trust-roots`).
- **`foc-service`:** a ServiceAccount per service (token not mounted); pods
  annotated `linkerd.io/inject: enabled` and
  `config.linkerd.io/default-inbound-policy: all-authenticated`;
  `templates/mesh-policy.yaml` renders the `Server`, the probe route (health
  paths incl. `database.healthPath`), one route per `mesh.internal` prefix and
  the catch-all, each with its own policy, from the service's `mesh:` values.
  Migration Jobs keep the `default` account (they run as pre-install hooks,
  before the release's ServiceAccount exists) and aren't meshed.
- **Allow-lists** (`deploy/values/services/*.yaml`): credit `internal` (`/internal`,
  legacy `/reserve`, `/release`) → order; supplier → gateway, order; user
  `/internal` → gateway; everything else → gateway (chart default).
- **`foc-gateway`:** `EnvoyProxy` sets `envoyServiceAccount.name: envoy-<ns>`
  and injects the proxies.
- **Quotas:** `limits.cpu` local 8 → 10, dev/stg 4 → 6, prod 10 → 13.
- **`deploy/local.sh`:** `mesh_platform` installs the five charts after Envoy
  Gateway and before Kafka and the services, creating the `linkerd` namespace
  with Linkerd's labels; `check` adds `check_mesh`; `down` removes them.
- **Argo CD:** five Applications per cluster (`deploy/argocd/{nonprod,prod}.yaml`),
  retrying until their dependencies are ready; `linkerd-crds` sets the
  namespace's labels through `managedNamespaceMetadata`. `foc-platform` may
  deploy to `cert-manager` and `linkerd`.
- **Tests:** per service, a meshed and an unmeshed pod running as `default`
  get 200 on the health path and 403 elsewhere (`test-mesh.yaml`).

**Verified locally (2026-10-18):** `deploy/local.sh` and `deploy/local.sh
check` pass: 7/7 service pods meshed, 18/18 mesh routes `Accepted=True`, 14/14
mesh denial tests, gateway 30/30. Full order flow through the gateway passed
with Kafka settlement; credit and supplier saw `order.foc` and
`envoy-foc.envoy-gateway-system` over mTLS. `linkerd check` passes; its only
warning is the expected one about the issuer being valid for under 60 days.
Not yet run on EKS.
