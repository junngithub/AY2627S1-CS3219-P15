# Concepts

The ideas you need to work on FoC infrastructure, in the order you'll meet
them. Each section ends with **In FoC:**, showing where the concept shows up
here.

## Terraform (infrastructure as code)

Terraform reads `.tf` files that describe the infrastructure you want, and
makes the real world match.

| Term | Meaning |
|---|---|
| **Provider** | Plugin that talks to one API. `aws` creates AWS resources, and `helm` installs Helm charts into a cluster. |
| **Resource** | One managed thing, e.g. `aws_ecr_repository`. |
| **Module** | Reusable folder of resources with `variables.tf` (inputs) and `outputs.tf`. Write once, call per environment with different values. |
| **State** | Terraform's record of what it created. Without it Terraform can't tell what to change or delete. |
| **Backend** | Where state is stored. Remote (S3) so the team shares one copy; **locking** stops two people applying at once. |
| **`plan` / `apply` / `destroy`** | Preview changes / make them / tear everything down. |

**Separating environments.** There are two common approaches:

- *Workspaces*: one folder, with state switched by `terraform workspace select`.
  It's easy to apply to the wrong env, and differences between envs hide in
  conditionals.
- *Directory per environment* (**what we use**): `nonprod/` and
  `prod/` each call the shared modules with their own values. Each
  folder automatically has its own state, and differences show up in review.

**In FoC:** Terraform owns AWS only. See
[ADR-0002](adr/0002-terraform-aws-argocd-cluster.md).

## Kubernetes

A system that keeps containers running on a set of machines (**nodes**). You
declare the desired state in YAML, and Kubernetes keeps reality matching it.

| Object | What it is | In FoC |
|---|---|---|
| **Cluster** | Control plane + nodes. On AWS the managed version is **EKS**. | `nonprod`, `prod`; locally Floci's k3s |
| **Namespace** | A folder inside a cluster; names are unique per namespace. | `foc-dev`, `foc-stg`, `foc` |
| **Pod** | One running instance of a container (or a few tightly coupled ones). | one per service replica |
| **Deployment** | "Keep N pods of this image running"; replaces crashed pods and rolls out new versions. | one per service |
| **Service** | Stable DNS name + virtual IP in front of a Deployment's pods. **This is how services find each other.** | `credit`, `order`, … |
| **ConfigMap / Secret** | Configuration / sensitive values injected as env vars or files. | Kafka creds, URLs |
| **ServiceAccount** | Identity of a pod. With **EKS Pod Identity** it maps to an IAM role, so pods get AWS permissions without keys. | later: Order → S3 |
| **NetworkPolicy** | Firewall rules between pods and namespaces. | block `foc-dev` ↔ `foc-stg` |
| **ResourceQuota / LimitRange** | Cap total CPU/memory per namespace / default per-container limits. | dev can't starve stg |

**Service DNS.** A Service named `credit` in namespace `foc-dev` has the full
name `credit.foc-dev.svc.cluster.local`, but a pod *in the same namespace* can
just use `credit`. We rely on this so config is identical in every env.

## Operators and CRDs

A **CRD** (Custom Resource Definition) adds a new object type to Kubernetes.
An **operator** is a program running in the cluster that watches those
objects and does the hard work: it creates pods and storage, and repairs
them when something breaks.

## Kafka and Strimzi

**Kafka** is a durable log of events. Producers append messages to a
**topic**, and consumers read them at their own pace, tracked per **consumer
group**. FoC's topics and who uses them are listed in the event catalog in
the API contract.

**Strimzi** is the Kafka operator we use. You declare:

| CRD | Declares |
|---|---|
| `Kafka` | The cluster: version, listeners (ports and auth), config. |
| `KafkaNodePool` | The brokers: how many, storage size. Runs in KRaft mode (no ZooKeeper). |
| `KafkaTopic` | One topic: partitions, replication factor, retention. |
| `KafkaUser` | One client identity (SCRAM user and password Secret) and its **ACLs**. |

- **Replication factor (RF):** how many brokers keep a copy of each
  partition. prod uses RF 3 with `min.insync.replicas=2`, so a write
  succeeds only when 2 copies exist and the cluster survives losing one
  broker.
- **SCRAM + ACLs:** each service logs in as itself, and ACLs say which
  topics it may read or write. See [ADR-0004](adr/0004-kafka-scram-acls.md).

**In FoC:** one Strimzi operator per cluster, with one Kafka cluster per env
namespace. See [ADR-0003](adr/0003-kafka-per-env-namespace.md).

## Helm

A **chart** is a templated bundle of Kubernetes YAML, and **values** fill in
the blanks. We use **one generic chart** (`deploy/charts/foc-service`) for
all 7 services. Values are **layered**: Helm reads several files in order,
and later files override earlier ones. So `values/services/credit.yaml`
holds what's the same everywhere (port, Kafka user, env vars), and
`values/envs/dev/services/credit.yaml` holds only what differs (image tag, replicas).

## Argo CD (GitOps)

**GitOps:** Git holds the desired state of each cluster, and an agent in
the cluster keeps the cluster matching Git.

- **Argo CD** is that agent. An `Application` points at a Git folder or chart
  and a destination namespace. With `selfHeal`, manual `kubectl edit`
  changes are reverted.
- **ApplicationSet:** a template that *generates* `Application`s, e.g. "one
  Application for every service values file in `values/envs/dev/`". Adding
  a service means adding a file, with no Argo YAML to write.
- **AppProject:** a fence around a group of Applications, e.g. FoC apps may
  only deploy into FoC namespaces, never `kube-system` or `argocd`.
- **Root application:** one `Application` created by Terraform that points
  at the cluster's ApplicationSets, so Terraform only installs Argo CD plus
  this root.
- **Sync waves:** an annotation that orders installation. Strimzi must be
  installed before a `Kafka` object means anything.
- **Promotion** means changing the image tag in `deploy/values/envs/stg`
  (then `prod`) through a pull request. **Rollback** is `git revert`.

**In FoC:** see [ADR-0005](adr/0005-argocd-gitops-helm.md) and
[ADR-0008](adr/0008-gitops-repo-layout.md).

## ECR and image pulls

**ECR** is AWS's container registry. An image reference looks like:

```text
<account>.dkr.ecr.<region>.amazonaws.com/foc/credit-service:<git-sha>
```

- **Build once, promote:** the same image (same SHA) moves dev → stg → prod,
  and only configuration differs. Tags are **immutable**, so a SHA always
  means the same bytes.
- **Who pulls:** the kubelet on each **worker node**, using the node's IAM
  role (`AmazonEC2ContainerRegistryReadOnly`). Pods need no registry
  credentials.
- **One shared registry** (`global/ecr`) serves every env.

## Floci (local AWS)

A free local AWS emulator on `http://localhost:4566`. Terraform and the AWS
CLI talk to it with fake credentials (`test`/`test`). Several services are
backed by **real** containers: EKS by k3s, ECR by `registry:2`, RDS by
Postgres. Details and gotchas are in [`local-floci.md`](local-floci.md).
