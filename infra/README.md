# FoC Infrastructure

How Friend on Campus is provisioned and deployed across **local**, **dev**,
**stg** and **prod**.

> **Status:** the local environment works end to end: Floci + `infra/local/aws`
> + `deploy/local.sh` run Strimzi, Kafka 4.3.1 (7 topics, 5 users with ACLs),
> credit-service, a connectivity stub for each of the other 6 services, and
> the API gateway (Envoy Gateway with auth, ADR-0007). `deploy/local.sh check`
> passes: 23 Kafka ACL checks, 7 HTTP checks, 22 gateway checks. The cloud envs are not built; see [Build order](#build-order).

- New to Terraform / Kubernetes / Strimzi / Argo CD? Read
  [`docs/concepts.md`](docs/concepts.md) first.
- Running things on your laptop: [`docs/local-floci.md`](docs/local-floci.md).
- Why things are the way they are: [`docs/adr/`](docs/adr/).
- Architecture diagram: [`../docs/architecture/foc-architecture.drawio`](../docs/architecture/foc-architecture.drawio).

**Scope of this phase:** Kafka, service-to-service connectivity, and pulling
images from ECR. Databases, the API gateway (Envoy), and the AWS-managed
integrations (S3, SES, Bedrock, EventBridge/SQS) come later.

---

## Environments

| Env | Where | Namespace | Kafka (Strimzi) | Lifecycle |
|---|---|---|---|---|
| **local** | [Floci](https://github.com/floci-io/floci) on your laptop (EKS = real k3s) | `foc` | 1 broker, RF 1 | on demand |
| **dev** | **non-prod** EKS cluster (shared) | `foc-dev` | 1 broker, RF 1 | always on while non-prod exists |
| **stg** | **non-prod** EKS cluster (shared) | `foc-stg` | 1 broker, RF 1 | same |
| **prod** | **prod** EKS cluster (dedicated) | `foc` | 3 brokers, RF 3, `min.insync.replicas=2` | always on |

- dev and stg are **namespaces** in one cluster, and prod gets its **own
  cluster**. That's two EKS control planes instead of three.
  See [ADR-0001](docs/adr/0001-shared-nonprod-cluster.md).
- Each env's Kafka lives **inside that env's app namespace**, so every
  env uses the same connection strings.
  See [ADR-0003](docs/adr/0003-kafka-per-env-namespace.md).
- Shared-cluster guard rails: default-deny cross-namespace `NetworkPolicy`,
  `ResourceQuota` + `LimitRange` per namespace, separate secrets per env.

## Who owns what

| Layer | Tool | Contents |
|---|---|---|
| AWS resources | **Terraform** (`infra/`) | VPC, EKS + node group, ECR, IAM / Pod Identity, S3 state, one-time **Argo CD** install (cloud only) |
| Everything inside a cloud cluster | **Argo CD** syncing `deploy/` from Git | Strimzi operator, `Kafka` + `KafkaNodePool` + `KafkaTopic` + `KafkaUser`, namespace policies, the 7 services |
| Everything inside the local cluster | **`deploy/local.sh`** (Helm, from your working copy) | the same charts and values ([ADR-0009](docs/adr/0009-no-argocd-locally.md)) |

Terraform does **not** deploy the services: see
[ADR-0002](docs/adr/0002-terraform-aws-argocd-cluster.md).

## Repository layout (target)

```text
infra/                              # Terraform: AWS only
  .terraform-version                # 1.16.4 (tfenv)
  modules/                          # only real multi-resource concepts (see "Terraform conventions")
    argocd/                         # ✅ GitOps bootstrap: Argo CD + optional root app (cloud envs)
    network/                        #    VPC, subnets, NAT
    eks/                            #    cluster, node group, node role with ECR read-only
  global/ecr/                       #    shared registry for all cloud envs: ecr.tf
  local/                            # ✅ Floci
    compose.yaml                    #    Floci itself
    aws/                            #    (own state): ecr.tf · network.tf · eks.tf · kubeconfig.tf
  nonprod/{aws,bootstrap}/          #    EKS hosting foc-dev + foc-stg
  prod/{aws,bootstrap}/             #    EKS hosting foc
  docs/
deploy/                             # Kubernetes YAML (ADR-0008, ADR-0009)
  local.sh                          # local: helm install/upgrade from your working copy
  charts/                           # level 1: plain Helm charts, installable without Argo
    foc-service/                    #   ONE generic chart for all 7 services
    foc-kafka/                      #   Kafka, KafkaNodePool, KafkaTopic ×7, KafkaUser ×5
    foc-namespace/                  #   namespace, quota, limits, network policy
    strimzi/                        #   wrapper chart pinning the Strimzi operator
  values/
    services/<svc>.yaml             #   same in every env
    envs/{local,dev,stg,prod}/      #   only what differs: image tag, replicas, Kafka size, quota
  argocd/                           # level 2 (cloud only): AppProjects + ApplicationSets per cluster
# level 3: root Application created by Terraform → deploy/argocd/<cluster>.yaml
```

Per-env differences are **values only**:

| | local | dev | stg | prod |
|---|---|---|---|---|
| Kafka brokers / RF | 1 / 1 | 1 / 1 | 1 / 1 | 3 / 3 |
| Replicas per service | 1 | 1 | 2 | 2+ |
| Nodes | k3s single | non-prod node group (shared) | ← same | 3× t3.large |
| Image tag | local build | latest `main` SHA | promoted SHA | promoted SHA |

## Terraform conventions

Following HashiCorp's [module guidance](https://developer.hashicorp.com/terraform/language/modules/develop)
and [style guide](https://developer.hashicorp.com/terraform/language/style):

- **Resources go directly in the env folder**, one file per logical group
  (`ecr.tf`, `network.tf`, `eks.tf`, …), plus `terraform.tf` (required
  versions and providers), `providers.tf`, `variables.tf` and `outputs.tf`.
- **A module must describe a new concept** built from several resources and
  shared by several envs, e.g. `argocd` (Argo CD + root app) or `eks`
  (cluster + node group + IAM). No thin wrappers around a single resource
  type. HashiCorp: "Just use the resource type directly in the calling module
  instead."
- **Renaming or moving a resource** uses a `moved` block, so Terraform
  updates state instead of destroying and recreating the resource. Check that
  `plan` shows only "has moved" lines before applying.

## How services connect

Every value below is the **same in every env** because the pod's own
namespace resolves short DNS names:

| From a service to… | Address |
|---|---|
| another service | `http://<service>:<port>` e.g. `http://credit:3000` |
| Kafka | `kafka-kafka-bootstrap:9093` (SCRAM-SHA-512, TLS) |

- Kafka credentials: Strimzi creates one Secret per `KafkaUser`, and the
  chart mounts it as `KAFKA_USERNAME` / `KAFKA_PASSWORD`.
- ACLs mirror the event catalog. For example, only `order` may write
  `foc.credit.commands` and only `credit` may read it. See
  [ADR-0004](docs/adr/0004-kafka-scram-acls.md) for the full table.

## Images and promotion

1. CI builds each service **once** per commit and pushes it to the shared ECR
   as `foc/<service>:<git-sha>` (immutable tags).
2. CI commits that SHA into `deploy/values/envs/dev/services/<svc>.yaml` (with
   `[skip ci]`), and Argo CD syncs dev.
3. **Promotion is a pull request** copying the SHA into `values/envs/stg`
   and then `values/envs/prod` (CODEOWNERS review). **Rollback** is
   `git revert`.
4. **Worker nodes** pull the image, not pods. Their IAM role has
   `AmazonEC2ContainerRegistryReadOnly`, so there are no registry passwords.

See [ADR-0005](docs/adr/0005-argocd-gitops-helm.md).

## Terraform state

- Each cloud env has two Terraform layers with separate state: `aws/` (AWS
  resources), then `bootstrap/` (Argo CD, which needs the cluster from
  `aws/`). Local has only `aws/`. Cloud state goes in S3 with native locking
  (`use_lockfile = true`, Terraform ≥ 1.10).
- Keys: `global/ecr`, `nonprod/…`, `prod/…`. `local` keeps state on disk,
  or in Floci's own S3.
- Everything is tagged with `env` and `managed-by = terraform`. The AWS
  account ID is a variable (see [Open decisions](#open-decisions)).

## Build order

1. ✅ **Floci spike** (done 2026-09-29): start Floci, create an EKS cluster (k3s), push one image to
   Floci ECR, and deploy it. Image pull and service DNS both work; see
   [spike results](docs/local-floci.md#spike-results-2026-09-29).
2. **Local platform:** ✅ `infra/local/aws` applies cleanly. Argo CD was
   dropped locally in favour of `deploy/local.sh`
   ([ADR-0009](docs/adr/0009-no-argocd-locally.md)).
3. **`deploy/`:** ✅ written and validated offline (Helm lint, plus schema
   validation against Strimzi 1.2.0 and Argo CD v3.5.3 CRDs; see
   [`deploy/README.md`](../deploy/README.md)): Strimzi, Kafka 4.3.1, 7 topics,
   5 Kafka users, the generic chart with `credit-service`, `deploy/local.sh`,
   and the root app in `modules/argocd` for the cloud.
   ✅ Ran locally on 2026-10-01: everything Ready in about 2 min; service DNS,
   namespace isolation, Kafka login and ACLs, and one event from order to
   credit all verified
   ([results](docs/local-floci.md#local-run-results-2026-10-01)).
4. **Real AWS:** `global/ecr`, then `nonprod` (dev + stg), then `prod`.

## Open decisions

| Topic | Status |
|---|---|
| One AWS account vs separate non-prod / prod accounts | **Deferred**. The layout supports either; account ID is a variable. |
| Credit settlement for admin-resolved orders | Known gap in the API contract (carried over from the architecture review). |
