# Local environment with Floci

> **Status:** working end to end as of 2026-10-01 in `ap-southeast-1`
> (Floci `2.1.0`, Terraform `1.16.4`, Strimzi `1.2.0`, Kafka `4.3.1`). See
> [Local run results](#local-run-results-2026-10-01). There's no Argo CD
> locally ([ADR-0009](adr/0009-no-argocd-locally.md)).

[Floci](https://github.com/floci-io/floci) is a free, MIT-licensed local AWS
emulator. It listens on `http://localhost:4566`, needs no account or token,
and is a drop-in replacement for LocalStack.

## What we use from Floci

| Floci service | Backed by | Our use |
|---|---|---|
| **EKS** | a real **k3s** cluster in Docker, with a live Kubernetes API | runs Strimzi, Kafka and the services, the same charts as in the cloud |
| **ECR** | a real `registry:2`, at `000000000000.dkr.ecr.ap-southeast-1.localhost:4566/<repo>` | `docker push` / `pull` with the same flow as CI |
| **IAM / STS** | in-process | roles referenced by EKS; the IAM user whose key logs kubectl in |
| **S3** | in-process | optional: Terraform state for `infra/local` |
| **RDS** | a real `postgres:16` container behind a proxy on ports 7001–7099 | one instance, a database and login per service ([ADR-0010](adr/0010-postgres-per-service-database.md)) |
| **MSK** | Redpanda | **not used.** We run Strimzi so local matches the cloud. |

Defaults: account `000000000000`, credentials `test` / `test`. We use region
**`ap-southeast-1`** (the same as the cloud; set in `aws/variables.tf`). Floci
keeps each region separate, just like AWS.

## Prerequisites

- Docker Desktop (about 4 GB of free memory for k3s + Strimzi + one Kafka broker + services)
- AWS CLI v2, kubectl, Helm (`brew install helm`)
- Terraform via `tfenv` (`brew install tfenv`). `infra/.terraform-version`
  pins the version, and tfenv installs it on first use.
- Node.js 22 and npm, only to run the frontend dev server.

## Quick start

All commands run from the repository root. Three situations:

| You are | Run |
|---|---|
| Setting up for the first time | [First time](#first-time), steps 1–8 |
| Coming back after Docker or Floci was stopped or restarted | [Coming back](#coming-back-after-a-restart) |
| Changing a service's code | `deploy/push-local.sh <svc>` ([Push an image](#push-an-image-to-local-ecr)) |

### First time

```bash
# 1. Start Floci (compose.yaml mounts the Docker socket so Floci can run k3s + the registry)
docker compose -f infra/local/compose.yaml up -d

# 2. Local "AWS": IAM user, ECR repos, VPC/subnets, EKS (k3s) cluster,
#    Postgres (RDS), and infra/local/kubeconfig
terraform -chdir=infra/local/aws init && terraform -chdir=infra/local/aws apply

# 3. Build and push images to local ECR (each also pushes <tag>-migrate if
#    its Dockerfile has a migrate stage). Needs step 2's ECR repositories, and
#    must come before step 4: local.sh waits for every service pod to be
#    Ready, which can't happen until its image is in ECR. Nothing runs the
#    images yet, so nothing restarts. (After a restart it's the other way
#    round: see "Coming back after a restart".)
deploy/push-local.sh                       # user, supplier, credit, order + the
                                           # connectivity stub (rating, badges, admin)

# 4. Deploy everything: databases → Strimzi → Envoy Gateway → cert-manager,
#    trust-manager, Linkerd (mTLS, ADR-0012) → Kafka (7 topics, 5 users) →
#    7 services (each runs its migrations first; order's Flyway runs at
#    startup) → gateway. About 3–5 minutes on a fresh cluster.
deploy/local.sh

# 5. Check: database logins, Kafka logins/ACLs, every pod meshed, mesh
#    policy (unlisted callers get 403), HTTP to every service, requests
#    through the gateway. Ends with "All connectivity checks passed".
deploy/local.sh check

# 6. Test data (optional, local only):
#    - suppliers: the seed Job in deploy/README.md ("Seed Supplier's database")
#    - logins: student@u.nus.edu / admin@u.nus.edu, password Password123
#      (deploy/README.md, "Local test users", for how to create them)

# 7. Open the API gateway on http://localhost:8080 (keep it running)
deploy/local.sh gateway

# 8. Frontend through the gateway (another terminal) → http://localhost:5173
printf 'VITE_AUTH_ENABLED=true\nAPI_GATEWAY_URL=http://localhost:8080\n' > frontend/.env.local
(cd frontend && npm ci && npm run dev)

# Inspect the cluster
export KUBECONFIG=$PWD/infra/local/kubeconfig
deploy/local.sh status
kubectl -n foc get pods
kubectl -n foc logs deploy/user          # e.g. the email OTP after a signup
```

### Coming back after a restart

Any Docker or Floci restart replaces the k3s node, clean shutdown or not
([why](#after-restarting-floci-or-docker)). Heal the cluster **before**
`deploy/push-local.sh` or anything else that touches it:

```bash
docker compose -f infra/local/compose.yaml up -d   # if Floci isn't running
terraform -chdir=infra/local/aws apply             # the API port can change; rewrites ./kubeconfig
deploy/local.sh                                    # heals, then redeploys
deploy/local.sh check
deploy/local.sh gateway                            # the old port-forward died with the node
```

`deploy/local.sh` removes the dead node, resets Kafka's disk and re-meshes
pods that started without the Linkerd proxy. Kafka takes about **5 minutes**
to come back after its disk is reset (Strimzi waits out a timeout first), so
the run sits at `==> Kafka, topics, users` for a while. Let it finish: don't
restart the Strimzi operator by hand, which starts that wait over.

Restarted Floci again since? Check with `kubectl get nodes`: more than one
node, or one `NotReady`, means run `deploy/local.sh` again.

### Push an image to local ECR

```bash
deploy/push-local.sh                        # every image the local cluster runs
deploy/push-local.sh credit user            # just these
deploy/push-local.sh credit                 # build credit-service/, push, restart deploy/credit
deploy/push-local.sh credit my-feature      # same, with a different tag
deploy/push-local.sh connectivity-stub      # the stand-in for services without code (tag from its package.json)
deploy/push-local.sh --no-restart order     # push only
```

The script:
- with no service named, reads the list from
  `deploy/values/envs/local/services/`: each service running its own image,
  plus the connectivity stub if any service runs it;
- finds the build folder (`<svc>-service/`) and the image name (from
  `deploy/values/services/<svc>.yaml`, the same file Helm reads);
- defaults the tag to the one in `deploy/values/envs/local/services/<svc>.yaml`,
  or `dev`;
- logs in to Floci's ECR, builds and pushes;
- restarts every Deployment running one of those exact images, together. Local services use
  `pullPolicy: Always`, so the restart pulls the new build.

It stops with a clear message if the folder or Dockerfile is missing or empty,
if the ECR repository doesn't exist (add it to `var.services` / `var.tools`
in `infra/local/aws`), or if the service still runs the stub locally (it tells
you which lines to change).

The cluster pulls straight from Floci's ECR: Floci configured the k3s
registry mirror when the cluster was created.

If Floci was restarted since the last `deploy/local.sh`, the push still works
but the restarts don't: the new pods can't resolve names, start without a
Linkerd proxy, and the script times out waiting for them. Run
`deploy/local.sh` first ([After restarting Floci](#after-restarting-floci-or-docker)).

### Tear down

```bash
deploy/local.sh down                       # optional: removes Kafka data too
terraform -chdir=infra/local/aws destroy
docker volume rm floci-eks-foc-local       # k3s data; NOT labelled floci=true (see Known risks)
docker compose -f infra/local/compose.yaml down -v
```

### Changing the region

Floci keeps each region separate. If you change `region` after applying,
Terraform looks for the existing resources in the new region, doesn't find
them, and plans to create everything again. The old ones are left behind,
including a k3s cluster with the same name. Destroy with the **old** region
first, then apply with the new one:

```bash
terraform -chdir=infra/local/aws destroy -var region=<old-region>   # e.g. us-east-1
docker volume rm floci-eks-foc-local
terraform -chdir=infra/local/aws apply                               # new default from variables.tf
deploy/local.sh                                                      # redeploy into the new cluster
```

## How `infra/local` is laid out

| Path | Terraform state | Creates |
|---|---|---|
| `compose.yaml` | n/a | Floci |
| `aws/` | `aws/terraform.tfstate` | IAM user `foc-local-admin` + key, ECR `foc/<service>` ×7 (MUTABLE), VPC + 2 subnets, IAM role, EKS cluster `foc-local`, `../kubeconfig` (0600, git-ignored), RDS Postgres `foc-local` + generated passwords (admin and one per service in `var.databases`) |

Everything inside the cluster comes from `deploy/local.sh`, not Terraform
(see [`deploy/README.md`](../../deploy/README.md)).

**Local vs cloud:**
- `aws/` declares `aws_eks_cluster` directly. Floci ignores node groups and
  networking, and k3s provides its own node. `nonprod`/`prod` will use a real
  `modules/eks` (node group, node role with ECR read-only).
- The cloud envs add a second Terraform layer (`bootstrap/`) that installs
  Argo CD via `modules/argocd`. Local has none.
- RDS (`aws/rds.tf`) has a Terraform-generated admin password and no subnet
  or security group; the cloud lets RDS manage the admin password in Secrets
  Manager and keeps the instance in private subnets. Pods reach Floci's RDS
  by the IP Terraform outputs (Docker names don't resolve in pods).
- ECR repositories are declared directly in `aws/ecr.tf` (mutable tags,
  force-delete). The cloud registry in `global/ecr` gets its own `ecr.tf` with
  immutable tags, scanning and a lifecycle policy.

### Terraform provider for Floci

`aws/providers.tf` points every AWS service it uses at Floci. A service
missing from `endpoints` would be sent to **real AWS**:

```hcl
provider "aws" {
  region     = var.region
  access_key = "test"
  secret_key = "test"

  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  s3_use_path_style           = true

  endpoints {
    ec2 = var.floci_endpoint
    ecr = var.floci_endpoint
    eks = var.floci_endpoint
    iam = var.floci_endpoint
    sts = var.floci_endpoint
  }
}
```

### Cluster login

`aws eks get-token` signs an STS request. Floci's k3s asks Floci to verify it,
and Floci accepts only keys belonging to a **real IAM user in Floci**. The
`test` / `test` key is not one, so kubectl gets
`the server has asked for the client to provide credentials`.

Fix: `aws/` creates IAM user `foc-local-admin` with an access key, and writes
`infra/local/kubeconfig` whose token command uses that key. The equivalent
by hand:

```bash
aws iam create-user --user-name foc-local-admin
aws iam create-access-key --user-name foc-local-admin   # note the key pair
kubectl config set-credentials arn:aws:eks:ap-southeast-1:000000000000:cluster/foc-local \
  --exec-env=AWS_ACCESS_KEY_ID=<id> --exec-env=AWS_SECRET_ACCESS_KEY=<secret> \
  --exec-env=AWS_ENDPOINT_URL=http://localhost:4566
```

Floci maps a valid token to `system:masters` (cluster-admin).

## Spike results (2026-09-29)

| Check | Result |
|---|---|
| Floci `2.1.0` starts via `compose.yaml` | ✅ ready in under 1s |
| `aws eks create-cluster` | ✅ ACTIVE in about 10s; k3s at `https://localhost:6500`. The EKS API reports version `1.29`, but the node actually runs **k3s v1.34.1** (now pinned in `compose.yaml`). |
| kubectl login | ✅ after using a real IAM user key (see above) |
| Push to Floci ECR | ✅ `docker push …/foc/credit-service:spike` |
| **k3s pulls from Floci ECR** | ✅ Floci injects a k3s registry mirror (`*.dkr.ecr.<region>.localhost:4566` → Floci) when it creates the cluster. The image pulled in 1.2s. |
| Service DNS | ✅ another pod reached `http://credit:3000/health` → `{"status":"ok"}` |

## Local run results (2026-10-01)

Fresh cluster, then `deploy/local.sh`: everything Ready in **about 2 minutes**.
A second run with nothing to change takes **11 s** and recreates nothing.

| Check | Result |
|---|---|
| `infra/local/aws` in `ap-southeast-1` | ✅ 15 resources; re-plan shows no changes |
| Strimzi operator, Kafka 4.3.1 (1 broker), 7 topics, 5 users | ✅ all Ready |
| `credit` pulls `:dev` from Floci ECR and starts | ✅ gets exactly `KAFKA_BROKERS`, `KAFKA_USERNAME`, `KAFKA_PASSWORD`, `KAFKA_SASL_MECHANISM`, `KAFKA_CA_CERT`; CA mounted |
| Another pod calls `http://credit:3000/health` | ✅ `{"status":"ok"}` |
| A pod in **another** namespace calls it | ✅ blocked by `deny-from-other-namespaces` |
| `order` publishes to `foc.credit.commands`; `credit` consumes it (group `credit-…`) | ✅ message received |
| `credit` publishes to `foc.credit.commands` | ✅ denied (`ClusterAuthorizationException`: no Write on any topic, so it can't get idempotent-producer permission) |
| `credit` consumes with a group not prefixed `credit` | ✅ denied (`GroupAuthorizationException`) |
| Wrong password | ✅ rejected (SCRAM authentication failed) |
| Memory | ✅ about 1.9 GiB on the node (Kafka 411 Mi, Kafka's topic/user operators 304 Mi, Strimzi 239 Mi); quota 1.4/6 Gi requested |

### Connectivity check (2026-10-01)

Seven services running (credit's real image plus 6 stubs), then
`deploy/local.sh check`:
- **Kafka: 23/23 passed.** All 7 allowed writes, all 5 allowed reads (with each
  user's consumer-group prefix), 10 forbidden actions denied
  (`TopicAuthorizationException` / `GroupAuthorizationException`; `credit`,
  with no write rights at all, gets `ClusterAuthorizationException`), and a
  wrong password rejected.
- **HTTP: 7/7 passed.** Each service answers at `http://<name>:<port>/health`
  from another pod (stubs reply with their own name).

### After restarting Floci (or Docker)

Floci recreates the k3s container on start, with a new node name. The
cluster's data (Docker volume `floci-eks-foc-local`) survives, so the old node
and everything scheduled on it are still listed. Run:

```bash
terraform -chdir=infra/local/aws apply   # the cluster's API port can change (seen: 6501 → 6500); rewrites ./kubeconfig
deploy/local.sh                          # removes the dead node, resets Kafka's disk if pinned to it, redeploys
```

This applies to any restart, clean or not: stopping Docker, restarting Floci
in Docker Desktop, or `docker compose up` recreating the container. Signs that
the cluster still needs healing:

| Symptom | Cause |
|---|---|
| `kubectl get nodes`: two nodes, the older one `NotReady` | the k3s container was recreated |
| Pods stuck `Terminating` | they're on the dead node, so no kubelet confirms they stopped |
| `getaddrinfo EAI_AGAIN kafka-kafka-bootstrap`, services in `CrashLoopBackOff` | CoreDNS is on the dead node |
| New pods `1/1` instead of `2/2` (no `linkerd-proxy`) | the proxy injector is on the dead node; its webhook fails open (`failurePolicy: Ignore`), so pods start unmeshed |
| `kafka-dual-role-0` `Pending`: `persistentvolumeclaim "data-0-kafka-dual-role-0" not found` | the broker's volume was reset, but a Strimzi reconcile already running doesn't recreate the claim |
| `kubectl logs`: `the server could not find the requested resource` | the pod is on the dead node |

`deploy/local.sh` handles each of these: it deletes the dead node (its pods
go with it) and waits for CoreDNS; when it resets Kafka's claim it restarts
the Strimzi operator, so a fresh reconcile recreates it; and once the services
are up it restarts any Deployment whose pods started without the proxy.

### Why the gateway is reached with port-forward, not a Floci NLB (tested 2026-10-01)

Floci's ELBv2 API accepts NLBs, TCP target groups (IP targets) and TCP
listeners, and opens a real listener socket. But:
- it **proxies HTTP** instead of passing TCP bytes through. TLS through it
  fails (curl exit 35), and non-HTTP bytes get `HTTP/1.0 400`. A real NLB is
  layer-4 pass-through;
- targets must be reachable from the Floci container. k3s pod IPs
  (`10.42.x`) aren't;
- in the cloud the NLB is created by the AWS Load Balancer Controller from
  Envoy's `LoadBalancer` Service, not by Terraform. A Floci NLB would need
  hand-written Terraform and hand-registered targets that the cloud never
  uses.

So locally the same `LoadBalancer` Service is fulfilled by k3s ServiceLB and
reached with `deploy/local.sh gateway`. The real NLB is tested in nonprod.

## Known risks

| Risk | Detail | Fallback |
|---|---|---|
| **EKS add-ons are metadata only** | `vpc-cni`, `coredns` and similar are recorded but not installed. | None needed; k3s ships its own DNS and networking. |
| **Pod Identity needs TLS** | Credential injection only works with `FLOCI_TLS_ENABLED=true`. | Not needed this phase. Later, enable TLS or use static test keys locally. |
| **k3s data outlives the cluster** | Floci keeps each cluster's Kubernetes data in Docker volume `floci-eks-<cluster>`, which has **no** `floci=true` label. Deleting and recreating a cluster with the same name brings back old nodes, namespaces and deployments. | After destroying the cluster: `docker volume rm floci-eks-foc-local`. |
| **k3s mirror is set at cluster creation** | The registry mirror points at Floci's container IP on the compose network. If that IP changes (Floci container recreated), a cluster created earlier may lose it. | Recreate the cluster (`terraform apply -replace` on the EKS cluster). |
| **New pods are briefly blocked by the network policy** | k3s enforces NetworkPolicy with kube-router, which adds a new pod's IP to the allowed set shortly after it starts. Connections in about the first second are refused, even from the same namespace. Measured: fine from 2 s after start. | Nothing for long-running services (clients retry). For one-off test pods, `sleep 2` before connecting. |
| **Floci expires cluster tokens after 60 s** | `aws eks get-token` signs a token valid for 60 s but tells clients to reuse it for 14 min. Real EKS accepts it for ~15 min; Floci enforces 60 s. Any kubectl/helm operation lasting over a minute (e.g. `helm test`) then fails with `Unauthorized`. | Handled: the local kubeconfig calls `infra/local/eks-token.sh`, which reports a 45 s expiry so clients refresh in time. |
| **A Floci restart recreates k3s** | New node name (old node NotReady forever, but only ~40 s after the restart), possibly a new API port. Pods on the old node, including CoreDNS, stay stuck there, so name lookups time out (`curl: (28) Resolving timed out`). `local-path` volumes (Kafka's disk) stay pinned to the old node name, so Kafka can't reschedule. | `terraform apply`, then `deploy/local.sh`, which deletes every node but the newest (without waiting for NotReady), waits for CoreDNS, and resets only claims still bound to a volume pinned to a missing node (locally only Kafka's messages are lost), then restarts the Strimzi operator so it recreates Kafka's claim. It also waits for the broker **pod**, since Kafka's status can lag, and re-meshes pods that started while the Linkerd injector was down. See [After restarting Floci](#after-restarting-floci-or-docker) for the symptoms. |
| **Resources** | k3s + Strimzi + one Kafka broker (1–1.5 GiB) + services on one laptop. | 1 broker, 1 replica per service, small requests. |

## Useful commands

Run from `infra/local/`:

```bash
docker compose ps                          # is Floci running?
docker compose logs -f                     # emulator logs
docker ps --filter label=floci=true        # containers Floci started (k3s, registry)
docker compose down                        # stop, keep state
docker compose down -v                     # stop and wipe local AWS state
```

Floci-started containers (k3s, registry) outlive `docker compose down`.
Use the [Tear down](#tear-down) steps, or remove them with
`docker rm -f $(docker ps -aq --filter label=floci=true)` and then
`docker volume rm floci-eks-foc-local`.
