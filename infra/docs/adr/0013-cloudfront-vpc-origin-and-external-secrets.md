# ADR-0013: CloudFront reaches the gateway through a VPC origin; Secrets Manager feeds the cluster through External Secrets

- **Status:** Accepted (2026-10-21). Amended 2026-10-22: pods use the node
  role, because NUS's service control policy blocks per-pod roles (see "Pods
  get AWS access through the node role"). `infra/nonprod/aws` partly applied
  2026-10-22.
- **Date:** 2026-10-21

## Context

Dev is the first cloud env ([ADR-0009](0009-no-argocd-locally.md)). Building
it needs three decisions that the earlier ADRs left open.

1. **How the browser reaches the API.** The frontend calls relative
   `/api/v1/...` paths (`frontend/src/lib/api.ts`), so the page and the API
   must share an origin ([`frontend-s3-cloudfront.md`](../frontend-s3-cloudfront.md)).
   CloudFront serves the page from S3. `/api/*` has to reach Envoy Gateway
   ([ADR-0007](0007-envoy-gateway-extauth.md)), which listens on plain HTTP :80
   with no hostname.
2. **Who owns the load balancer.** On EKS, the AWS Load Balancer Controller
   would normally create an NLB from Envoy's `LoadBalancer` Service. Its name
   and ARN would then only exist after Argo CD has synced, but CloudFront's
   Terraform needs them.
3. **How cloud Secrets are created.** Locally, Helm generates them
   (`generatedSecrets`, `foc-database createSecrets: true`). Neither works under
   Argo CD, which renders charts without access to the cluster.
   [ADR-0010](0010-postgres-per-service-database.md) chose Secrets Manager plus
   External Secrets but didn't design the shape.

## Decision

### The API is reached through an internal NLB, behind a CloudFront VPC origin

- **Terraform** (`infra/nonprod/aws/gateway-lb.tf`) creates one **internal**
  NLB, plus its target group (IP targets, port 10080), for each env.
  - The NLB's security group admits only the CloudFront origin-facing prefix
    list.
  - The NLB is the origin of the distribution's `/api/*` behaviour, through a
    **CloudFront VPC origin** (`frontend.tf`).
- **TLS** ends at CloudFront. Dev has no custom domain, so it uses CloudFront's
  `*.cloudfront.net` name and certificate (a custom domain later is an ACM
  certificate plus a DNS record). CloudFront → NLB → Envoy is HTTP, carried on AWS's network
  into the private subnets.
  - Nothing is reachable from the internet except CloudFront.
  - No certificate is needed on the NLB, and no CORS.
- **In the cluster**, Envoy's Service is `ClusterIP` (`values/envs/dev/gateway.yaml`).
  - A **TargetGroupBinding** (`deploy/charts/cluster-config`) has the AWS Load
    Balancer Controller register Envoy's pod IPs in Terraform's target group.
  - The controller's IAM role can only register and deregister targets in
    those target groups. It cannot create load balancers.
- **Single page app fallback:** a CloudFront Function on the S3 behaviour only
  rewrites paths without a dot to `/index.html`. Distribution-wide error pages
  would turn API 404s into HTML 200s.

### Secrets Manager holds every cloud Secret; External Secrets copies it in

- **Naming:** Secrets Manager secret `foc/<env>/<Secret name>` holds that
  Kubernetes Secret's keys as JSON (`infra/nonprod/aws/secrets.tf`, values from
  `random_password`).
  - The local and cloud Secrets have the same names and keys, so service values
    don't change between envs.
- **Service Secrets:** `foc-service`'s `externalSecrets` value has the same
  shape as `generatedSecrets` (`{ user-otp: [OTP_SECRET] }`). It is listed
  under the one service that owns the Secret.
- **Database Secrets:** `foc-database` with `createSecrets: false` renders
  ExternalSecrets for each `<service>-db` and for `foc-db-admin`.
  - `foc-db-admin` comes from the RDS-managed master secret, templated with the
    host.
- **Per-env isolation:** each env has a **ClusterSecretStore** usable only
  from its namespace, reading `foc/<env>/*`. The design was for each store to
  assume an env role that can read nothing else, so dev couldn't read stg's
  secrets ([ADR-0001](0001-shared-nonprod-cluster.md)). NUS denies
  `sts:AssumeRole`, so today the stores use the node role, which can read every
  env's secrets. The store conditions still stop a dev ExternalSecret from
  naming stg's store, but nothing in IAM stops it. Only dev exists, so this
  doesn't matter yet.

### Pods get AWS access through the node role

The plan was EKS Pod Identity: one IAM role per ServiceAccount. The first apply
(2026-10-22) showed that the NUS AWS organization's service control policy
explicitly denies every way for a pod to get its own role. IAM's policy
simulator, which includes organization policies, confirms each one:

| Mechanism | Action | Result |
|---|---|---|
| EKS Pod Identity | `eks-auth:AssumeRoleForPodIdentity` (called by the node role) | explicit deny |
| IRSA | `sts:AssumeRoleWithWebIdentity` | explicit deny |
| Role chaining (External Secrets → env role) | `sts:AssumeRole` | explicit deny |
| What the roles do (S3, SES, Secrets Manager, EC2, ELB) | e.g. `s3:PutObject` | allowed |

The EC2 node role works, because EC2 itself assumes it. So
`infra/nonprod/aws/node-permissions.tf` grants the node role the union of what
the pods need, with each statement still scoped to its resources:

- user → `ses:SendEmail` on the sender identity
- order → `s3:PutObject` / `s3:DeleteObject` on the photos bucket
- External Secrets → `secretsmanager:GetSecretValue` on `foc/<env>/*` and the
  RDS admin secret
- the Load Balancer Controller → register and deregister targets in the
  gateway target groups, plus EC2 and ELB `Describe*`
- the EBS CSI driver → `AmazonEBSCSIDriverPolicy`

Pods reach these credentials through the instance metadata service. The node
group's launch template sets IMDSv2 with a hop limit of 2; the managed node
group default of 1 stops at the node. The apps still use the AWS SDK's
default credential chain, so there are no keys in env vars, and no code
changes either way.

**Cost of this:** every pod on a node has every permission above. For
example, a compromised badges pod could send email as the app or read dev's
database passwords. Acceptable for a course dev env with one node and no real
user data. Not acceptable for prod.

**Reverting to per-pod roles** (if NUS lifts the denies, or for an account
without them):
1. In `node-permissions.tf`, move each statement into its own role with a
   `pods.eks.amazonaws.com` trust policy and an
   `aws_eks_pod_identity_association` (namespace + ServiceAccount).
2. Add the `eks-pod-identity-agent` add-on back in `eks.tf`.
3. Give the EBS CSI add-on a `pod_identity_association`.
4. Set `secretsRoleArn` per env in `values/clusters/<cluster>/cluster-config.yaml`
   to restore per-env secret isolation.

Nothing in the charts or the apps changes.

The same deny on `sts:AssumeRoleWithWebIdentity` means **GitHub Actions can't
use OIDC** (`infra/global/github-oidc`), and `iam:CreateUser` is denied, so it
can't use access keys either. Deploys run from a laptop with the team's SSO
login instead ([`cloud-dev.md`](../cloud-dev.md)).

## Consequences

- **One `terraform apply`** creates every AWS resource CloudFront needs. The
  values Argo CD needs (target group ARN, role ARNs, RDS host) are copied into
  git once by `deploy/cloud-values.sh`. None of them are secret.
- **Envoy's port is fixed by Envoy Gateway.** For listeners below 1024 it is the
  listener port + 10000, so the target group uses 10080. If Envoy Gateway ever
  changes that, the targets go unhealthy (`var.gateway_target_port`).
- **CloudFront's prefix list costs security group rules.** It weighs about 55
  rules, close to the default limit of 60, so the NLB's security group holds
  nothing else.
- **New cluster add-ons:** the AWS Load Balancer Controller, External Secrets
  and `cluster-config` are new Argo CD apps. The `foc-platform` project now
  allows `kube-system` and `external-secrets`.
- **Envoy Service type:** the gateway chart keeps `LoadBalancer` by default for
  k3s, so local is unchanged.
- **Node trusts the RDS CA:** `foc-service`'s `databaseCa` mounts the RDS CA
  bundle (a ConfigMap from `cluster-config`) and sets `NODE_EXTRA_CA_CERTS`.
  node-postgres can then verify RDS without image changes. Prisma and JDBC
  encrypt with `sslmode=require` but don't verify the certificate.
- **stg stays commented out** in `deploy/argocd/nonprod.yaml` until
  `var.envs` includes it. Each env adds about $1 a month of secrets plus its
  own NLB, roughly $16 a month.

## Alternatives considered

- **Public NLB with an ACM certificate, CloudFront as an HTTPS custom origin.**
  This exposes an API endpoint that bypasses CloudFront, needs a second
  certificate and DNS name, and works only after the controller has created
  the NLB.
- **Controller-created NLB, looked up by tag in a second Terraform pass.** Two
  applies, plus a race on first bootstrap.
- **Kubernetes Secrets created by hand (`kubectl create secret`).** Not in git,
  lost on every rebuild, and differs between teammates.
- **Separate API domain (`api.<env>.<domain>`).** Needs CORS in the gateway,
  preflight requests that skip extAuth, and a frontend build per env.
