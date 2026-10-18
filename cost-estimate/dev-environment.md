# Dev environment cost estimate (calculator.aws)

**Status:** built (A, C, M)

The inputs behind the AWS Pricing Calculator estimates for the dev environment
and its alternatives. Region `ap-southeast-1` (Singapore) throughout. Earlier
hand-calculated estimate: [`infra/docs/dev-cost-estimate.md`](../infra/docs/dev-cost-estimate.md).

## Decisions

- **2026-10-18:** dev is **torn down when idle** and brought up on demand
  (scenario M, ≈ $39/month at 40 h/week; ≈ $161/month if left running).
- **2026-10-18:** dev runs the minimal profile: **1 × t4g.large Spot** node
  (Kafka limit 1 Gi, minimal self-hosted Argo CD), **fck-nat** instead of NAT
  Gateway, no CloudWatch log shipping. Built as estimate M. Prod stays on
  private subnets with NAT Gateway and on-demand nodes.

## Sources

- `infra/README.md` (target architecture: non-prod EKS, Strimzi Kafka, Argo CD), `infra/local/aws/*.tf` (shapes: RDS db.t4g.micro, 20 GB)
- `deploy/values/envs/dev/{namespace,kafka}.yaml` (dev quota 2 vCPU / 5 Gi requests; Kafka 1 broker, 2 Gi volume)
- `deploy/charts/foc-gateway/templates/gateway.yaml` (Envoy as a LoadBalancer Service, i.e. one NLB)
- `deploy/argocd/nonprod.yaml` (≈12 Argo CD Applications for dev)
- Branch `don` at `f986dd9`, 2026-10-18

## Plan

Five scenarios planned; **A and C confirmed for building** (2026-10-18). B, D and E stay
here as planned alternatives, not built. All priced 24/7 (730 h).

### A. EKS as designed

| Service | Sizing/config | Key assumption |
|---|---|---|
| Amazon EKS | 1 cluster, standard support | extended support switched off in Terraform (it is on by default) |
| Amazon EC2 | 2 × t4g.large, On-Demand, Linux, 21 GB gp3 each | ≈ 6.3 GiB of pods + headroom; 20 GB root + Kafka's 2 GB volume split across nodes |
| NAT Gateway | 1 Regional NAT Gateway active in 1 AZ, 20 GB/month processed | image pulls and package updates only; modelled as Regional because the calculator rejects zeroing the Regional fields (see Result) |
| Network Load Balancer | 1, ~7 GB/month processed | dev traffic is tiny |
| Public IPv4 | 3 in-use (NAT + 2 NLB) | nodes in private subnets |
| RDS for PostgreSQL | db.t4g.micro, Single-AZ, 20 GB gp3, no Proxy, no Database Insights, no extended support | one instance, a database per service (ADR-0010) |
| ECR | 5 GB | images for 4 services + stub, with a lifecycle policy |
| CloudFront | 1 × Free flat-rate plan | frontend SPA; plan includes Route 53 DNS, WAF and S3 credits |
| S3 Standard | 1 GB | frontend build + order photos; covered by the plan's S3 credits |
| CloudWatch | 3 GB standard logs ingested, 1-month retention | container logs shipped |

### B. EKS lean

A with three swaps: nodes on **Spot**; **fck-nat** (1 × t4g.nano EC2, 8 GB gp3) instead of NAT Gateway; **no CloudWatch logs**. Public IPv4: 3 (fck-nat + 2 NLB).

### C. A + managed Argo CD add-on

A with 1 Argo CD capability managing 12 Applications on the EKS entry; C − A is
the add-on's cost. Nodes stay at 2 × t4g.large: moving Argo CD off the nodes
frees ~1.3 GiB, which would leave one t4g.large at ~5 of ~7 GiB allocatable with
no headroom and no AZ spread, so it doesn't remove a node.

### D. Single-node k3s on EC2

| Service | Sizing/config | Key assumption |
|---|---|---|
| Amazon EC2 | 1 × t4g.xlarge (4 vCPU, 16 GiB), On-Demand, 40 GB gp3 | k3s, same Helm charts and self-hosted Argo CD; matches local Floci, which is k3s |
| Public IPv4 | 1 in-use | node in a public subnet: no NAT, no NLB; CloudFront origin is the instance |
| RDS, ECR, CloudFront, S3 | as A | |

### E. Lightsail

| Service | Sizing/config | Key assumption |
|---|---|---|
| Lightsail Virtual Servers | 1 × 16 GB bundle (4 vCPU, 320 GB, 6 TB transfer, public IPv4) | k3s as in D |
| Lightsail Managed Databases | 1 × 40 GB, no HA | PostgreSQL; replaces RDS |
| ECR, CloudFront, S3 | as A | images pulled over ECR's public endpoint |

### M. Minimal dev (chosen), torn down when idle

| Service | Sizing/config | Key assumption |
|---|---|---|
| Amazon EKS | 1 cluster, standard support | extended support off |
| Amazon EC2 (node) | 1 × t4g.large **Spot**, Linux, 22 GB gp3 | ≈ 5.3 GiB of pods after trimming Kafka to 1 Gi and Argo CD to its minimal components |
| Amazon EC2 (fck-nat) | 1 × t4g.nano On-Demand, 8 GB gp3 | replaces NAT Gateway |
| Network Load Balancer | 1, ~7 GB/month processed | as A |
| Public IPv4 | 3 in-use (fck-nat + 2 NLB) | node in a private subnet |
| RDS for PostgreSQL | as A | |
| ECR, S3, CloudFront | as A | |
| CloudWatch | none | logs read with `kubectl logs` |

Built at 24/7 (the ceiling if dev is left running). Teardown when idle is not
modelled in the calculator: EKS, NLB and IPv4 have no hours field and a
fractional count would misstate what runs. Part-time cost = (24/7 total ÷ 730)
× hours up + what persists between runs (see Result).

### Not priced: ECS on Fargate

Rejected without a calculator estimate: Strimzi, Helm and Argo CD don't apply,
so Kafka would need Amazon MSK (provisioned needs at least 2 brokers; MSK
Serverless has an hourly cluster fee plus per-partition fees), and the deploy
layer would be rewritten.

## Assumptions

| Input | Value used | Source |
|---|---|---|
| Uptime | 730 h/month (24/7) | confirmed (2026-10-18) |
| NAT data processed | 20 GB/month | confirmed (2026-10-18: low dev traffic) |
| NLB data processed | ~7 GB/month (0.01 GB/h) | confirmed (2026-10-18: low dev traffic) |
| CloudFront traffic | within Free plan allowances | confirmed (2026-10-18: low dev traffic) |
| CloudWatch logs | 3 GB/month | best-effort estimate — not asked (minor line) |
| ECR storage | 5 GB | best-effort estimate — not asked (minor line) |
| Argo CD Applications | 12 | derived from `deploy/argocd/nonprod.yaml` |
| M: hours up when torn down when idle | 40 h/week ≈ 173 h/month | best-effort estimate — proposed in the recommendation, actual hours not given |
| M: storage that persists between runs | ECR 5 GB, S3 1 GB, RDS snapshot ≈ 1–2 GB, Terraform state | best-effort estimate — not asked (minor line) |
| Node sizing | 2 × t4g.large (A, B, C), 1 × t4g.xlarge (D) | derived from pod memory, see `infra/docs/dev-cost-estimate.md` |

## Documentation checks

- **EKS cluster fee:** $0.10/h standard, $0.60/h extended; extended support is
  **on by default** and must be turned off to avoid it. Checked against aws.amazon.com/eks/pricing.
- **EKS Auto Mode:** not used, so its per-instance management fee doesn't apply.
- **EKS Capabilities (managed Argo CD):** base rate per capability-hour plus a
  rate per Argo CD Application-hour; runs on AWS-owned infrastructure, not the
  nodes. Rates are not in the page text; taken from the calculator.
- **CloudFront:** origin fetches from AWS origins (S3, EC2, ELB, VPC origins)
  are free. Flat-rate plans (Free $0, Pro $15) include WAF, DDoS protection,
  Route 53 DNS, CloudWatch Logs ingestion, a TLS certificate and S3 credits,
  with no overage charges.
- **NAT Gateway:** hourly charge plus per-GB processing, plus normal data
  transfer. Partial hours bill as full hours.
- **Lightsail:** bundle prices include a public IPv4 address and a data
  transfer allowance (in and out both count against it).
- **Not modeled by the calculator:** EBS CSI and other EKS add-ons (free), and
  inter-AZ traffic between the two nodes ($0.01/GB each way, cents at dev volume).

## Result

| Estimate | sharable_url | Validation |
|---|---|---|
| A. EKS as designed | https://calculator.aws/#/estimate?id=ee2652612224cf9c2b9435072b464feae8b82274 | `editable`, 0 failures across 10 services |
| C. A + managed Argo CD (12 Applications) | https://calculator.aws/#/estimate?id=c76370cceefa28021b2d220f9f3aea8e67f73000 | `editable`, 0 failures across 10 services |
| **M. Minimal dev (chosen), 24/7 ceiling** | https://calculator.aws/#/estimate?id=105bcf67c2fd6bbf6c4bbc937d0397686560efbe | `editable`, 0 failures across 9 services (2 EC2 entries on purpose: Spot node and fck-nat) |

**M torn down when idle** (hand calculation, Price List API rates):

| | /month |
|---|---|
| 24/7 ceiling (cross-check of the M link) | ≈ $160.82 |
| Rate while up (everything except persistent storage) | $0.2193/h |
| 173 h up (40 h/week) | ≈ $37.94 |
| Persistent between runs: ECR 5 GB, S3 1 GB, RDS snapshot ~2 GB | ≈ $0.71 |
| **Total at 40 h/week** | **≈ $38.66** |

Scale: every 10 h/week up adds ≈ $9.50/month.

The MCP tool saves configurations, not computed totals: the calculator prices
each estimate when the link is opened. The add-on's cost is C − A.
Hand-calculated cross-check for A from the Price List API (same inputs):
≈ $299/month (`infra/docs/dev-cost-estimate.md`, scenario A).

**Findings from the as-built check:**

- **NAT Gateway modelled as Regional, not zonal.** The first build was
  rejected: the calculator won't accept 0 for the Regional NAT fields, and
  leaving them unset defaults to 5 gateways × 3 AZs. Rebuilt with 1 Regional
  gateway active in 1 AZ (the calculator's verified config) and the zonal count
  at 0. AWS docs don't publish a separate per-AZ rate for Regional NAT; assumed
  equal to one zonal gateway ($0.059/h + $0.059/GB in Singapore). Re-check this
  line in the calculator view.
- **EC2 saved with `term: 3 Year`** inside the pricing strategy; it has no
  effect on On-Demand pricing (the term applies only to Savings Plans).
- **EC2 data transfer left blank**: internet egress goes through NAT (priced
  there) or CloudFront (free from AWS origins), and the first 100 GB/month out
  is free.
- **EKS entry prices the standard-support fee only.** If the Kubernetes version
  falls into extended support the cluster fee is 6× ($0.60/h); not modelled.
- **Managed Argo CD doesn't change node count**: C keeps 2 × t4g.large (see Plan).
- **M's Spot price comes from the calculator's own Spot figure**, which can
  differ from the live price used in the hand calculation ($0.0405/h on
  2026-10-17); Spot moves by the hour and by AZ.
- **M's teardown figure assumes the RDS instance is deleted with a final
  snapshot each time** (restored on the next start) and that ECR, S3 and the
  Terraform state live in a separate, long-lived state. Each EKS start-up bills
  partial hours as whole hours and takes ~15–20 minutes.
- **Re-checked against the plan:** service count 10 in each estimate, no
  duplicates, no `missing_required_fields` after the rebuild, region
  `ap-southeast-1` on every entry.

## History

| Date | Status | sharable_url | What changed |
|---|---|---|---|
| 2026-10-18 | built | M: https://calculator.aws/#/estimate?id=105bcf67c2fd6bbf6c4bbc937d0397686560efbe | built M (24/7 ceiling); teardown when idle at 40 h/week ≈ $38.66/month by hand |
| 2026-10-18 | built | — | decision: dev on the minimal profile (1 Spot t4g.large, fck-nat, no CloudWatch logs) |
| 2026-10-18 | built | A: https://calculator.aws/#/estimate?id=ee2652612224cf9c2b9435072b464feae8b82274 · C: https://calculator.aws/#/estimate?id=c76370cceefa28021b2d220f9f3aea8e67f73000 | built A and C; NAT modelled as 1 Regional gateway in 1 AZ |
| 2026-10-18 | confirmed | — | uptime 24/7 and low traffic confirmed; build A and C only |
| 2026-10-18 | draft | — | first draft from the repo and the earlier hand estimate |
