# Dev environment: AWS cost estimate

> **Estimate as of 2026-10-18**, `ap-southeast-1`, on-demand list prices from
> the AWS Price List API (Spot from live price history on 2026-10-17). 730 h
> per month. Excludes tax. Re-check before committing: prices and Spot move.

**Bottom line:** running the full stack in dev 24/7 costs about **$300 a
month** as designed (**$0.41/h**), or about **$190 a month** with the
cost cuts below. Torn down when unused, it's **$0.26–0.41 per hour up**, so
a 40-hour week of use is roughly **$45–70 a month**. A new AWS account's
$200 of credits covers about **one month** of always-on dev.

## What's being priced

The planned non-prod setup (`infra/README.md`,
[ADR-0001](adr/0001-shared-nonprod-cluster.md)), with **only `foc-dev`**
deployed, plus the frontend on S3 + CloudFront
([readiness](frontend-s3-cloudfront.md)):

| Piece | Sized from |
|---|---|
| EKS cluster (`nonprod`) | one control plane; dev and stg are namespaces in it |
| Node group: **2 × t4g.large** (2 vCPU, 8 GiB) | see [sizing](#node-sizing) |
| Kafka (Strimzi, 1 broker) | `deploy/values/envs/dev/kafka.yaml`: 250m / 1 GiB, 2 GiB volume |
| Envoy gateway | one NLB, internet-facing (`foc-gateway/templates/gateway.yaml`) |
| Postgres | **one** RDS db.t4g.micro, a database per service ([ADR-0010](adr/0010-postgres-per-service-database.md)) |
| Network | VPC with private subnets for nodes, one NAT for egress |
| Frontend | S3 bucket + CloudFront (within the always-free tier) |
| Images | ECR, `foc/<svc>:<sha>` with a lifecycle policy |

### Node sizing

Expected memory use in dev (requests are lower; this is what pods actually
hold):

| Workload | ≈ memory |
|---|---|
| 7 services (order on the JVM ≈ 600 MiB, the rest Node ≈ 150 MiB each) | 1.5 GiB |
| Kafka broker (limit 1.5 GiB) + entity operator + Strimzi operator | 2.3 GiB |
| Argo CD (controller, repo-server, server, redis, applicationset) | 1.3 GiB |
| Envoy Gateway controller + proxy, AWS Load Balancer Controller | 0.6 GiB |
| Per-node system pods (VPC CNI, kube-proxy, EBS CSI, CoreDNS) | 0.6 GiB |
| **Total** | **≈ 6.3 GiB** |

One t4g.large leaves ≈ 7 GiB allocatable, too tight with Kafka and the
JVM. **Two** give headroom and spread across two AZs. Adding stg later fits
on the same two nodes only barely; budget a **third node (+$62/month)** for it.

## Scenario A: as designed, always on — ≈ $299/month

| Item | Unit price | /month |
|---|---|---|
| EKS control plane | $0.10/h | $73.00 |
| 2 × t4g.large, on-demand | $0.0848/h each | $123.81 |
| EBS gp3: 2 × 20 GB node roots + 2 GB Kafka | $0.096/GB-mo | $4.03 |
| NAT Gateway (1 AZ) + ~20 GB processed (image pulls, updates) | $0.059/h + $0.059/GB | $44.25 |
| NAT Gateway Elastic IP | $0.005/h | $3.65 |
| NLB for the gateway + ~0.1 NLCU | $0.0252/h + $0.006/NLCU-h | $18.83 |
| NLB public IPv4, 2 AZs | $0.005/h each | $7.30 |
| RDS PostgreSQL db.t4g.micro, Single-AZ + 20 GB gp3 | $0.025/h + $0.138/GB-mo | $21.01 |
| ECR, ~5 GB of images | $0.10/GB-mo | $0.50 |
| S3 + CloudFront (frontend, order photos) | inside CloudFront's free 1 TB / 10M requests | ≈ $0.25 |
| Route 53 hosted zone (optional) | $0.50/zone | $0.50 |
| CloudWatch Logs, ~3 GB | $0.70/GB in + $0.03/GB-mo | $2.19 |
| **Total** | | **≈ $299 ($0.41/h)** |

Fixed costs dominate: EKS, NAT and the NLB are **$147 a month before any
node runs**.

## Scenario B: lean, always on — ≈ $192/month

Same architecture, three swaps:

| Change | Saves/month | Trade-off |
|---|---|---|
| Nodes on **Spot** (t4g.large ≈ $0.0405/h, ~52% off) | ≈ $65 | a node can be reclaimed with 2 min notice; Kafka (1 broker) and pods restart. Fine for dev |
| **fck-nat** on a t4g.nano instead of NAT Gateway | ≈ $40 | one more instance to look after; no HA |
| Ship no container logs to CloudWatch (use `kubectl logs`) | ≈ $2 | no log history after a pod restarts |

| Item | /month |
|---|---|
| EKS control plane | $73.00 |
| 2 × t4g.large Spot | $59.13 |
| EBS gp3 | $4.03 |
| fck-nat t4g.nano + its public IPv4 + 8 GB root | $8.29 |
| NLB + 2 public IPv4 | $26.13 |
| RDS db.t4g.micro + 20 GB | $21.01 |
| ECR + S3/CloudFront | $0.75 |
| **Total** | **≈ $192 ($0.26/h)** |

## Scenario C: up only when used

The EKS control plane, NAT and NLB bill **every hour they exist**, so scaling
nodes to zero overnight saves little (≈ $110 of $299). Destroying the
environment and recreating it with `terraform apply` + Argo CD sync is what
cuts cost: you pay per hour it's up.

| Use | Scenario A ($0.41/h) | Scenario B ($0.26/h) |
|---|---|---|
| Demo day only (~10 h) | ≈ $4 | ≈ $3 |
| 40 h/week (~173 h/month) | ≈ $71 | ≈ $46 |
| Office hours, weekdays (~260 h/month) | ≈ $107 | ≈ $69 |

Plus ≈ $3/month that stays between runs (ECR images, S3, Terraform state,
Route 53). Expect **15–20 minutes** to bring EKS up, and note RDS data is lost
unless you keep a final snapshot (≈ $0.095/GB-mo beyond the free amount).

## Not included

- **stg**: same cluster; a third node (+$62) plus its own RDS database
  (free, same instance) or instance (+$21).
- **TLS for CloudFront → gateway**: ACM certs are free. A CloudFront VPC origin
  would make the NLB internal and drop its two public IPs (−$7.30); check the
  current VPC-origin pricing first.
- **SES** for OTP emails: $0.10 per 1,000, so effectively $0.
- **Secrets Manager**: not used (Kubernetes Secrets); $0.40/secret-month if adopted.
- **Data transfer out**: the first 100 GB/month to the internet is free, and
  CloudFront has its own free 1 TB. Inter-AZ traffic (Kafka, service calls
  across two nodes) is $0.01/GB each way: cents at dev volume.
- **EKS extended support**: if the cluster's Kubernetes version falls out of
  standard support, the control plane goes from $0.10 to **$0.60/h**
  ($438/month). Upgrade on schedule.

## Things that change the number

- **t4g is ARM.** Every image must be built for `linux/arm64` (or multi-arch)
  in CI. Strimzi, Kafka, Envoy and Argo CD already publish arm64 images. On
  x86 instead, **t3.large is $0.1056/h**: +$30/month on-demand.
- **Credits.** Accounts opened since 2025-07-15 get $100 + up to $100 in
  credits. On the **Free plan**, only small instance types (t3/t4g micro and
  small, a few flex types) are marked free-tier eligible; upgrade to the
  **Paid plan** before using t4g.large (credits still apply). At $192–299 a
  month, the credits last about one month always-on, or several months with
  scenario C. AWS Academy Learner Lab accounts (~$100) usually restrict EKS
  and instance sizes.
- **Savings Plans** (up to 66–72% off EC2) need a 1-year commitment; not
  worth it for a semester.
- **Budget alarm.** Set an AWS Budget at, say, $50 and $150 before the
  first `apply`; a forgotten always-on cluster is the main risk.

## Price sources

All from the AWS Price List API bulk files for `ap-southeast-1`
(`pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<service>/current/ap-southeast-1/index.json`)
and `aws pricing get-products`, cross-checked against the service pricing
pages on aws.amazon.com (EKS, EC2, EBS, VPC, ELB, RDS, ECR, S3, CloudFront,
CloudWatch, Route 53, SES). Spot from `aws ec2 describe-spot-price-history`
(2026-10-17). Free-tier terms from aws.amazon.com/free and the AWS Billing
docs.
