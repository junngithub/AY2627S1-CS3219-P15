# ADR-0005: Deploy services with Argo CD (GitOps) and one generic Helm chart

- **Status:** Accepted. Paths and Argo object types refined by
  [ADR-0008](0008-gitops-repo-layout.md): values live in
  `deploy/values/envs/<env>/`, and ApplicationSets replace hand-written
  Applications. [ADR-0009](0009-no-argocd-locally.md): Argo CD runs in the
  cloud clusters only; local uses Helm via `deploy/local.sh`.
- **Date:** 2026-09-29

## Context

Seven services with near-identical deployment needs must move through local,
dev, stg and prod. The options were CI running `helm upgrade`, Argo CD with
Helm, or Argo CD with Kustomize overlays.

## Decision

- **One generic Helm chart**, `deploy/charts/foc-service`: a Deployment, a
  Service, a ConfigMap, and an optional Kafka credentials mount. Each
  service/env pair is a values file.
- **Argo CD** in each cluster syncs `deploy/envs/<env>` with `selfHeal` and
  `prune` on.
- **Images:**
  - CI builds each service **once** per commit and pushes it to the shared
    ECR as `foc/<service>:<git-sha>`, with immutable tags;
  - CI then commits the SHA into `deploy/envs/dev`.
- **Promotion** is a pull request copying the SHA into `envs/stg`, then
  `envs/prod`. **Rollback** is `git revert`.
- **Worker nodes** pull the images using the node IAM role
  (`AmazonEC2ContainerRegistryReadOnly`), so no registry credentials are
  stored.

## Consequences

- Every deploy is a reviewed Git commit, with a full audit trail.
- CI never holds cluster credentials; it only needs ECR push and Git write.
- Adding a service is a new values file, not a new chart.
- Argo CD itself must be installed and upgraded (done by Terraform, see
  ADR-0002).
