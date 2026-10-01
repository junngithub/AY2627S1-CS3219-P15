# ADR-0009: No Argo CD in the local environment; Helm from the working copy

- **Status:** Accepted
- **Date:** 2026-10-01
- **Amends:** ADR-0005 and ADR-0008 (Argo CD now runs in the cloud clusters only)

## Context

Local Argo CD reads **pushed Git**, not the working copy. Seeing any
`deploy/` change on a laptop meant commit → push → wait for a sync (about
3 minutes). Following a feature branch also needed extra plumbing (a
Kustomize patch to pass the branch to every ApplicationSet). Argo CD also
costs about 1 GiB of memory, plus a second Terraform layer (`bootstrap/`),
the root Application, and a login.

What local Argo CD uniquely tests is the Argo layer itself
(`deploy/argocd/*.yaml`: ApplicationSets, AppProjects, retry-based
ordering). That layer changes rarely, and dev exists to exercise it.
Everything else (the charts and values) renders the same whether Argo CD or
Helm applies it.

## Decision

- **Local:** `deploy/local.sh` installs the same charts with the same values
  straight from the working copy using Helm, in dependency order:
  1. namespace;
  2. Strimzi CRDs (server-side apply) and the operator;
  3. Kafka, waiting until it and its topics and users are Ready;
  4. one release per `values/envs/local/services/*.yaml`.

  Releases whose values file was deleted are uninstalled, matching Argo CD's
  prune.
- **Local Terraform** is just `infra/local/aws`. The `infra/local/bootstrap`
  layer and `deploy/argocd/local.yaml` are removed.
- **nonprod and prod** keep Argo CD exactly as in ADR-0005 and ADR-0008
  (`modules/argocd` with the root Application, `deploy/argocd/{nonprod,prod}.yaml`).

## Consequences

- A `deploy/` change is visible locally in seconds, with no push and no branch
  handling.
- Local has no drift correction (self-heal). A manual `kubectl` change stays
  until the next `local.sh` run.
- The Argo CD layer (`deploy/argocd/`, `modules/argocd` root app) is first
  exercised in **dev**. Mistakes there show up in dev, not on a laptop.
- Local needs `helm` installed (it previously came with Terraform's provider).
