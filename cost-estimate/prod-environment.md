# Prod environment cost estimate (calculator.aws)

**Status:** built

Prod sized for the load-test requirement: the task pool and status transitions
stay correct and responsive for a ~60,000-user platform, modelled as 9,600
concurrent users. Region `ap-southeast-1` (Singapore). Dev estimate:
[`dev-environment.md`](dev-environment.md).

## Sources

- Requirement (2026-10-18): 60,000 users; daily users = 20%; concurrent = 40% of
  daily; load test = 2× concurrent → 9,600 concurrent users
- `frontend/src/lib/useLiveOrder.ts:20` (order page polls every 10 s; nothing else polls)
- `deploy/values/envs/prod/{kafka,namespace}.yaml` (3 brokers, RF 3,
  min.insync 2; broker 500m–2 CPU, 2–3 Gi, 20 Gi volume)
- `infra/README.md` (prod: dedicated EKS cluster)
- Branch `don`, 2026-10-18

## Workload model

| Quantity | Value | Derivation |
|---|---|---|
| Daily users | 12,000 | 60,000 × 20% |
| Concurrent users, normal peak | 4,800 | 12,000 × 40% |
| Concurrent users, load test | 9,600 | 4,800 × 2 |
| Requests per concurrent user | ~0.1 req/s | order page polls every 10 s; browsing ≈ 1 action / 10–15 s × ~1.5 API calls |
| API rate, load test | ~960 req/s avg, ~1,500 req/s peak | 9,600 × 0.1, × 1.5 burst |
| API rate, normal peak | ~480 req/s avg, ~750 req/s peak | 4,800 × 0.1, × 1.5 |
| Authorize calls | 1 per API call | Envoy extAuth → user-service → session lookup |
| Database queries, load-test peak | ~3,000–4,500 /s | ~3 queries per API call incl. the session lookup |
| CloudFront requests, normal month | ~50 M | 12,000 daily users × ~140 requests per visit × 30 |

## Plan

Confirmed 2026-10-18: autoscale for the load test, On-Demand, **cost-reduced availability** (1 NAT Gateway, single-AZ RDS).

### P. Prod, sized for normal peak, autoscaling to the load test

| Service | Sizing/config | Key assumption |
|---|---|---|
| Amazon EKS | 1 dedicated cluster, standard support | extended support off |
| Amazon EC2 (baseline) | 4 × c7g.xlarge (4 vCPU, 8 GiB), 30 GB gp3 each, across 3 AZs | normal peak ≈ 15 vCPU / 20 GiB of pods (incl. 3 Kafka brokers, platform) at ~70% target utilisation |
| Amazon EC2 (load-test burst) | +4 × c7g.xlarge, ~10 h/month | cluster autoscaler adds nodes as HPA scales user, order and Envoy; priced per hour of testing |
| EBS (Kafka) | 3 × 20 GB gp3 | from prod Kafka values; folded into the baseline nodes' disks (30 GB root + 15 GB each) |
| NAT Gateway | **1**, ~200 GB/month processed | cost-reduced: an outage in its AZ cuts outbound access for every node |
| Network Load Balancer | 1, ~0.3 GB/h averaged over the month | ~50 M requests × ~4 KB; load-test hours add ~14 GB/h while running |
| Public IPv4 | 4 in-use (1 NAT + 3 NLB) | nodes in private subnets |
| RDS for PostgreSQL | db.m7g.large, **Single-AZ**, 100 GB gp3 | ~3,000–4,500 simple indexed queries/s at load-test peak; a database per service |
| ECR | 10 GB | |
| S3 Standard | 150 GB | order photos ~120 GB/month growth (2,000 orders/day × 2 photos × 1 MB) |
| CloudFront | pay-as-you-go, ~50 M requests, ~250 GB to Asia | always-free 1 TB / 10 M requests applies |
| AWS WAF | 1 web ACL, ~5 rules, ~50 M requests | rate limiting on login, signup and OTP |
| CloudWatch | 50 GB logs/month, 1-month retention | |
| Route 53 | 1 hosted zone | |
| SES | ~10,000 emails/month | OTPs and password resets |

## Assumptions

| Input | Value used | Source |
|---|---|---|
| Users, daily %, concurrent %, load-test multiplier | 60,000; 20%; 40%; 2× | confirmed (requirement) |
| Requests per concurrent user | ~0.1 req/s | confirmed (2026-10-18) |
| Scaling strategy | baseline for normal peak, autoscale for the load test | confirmed (2026-10-18) |
| Load-test hours per month | 10 h | best-effort estimate — not asked (each extra hour adds the burst nodes' hourly rate) |
| Pricing model | On-Demand | confirmed (2026-10-18) |
| Availability | nodes across 3 AZs; 1 NAT Gateway; RDS Single-AZ | confirmed (2026-10-18: cost-reduced) |
| Throughput per vCPU | Node services ~400 req/s, Spring ~300 req/s, Envoy ~1,000 req/s | best-effort estimate — not asked (to be replaced by the load test's own results) |
| Bytes per API request + response | ~4 KB | best-effort estimate — not asked |
| Photos | 2,000 orders/day × 2 × 1 MB | best-effort estimate — not asked |

## Documentation checks

- **CloudFront flat-rate allowances** (Developer Guide, checked 2026-10-18):
  Free 1 M requests / 100 GB, Pro 10 M / 50 TB, Business 125 M / 50 TB ($200),
  Premium 500 M / 50 TB ($1,000). No overage charges, but sustained use above
  the allowance can lead to degraded delivery. At ~50 M requests/month, Pro is
  5× over; Business fits. Pay-as-you-go plus WAF is compared against Business.
- **Custom cache and origin-request policies need Business or above** on
  flat-rate plans; AWS-managed policies (CachingDisabled,
  AllViewerExceptHostHeader) are available on every tier, so the `/api/*`
  behaviour works on any plan.
- **RDS Multi-AZ** doubles the instance cost (calculator catalog).
- **EKS extended support** would raise the cluster fee from $0.10/h to $0.60/h;
  on by default.

## Result

| Estimate | sharable_url | Validation |
|---|---|---|
| P. Prod, 9,600-user load test, autoscale, cost-reduced HA | https://calculator.aws/#/estimate?id=39fa96d85991f4ceb6757e7b2729723ad9e64a28 | `editable`, 0 failures across 14 entries; burst nodes saved with utilization 1.4% (≈10 h) |

**Hand cross-check** (Price List API, Singapore, 2026-10-18; c7g.xlarge $0.1666/h, db.m7g.large Single-AZ $0.234/h):

| Line | /month |
|---|---|
| EKS | $73.00 |
| 4 × c7g.xlarge baseline + 4 × 45 GB gp3 | $503.75 |
| 4 × c7g.xlarge burst, 10 h | $6.82 |
| NAT Gateway + 200 GB | $54.87 |
| NLB + 4 public IPv4 | $34.31 |
| RDS db.m7g.large Single-AZ + 100 GB | $184.62 |
| CloudFront pay-as-you-go (40 M billable requests; data inside the free 1 TB) | $48.00 |
| WAF (1 ACL, 6 rules, 50 M requests) | $41.00 |
| CloudWatch Logs 50 GB | $36.50 |
| ECR, S3, Route 53, SES | $8.25 |
| **Total** | **≈ $991** |

| Variant | /month |
|---|---|
| Always sized for 9,600 (8 nodes 24/7) | ≈ $1,482 |
| CloudFront Business flat-rate plan instead of pay-as-you-go + WAF | ≈ $1,102 |
| Each extra load-test hour | ≈ $0.67 nodes + ≈ $6.20 CloudFront/WAF requests |

**Findings from the as-built check:**

- **The load test's own requests are not in the estimate.** ~960 req/s × 10 h ≈
  35 M extra requests through CloudFront and WAF ≈ **$62 per 10-hour test**
  ($0.012 per 10k HTTPS + $0.60 per M WAF). Testing straight against the NLB
  avoids it but skips the real path.
- **The load generator is not included** (e.g. k6 workers on EC2 or a SaaS).
- **The calculator may not apply CloudFront's always-free 1 TB / 10 M
  requests**; if its CloudFront line is ~$60 + data, that's why.
- **Single NAT Gateway:** nodes in the other two AZs send egress across AZs
  ($0.01/GB each way, ≈ $3/month at 200 GB); not modelled.
- **Database headroom is the main risk.** ~3,000–4,500 queries/s on 2 vCPU is
  plausible for indexed lookups but tight; the per-request session lookup in
  `/authorize` is the largest share. Caching authorize results briefly (in
  user-service or Envoy) would roughly halve database load. No RDS Proxy:
  ~15 pods × ~10 connections stays under db.m7g.large's connection limit.
- **Node counts are ±50%** until the load test measures real throughput per vCPU.
- **EC2 saved with `term: 3 Year`**: no effect on On-Demand.

## History

| Date | Status | sharable_url | What changed |
|---|---|---|---|
| 2026-10-18 | built | https://calculator.aws/#/estimate?id=39fa96d85991f4ceb6757e7b2729723ad9e64a28 | built P; hand cross-check ≈ $991/month |
| 2026-10-18 | confirmed | — | 0.1 req/s, autoscale, On-Demand, cost-reduced availability |
| 2026-10-18 | draft | — | first draft from the load-test requirement |
