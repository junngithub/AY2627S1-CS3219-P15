# ADR-0006: Floci as the local AWS environment

- **Status:** Accepted (spike passed 2026-09-29)
- **Date:** 2026-09-29

## Context

Developers need a local environment that exercises the same Terraform
modules, ECR push/pull flow and Kubernetes setup as the cloud, without an AWS
account or cost.

## Decision

- Use **Floci** (<https://github.com/floci-io/floci>, MIT, `localhost:4566`) as
  local AWS.
- `infra/local` is declared the same way as `nonprod`/`prod` (same resource
  types, the shared `modules/argocd`), with AWS provider `endpoints` pointed at
  Floci. It uses the same region as the cloud, `ap-southeast-1`.
- Use Floci **EKS** (a real k3s cluster) and **ECR** (a real `registry:2`).
- **Don't** use Floci MSK (Redpanda). Strimzi runs inside k3s instead
  (ADR-0003).

## Consequences

- One set of modules and manifests for every env.
- Floci EKS add-ons are metadata only (k3s provides DNS and networking), and
  Pod Identity needs `FLOCI_TLS_ENABLED=true`.
- Spike (2026-09-29) confirmed that k3s pulls from Floci ECR. Floci injects
  a registry mirror into k3s automatically.
- kubectl needs a token signed by a real IAM user key that exists in Floci,
  not `test`/`test`. `infra/local` Terraform creates that user.
- No Argo CD locally ([ADR-0009](0009-no-argocd-locally.md)):
  `deploy/local.sh` installs the charts with Helm.
- Details: [`../local-floci.md`](../local-floci.md#spike-results-2026-09-29).
