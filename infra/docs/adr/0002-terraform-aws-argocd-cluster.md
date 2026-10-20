# ADR-0002: Terraform owns AWS; Argo CD owns everything inside clusters

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

Terraform can manage in-cluster objects through its `kubernetes` and `helm`
providers, and can even deploy applications (`kubernetes_deployment`). But:

- A single Terraform run can't reliably create an EKS cluster **and**
  configure the `kubernetes`/`helm` providers against it, because the cluster
  address is unknown at plan time.
- Application releases change many times a day, which Terraform state isn't
  designed for.
- Manual `kubectl` changes drift from Terraform until the next `apply`.

## Decision

- **Terraform** (`infra/`) provisions AWS only: VPC, EKS and node group, ECR,
  IAM / Pod Identity, and state. Its **only** in-cluster action is a one-time
  install of **Argo CD** and the root "app of apps" `Application`.
- **Argo CD** syncs everything else from `deploy/` in Git:
  - the Strimzi operator;
  - Kafka, node pools, topics and users;
  - namespaces, quotas and network policies;
  - the 7 services.
- Environments are **directories** (`infra/{global/ecr,local,nonprod,prod}`),
  not Terraform workspaces. Each directory has its own state in S3 with native
  locking (`use_lockfile`).

## Consequences

- One tool (Argo CD) changes cluster contents, and drift is self-healed.
- Adding a Kafka topic is a YAML PR, with no `terraform apply` needed.
- The `helm` provider is used exactly once per cluster (Argo CD bootstrap).
- Two tools to learn instead of one.
