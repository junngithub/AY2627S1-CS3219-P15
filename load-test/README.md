# Load test

9600 virtual users call Order. The gateway identity headers are sent directly, so this does not go through the frontend or the gateway. Order makes the downstream calls.

Everyone is **dual-role** (same as the product): one seeded user per VU. Each iteration they **choose**:

| Choice | Probability | What they do |
| --- | --- | --- |
| Request | `REQUEST_PROBABILITY` (default **0.4**, alias `REQUESTER_SHARE`) | Requester reads + maybe create. Extra reads: `/requests/active`, `/alerts`, `/mine`, `/requests/past`. |
| Deliver | `1 −` that | With `COURIER_BROWSE_PROBABILITY` (default **0.2**) browse the open pool and maybe accept (409 on own/taken is OK), then collect + deliver PNGs. Otherwise idle think-time. List/search reads every 10th iteration. |

**Peak creates** are gated once per VU: with probability `REQUEST_PROBABILITY` that VU creates at all; among creators, `ORDER_COUNT_WEIGHTS` (default **50,25,15,7,3**) picks **1..5** orders (NUS-skewed: most place 1–2, thin tail to 5). Expected creates ≈ `0.4 × 9600 × 1.88` (~7.2k). Each planned create is due at a random time in the first `CREATE_SPREAD_SECONDS` of that VU’s life (default **240** on peak, **20** on soak). Failed closes stay in the VU’s open list and retry; create attempts stop after budget+3.

Downstream calls, as a share of that traffic:

| Service | When |
| --- | --- |
| User | Order looks up the Telegram handle on create and on accept. |
| Supplier | Order validates **pickup only** (`fromLocation`) on create. Search re-checks that pickup id. |
| Order DB | Dropoff is Order-owned: create sends `deliveryPointId` (seeded campus catalogue from Flyway `V6`). |
| Credit | Order reserves 1 credit on create. Acknowledge publishes `credit.reservation.release`. The credit consumer has to be running for that second call to land. |
| Admin | Escalate calls `POST /api/v1/admin/internal/conflicts`. About 1 in 20 closes. |
| Rating | Order reads `GET /api/v1/rating/{userId}` on create and accept. Deliver and acknowledge publish `rating.permission.granted` on `foc.rating.commands` for Rating Service to grant the modal. |
| MinIO / S3 | Collect and deliver store the PNG. |

**Full** uses `PROFILE=peak`: a ~15 minute VU ramp (0 → 25% → 50% → peak → 4m hold → 3m close-drain at half → 0), not a flat soak. After the busy window, VUs only poll/acknowledge so closes are not racing new creates/browses. **Smoke** stays `PROFILE=soak` (flat `DURATION`). Couriers **skip their own orders** in the pool (accepting those fails for real). **409 already taken** from another courier is expected contention and counts as success for fulfill thresholds. Defaults: Supplier pickup id `2` (approved), Order delivery-point id `1` (seeded `kent-ridge-mrt`).

## Setup, then load

Signup stays out of k6. Accounts are seeded into the User and Credit databases before the run.

1. Build the roster and SQL (writes `data/users.json`, `data/users.sql`, `data/credits.sql`).
2. Apply that SQL to User DB and Credit DB.
3. Point k6 at Order and run with the same `VUS` / `REQUESTER_SHARE`.

`roster.mjs` only builds the shared list of emails and Telegram handles. `seed-users.mjs` adds stable user ids, writes the files, and can apply them locally. k6 reads `data/users.json` for the `X-User-Id` values.

### Local Compose

Services already up. Seed into the local Postgres containers, then run k6:

```powershell
node load-test/setup/seed-users.mjs --apply
k6 run load-test/k6/load.js
```

Short smoke:

```powershell
$env:PROFILE='soak'; $env:VUS='30'; $env:DURATION='30s'
node load-test/setup/seed-users.mjs --apply
k6 run -e PROFILE=soak -e VUS=30 -e DURATION=30s load-test/k6/load.js
```

`--apply` uses Docker exec against `user-service-db-1` and `credit-postgres`. Override with `USER_DB_CONTAINER` / `CREDIT_DB_CONTAINER` if the names differ.

### EC2 or laptop against EKS

Generate the seed with `node load-test/setup/seed-users.mjs`, apply
`data/users.sql` / `data/credits.sql` with `psql`, then run k6 with
`-e ORDER_URL=...` against a port-forward (`kubectl -n foc-dev port-forward
svc/order 8083:8083`). Order's mesh policy refuses unmeshed callers, so a
plain port-forward from outside the mesh gets 403; use [Testing in EKS](#testing-in-eks) instead.

## Testing in EKS

The load test runs inside the dev cluster (`foc-nonprod`). This folder is also
a Helm chart: Argo CD app `load-test-dev` deploys it into namespace `foc-load`
as three **suspended CronJobs**. They never run on a schedule; you start each
one by hand, which creates a one-off Job.

| CronJob | What it does | Runs on |
| --- | --- | --- |
| `load-setup` | Seeds **60000** users into the User and Credit databases (campus roster). Re-run to reset credit balances. Full/smoke still run **9600** VUs (first N of the roster). | normal nodes |
| `load-run-smoke` | k6 soak, 30 VUs for 1 minute. Checks the whole path works. | normal nodes |
| `load-run-full` | k6 peak ramp, 9600 VUs over ~15 minutes. The real test. | the `loadgen` node: one 8 vCPU / 32 GiB Spot node, added for the run and removed shortly after |

k6 calls Order directly at `http://order.foc-dev.svc.cluster.local:8083` with
the gateway's identity headers, as mesh identity `foc-load/k6` (dev's Order
admits it). Every run streams to Prometheus, tagged `testid=<Job name>`.
Nothing is cleaned up: load users and orders stay in the dev databases.

### 1. One-time setup (AWS and kubectl)

1. **Install the AWS CLI v2 and kubectl** if you haven't. Check with
   `aws --version` (needs `aws-cli/2.x`) and `kubectl version --client`.

   | OS | AWS CLI v2 | kubectl |
   | --- | --- | --- |
   | macOS | `brew install awscli` | `brew install kubectl` |
   | Windows | `winget install Amazon.AWSCLI` | `winget install Kubernetes.kubectl` |
   | Linux | [AWS CLI install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) | [kubectl install guide](https://kubernetes.io/docs/tasks/tools/) |

   Terraform is only needed for the RDS resize in step 5. Use the version in
   `infra/.terraform-version`, e.g. `brew install tfenv`, then `cd infra &&
   tfenv install`.

2. **Get into the NUS AWS account.** Ask whoever owns the project to add you to
   account `474265880628`. Sign in once at
   <https://nus-aws-cloud.awsapps.com/start> to check you can see it.
3. **Create the AWS profile:**

   ```bash
   aws configure sso
   ```

   | Prompt | Answer |
   | --- | --- |
   | SSO session name | `nus-sso` |
   | SSO start URL | `https://nus-aws-cloud.awsapps.com/start` |
   | SSO region | `ap-southeast-1` |
   | SSO registration scopes | press Enter (`sso:account:access`) |
   | Account / role (browser opens) | `474265880628`, role `nusisb_IsbUsersPS` |
   | Default client region | `ap-southeast-1` |
   | Output format | press Enter |
   | Profile name | `cs3219-dev` |

4. **Point kubectl at the cluster:**

   ```bash
   unset KUBECONFIG     # don't merge EKS into the local Floci kubeconfig
   aws eks update-kubeconfig --name foc-nonprod --region ap-southeast-1 --profile cs3219-dev
   kubectl -n foc-load get cronjobs     # lists the three CronJobs
   ```

   Everyone signed in with role `nusisb_IsbUsersPS` gets cluster access. With a
   different role, kubectl says `Unauthorized`: the project owner adds your
   role's ARN to `cluster_admin_arns` in `infra/nonprod/aws`.

### 2. Every new terminal

```bash
export AWS_PROFILE=cs3219-dev
aws sso login            # when a command says the session or token expired
unset KUBECONFIG
kubectl config current-context    # …:cluster/foc-nonprod
```

### 3. Seed the users (once, or to reset balances)

Steps 3, 4 and 5 each start a Job from a CronJob, either from the terminal or
from the Argo CD UI. Both do the same thing. To open the UI, see
[step 6](#6-argo-cd-ui-start-and-watch-runs).

| Way | Start | Follow |
| --- | --- | --- |
| **Terminal** | `kubectl -n foc-load create job load-setup-$(date +%H%M) --from=cronjob/load-setup` | `kubectl -n foc-load logs -f job/load-setup-<HHMM> -c psql` |
| **Argo CD UI** | app `load-test-dev` → CronJob **`load-setup`** → **⋮** → **Create Job** | the new pod → **Logs** → container `psql` |

The log ends with `Seeded 60000 users`. Seeding takes longer than the old 9.6k
roster (a minute or two). Smoke and full runs reuse the same users, so seed
again only to reset credit balances. Each user starts with 5000 credits and
each order spends 1.

### 4. Smoke run

| Way | Start | Follow |
| --- | --- | --- |
| **Terminal** | `kubectl -n foc-load create job smoke-$(date +%H%M) --from=cronjob/load-run-smoke` | `kubectl -n foc-load logs -f job/smoke-<HHMM> -c k6` |
| **Argo CD UI** | app `load-test-dev` → CronJob **`load-run-smoke`** → **⋮** → **Create Job** | the new pod → **Logs** → container `k6` |

It takes about 1.5 minutes. The Job ends **Complete** if every threshold passed
(under 5% failed requests per operation) and **Failed** otherwise. Do this
before every full run; it costs nothing extra.

### 5. Full run

**Resize RDS first.** All seven services share one Postgres instance, normally
`db.t4g.micro`. That only allows about 80–90 connections, and during a full run
the services scale out (Order to 16 pods, User and Rating to 6, Credit and
Supplier to 4), each pod with its own connection pool. The pool connections
run out first, then the micro's burstable CPU credits, so requests fail
because of the database rather than the services. `db.m7g.xlarge` allows about
1,800 connections on 4 dedicated vCPUs (~$0.47/h).

```bash
terraform -chdir=infra/nonprod/aws init -backend-config="bucket=foc-tfstate-474265880628"   # once per machine
terraform -chdir=infra/nonprod/aws apply \
  -var state_bucket=foc-tfstate-474265880628 \
  -var ses_from_email=donleehh420@gmail.com \
  -var rds_instance_class=db.m7g.xlarge
```

The plan should show only `~ instance_class` on `aws_db_instance.foc`. The
resize takes about 10 minutes and the database is **unavailable for a few
minutes** in that time, so tell the team first. Wait until it reports
`available`:

```bash
aws rds describe-db-instances --db-instance-identifier foc-nonprod \
  --query 'DBInstances[0].[DBInstanceClass,DBInstanceStatus]' --output text
```

Then start the run:

| Way | Start | Follow |
| --- | --- | --- |
| **Terminal** | `kubectl -n foc-load create job full-$(date +%H%M) --from=cronjob/load-run-full` | `kubectl -n foc-load get pods -w` until Running, then `kubectl -n foc-load logs -f job/full-<HHMM> -c k6` |
| **Argo CD UI** | app `load-test-dev` → CronJob **`load-run-full`** → **⋮** → **Create Job** | the new pod (Pending, then Running) → **Logs** → container `k6` |

The pod stays Pending for 3–5 minutes while the loadgen node starts.

**Afterwards, scale RDS back** by running the same `apply` without
`-var rds_instance_class=…`. Leaving it on xlarge costs about $340 a month.

### 6. Argo CD UI (start and watch runs)

```bash
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d
kubectl -n argocd port-forward svc/argocd-server 8081:80
```

Open <http://localhost:8081> and log in as `admin`.

- **Start a run:** app `load-test-dev` → click a CronJob (`load-setup`,
  `load-run-smoke`, `load-run-full`) → **⋮** → **Create Job**. This does the
  same as the `kubectl create job` commands in steps 3–5.
- **Follow it:** the new Job and its pod appear under the CronJob. Click the
  pod → **Logs** and pick container `k6` (`seed` and `psql` for setup). A green
  heart means it passed; a broken heart means it failed.
- **The services' side:** apps `dev-order`, `dev-user`, `dev-credit` and so on
  show pods being added as the autoscalers react, and any restarts.

Argo CD doesn't own the Jobs you create, so it never deletes them. Kubernetes
removes each finished Job and its logs after 24 hours.

### 7. Results in Grafana

```bash
aws secretsmanager get-secret-value --secret-id foc/dev/grafana-admin --query SecretString --output text   # user: admin
kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3000:80
```

Open <http://localhost:3000> and log in as `admin`.

- **k6's view:** **Dashboards** → **k6 Prometheus (Native Histograms)**. Pick
  the run under **testid** (the Job name, e.g. `full-1430`) and set the time
  range to cover it, e.g. *Last 30 minutes*. It shows requests per second,
  latency per endpoint (`create`, `accept`, `get_order`, `collect`, …), failed
  requests and VUs.
- **Services' CPU and memory:** **Dashboards** → **Kubernetes / Compute
  Resources / Namespace (Pods)**, namespace `foc-dev`.
- **Per-service traffic** from the Linkerd proxies: **Explore**, data source
  Prometheus:

  ```promql
  sum by (app_kubernetes_io_name) (rate(response_total{namespace="foc-dev", direction="inbound"}[1m]))
  ```

- **Nodes:** **Kubernetes / Compute Resources / Node (Pods)** shows the
  `loadgen` and `burst` nodes.

Prometheus keeps results for 7 days; pausing dev (`deploy/eks-down.sh`) deletes
them. k6's end-of-run summary stays in the Job logs for 24 hours.

To change VUs, duration or k6's CPU and memory, edit `runs:` in `values.yaml`
and merge to `main`.

## Env

| Variable | Default | Used by |
| --- | --- | --- |
| `VUS` | `9600` | k6 peak / soak size (must be ≤ seeded roster) |
| `seedVus` | `60000` | Helm — User/Credit seed size (`load-setup` + run init) |
| `PROFILE` | `peak` | k6 — `peak` = ramping-vus (~15m); `soak` = flat `DURATION` |
| `REQUEST_PROBABILITY` | `0.4` | k6 — P(request this iteration) + P(VU creates this run); falls back to `REQUESTER_SHARE` |
| `REQUESTER_SHARE` | `0.4` | seed roster split + k6 alias for `REQUEST_PROBABILITY` |
| `CREDIT_BALANCE` | `5000` | seed (every user; dual-role) |
| `ORDER_URL` | `http://localhost:8083` | k6 |
| `DURATION` | `10m` | k6 — used only when `PROFILE=soak` |
| `THINK_SECONDS` | `1` | k6 |
| `MAX_ORDERS_PER_REQUESTER` | `5` | k6 — max orders a creating VU may place |
| `ORDER_COUNT_WEIGHTS` | `50,25,15,7,3` | k6 — relative weights for placing 1..max orders |
| `CREATE_SPREAD_SECONDS` | `240` / `20` | k6 — per-VU window to schedule creates (peak / soak defaults) |
| `COURIER_BROWSE_PROBABILITY` | `0.2` | k6 — on a deliver iteration, P(pool read + maybe accept) |
| `ESCALATE_EVERY` | `20` | k6 |
| `PICKUP_ID` | `2` | k6 — Supplier approved place id (`fromLocation`) |
| `DROPOFF_ID` | `1` | k6 — Order `delivery_point.id` (`deliveryPointId`) |

## Metrics tags (Prometheus / Grafana)

Order ids appear in real request paths (`/orders/{id}/accept`, …). For streamed
metrics, `load.js` sets a stable `tags.name` per endpoint (`accept`, `collect`,
`get_order`, …), which k6 also copies into `url`, so those UUIDs do not create
one time series per order. `url` is left out of `systemTags` as well. Thresholds still filter on custom `op`
(`create` / `read` / `fulfill` / `close`).

## Scale up / scale down (full-run footprint)

**Required for a full 9600 VU run.** The Git values under
`deploy/values/envs/dev/services/` are the **idle** floors. Leaving them idle
and only bumping RDS will **not** pass — create-path traffic is I/O-bound, CPU
HPA stays near 0%, and a low pin (or `min` < `max`) sheds pods mid-run. Scale
**up in Git (or paused kubectl) before** the full Job; scale **back down after**
so burst Spot and RDS xlarge do not idle-bill.

### Idle (what Git should hold day-to-day) vs peak (`full-1520`)

| Knob | Idle (committed default) | Peak (set before full run, revert after) |
| --- | --- | --- |
| Order `minReplicas` / `maxReplicas` | **2 / 2** | **32 / 32** |
| Order Hikari `maximum-pool-size` | **10** (`application-k8s.yml`) | **30** (full-run create/read; 32×30 ≈ 960 fits xlarge ~1800) |
| User, Credit, Supplier, Rating | **1 / 1** each | **8 / 8** each |
| `foc-dev` ResourceQuota | keep **40** CPU / **64Gi** / **100** pods (already sized for peak) | same — raise further only if you go above 32/8 |
| Terraform `burst_node_max` | default **5** | apply with **`-var burst_node_max=8`** |
| RDS | `db.t4g.micro` (Terraform default) | apply with **`-var rds_instance_class=db.m7g.xlarge`** |

Files: `deploy/values/envs/dev/services/{order,user,credit,supplier,rating}.yaml`,
`deploy/values/envs/dev/namespace.yaml`, `infra/nonprod/aws` (`burst_node_max`,
`rds_instance_class`), `order-service/src/main/resources/application-k8s.yml`
(Hikari). Argo syncs service values from **`main` only**; Hikari lives in the
Order image — change it, then rebuild/push Order (or set
`SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE` on the Order deploy for a quick
override).

### Scale up (before a full run)

1. **Edit service YAML to the peak pins** (Order `32`/`32`, peers `8`/`8`).
   Quota in `namespace.yaml` already fits that footprint; only raise it if you
   go higher. **Order Hikari:** set `maximum-pool-size` to **30** (file above,
   or env override) — idle **10** stalls Tomcat workers under full-run I/O.
   Merge to `main`, then Refresh/sync `dev-order`, `dev-user`,
   `dev-credit`, `dev-supplier`, `dev-rating` (and roll Order if the image
   changed). Wait until Desired = Ready.
2. **Burst capacity** — apply with a higher max so Order×32 can schedule:

   ```bash
   terraform -chdir=infra/nonprod/aws apply \
     -var state_bucket=foc-tfstate-474265880628 \
     -var ses_from_email=donleehh420@gmail.com \
     -var burst_node_max=8 \
     -var rds_instance_class=db.m7g.xlarge
   ```

   Always pass the usual `-var`s on every apply. Wait until RDS is `available`
   (see [step 5](#5-full-run)), then start the full Job. Cluster Autoscaler
   adds Spot burst nodes when pods are Pending.

3. If pods stay `Pending` with `Insufficient cpu` or “max node group size
   reached”, confirm `burst_node_max=8` applied and watch
   `kubectl get nodes -l foc.io/pool=burst`.

Optional without waiting on Git: **pause** the Argo apps, `kubectl -n foc-dev`
patch HPA `minReplicas`/`maxReplicas` (and scale deploys) to the peak pins,
run the test, then unpause **only after Git matches** (otherwise self-heal
reverts you). Prefer Git for anything reproducible.

### Scale down (after the run)

Do this soon after the k6 Job finishes.

1. **Revert service YAML to idle** (Order `2`/`2`, peers `1`/`1`) and Order
   Hikari back to **10**, merge to `main`, sync the Argo apps (rebuild/push
   Order if Hikari was changed in the image). If you scaled with `kubectl`
   first, **pause Argo** beforehand; an unpaused sync restores whatever is on
   `main`.
2. **RDS + burst max back to idle** (DB blips for a few minutes — tell the
   team):

   ```bash
   terraform -chdir=infra/nonprod/aws apply \
     -var state_bucket=foc-tfstate-474265880628 \
     -var ses_from_email=donleehh420@gmail.com
   # omits rds_instance_class → db.t4g.micro; omits burst_node_max → 5
   ```

   Confirm:

   ```bash
   aws rds describe-db-instances --db-instance-identifier foc-nonprod \
     --query 'DBInstances[0].[DBInstanceClass,DBInstanceStatus]' --output text
   aws eks describe-nodegroup --cluster-name foc-nonprod --nodegroup-name burst \
     --query 'nodegroup.scalingConfig' --output json
   ```


3. **Burst nodes**: once replica requests drop, Cluster Autoscaler removes idle
   burst nodes (often several minutes). No manual drain required.
4. **Quota**: leave the higher quota; it is harmless headroom. Never leave
   floors above what the quota allows.

### Check that scale-up actually stuck

```bash
kubectl -n foc-dev get hpa
kubectl -n foc-dev get deploy order user credit supplier rating
kubectl -n foc-dev describe pod -l app.kubernetes.io/name=order | findstr /i "Insufficient Pending"
# or on macOS/Linux: … | grep -Ei 'Insufficient|Pending'
```

Argo can overwrite a live `kubectl scale` on the next sync — if Desired snaps
back, the env values on `main` still have the old floors.

## AI Use Summary

**Tools:** Cursor (Auto)

**Prohibited phases avoided:** requirements elicitation and prioritization;
architecture and design decisions (service boundaries, order state machine,
Kafka transactional outbox, schemas and interfaces, load-test profile and
capacity approach); idea generation for product features; drafting of
decision rationales and trade-off justifications. Those were done by the
authors. For Order Service and Load test, **Varun Sivakumar** owns those
decisions. Cursor plans under [`../ai/plans/`](../ai/plans/) are his design
notes reworded for execution, not AI-originated architecture.

**Used for:**

- Generating and editing implementation code and unit/integration tests once
  requirements and architecture were fixed
- Boilerplate (config, scaffolding, repetitive glue)
- Debugging assistance (errors, test failures, deploy/load issues)
- Refactoring and documentation wording

**Verification:** All AI outputs for Order Service and Load test were
reviewed, edited where needed, and tested by **Varun Sivakumar**, who
generated the ideas and designed the implementation. The team remains
accountable for correctness, security, and licensing.

**Prompts / key exchanges:** see [`../ai/usage-log.md`](../ai/usage-log.md).
Author design plans: [`../ai/plans/`](../ai/plans/).

### Load test

**Owner:** Varun Sivakumar

Varun Sivakumar designed the dual-role peak/soak load profile, seeding
approach, capacity/scale-up story, and evidence expectations. Cursor (Auto)
implemented and edited the k6 script and related docs under that design
(`k6/load.js` has an in-file header). Helm chart files and seed scripts were
Auto-**edited** with possibly mixed origin; folder disclosure:
[`AI_ASSISTANCE.md`](AI_ASSISTANCE.md).

Plan: [`../ai/plans/fix_order_loadtest.md`](../ai/plans/fix_order_loadtest.md).
Usage log: [`../ai/usage-log.md`](../ai/usage-log.md).
