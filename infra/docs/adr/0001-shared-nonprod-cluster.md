# ADR-0001: dev and stg share one non-prod cluster; prod is dedicated

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

We need dev, stg and prod on AWS. Each EKS control plane costs about US$73/month
before nodes. Options: a cluster per env, one shared non-prod cluster with a
namespace per env, or everything always on.

The SFEIR guide on multi-environment Kubernetes recommends namespaces for
non-production and dedicated clusters for production
(<https://institute.sfeir.com/en/kubernetes-training/management-multi-environment-kubernetes-strategies/>).

## Decision

- **non-prod EKS cluster** hosts namespaces `foc-dev` and `foc-stg`.
- **prod EKS cluster** hosts namespace `foc`.
- In the shared cluster, every env namespace gets:
  - a default-deny `NetworkPolicy` for traffic from other namespaces;
  - a `ResourceQuota` and `LimitRange`;
  - its own Secrets (never shared credentials);
  - its own Kafka cluster (see ADR-0003).

## Consequences

- Two control planes instead of three (about US$73/month saved).
- prod is fully isolated: a bad dev change can't affect it.
- dev and stg share nodes and the Strimzi operator. A noisy dev can still
  cause node pressure, which quotas limit but don't remove.
- Cluster-wide upgrades (Kubernetes version, operator version) hit dev and
  stg together. prod is upgraded separately, after non-prod.
