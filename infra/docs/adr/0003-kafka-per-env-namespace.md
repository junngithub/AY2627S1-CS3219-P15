# ADR-0003: Kafka on Strimzi, one Kafka cluster inside each env namespace

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

The event catalog (API contract) defines 7 topics (`foc.*`), keyed by order
ID. Options were Amazon MSK (provisioned or serverless), Strimzi in EKS, or,
locally, Floci's MSK emulation (backed by Redpanda).

## Decision

- Run Kafka with **Strimzi** (KRaft mode) in every env, including local, so
  every env runs the same Kafka.
- One Strimzi operator per cluster. In non-prod it watches both `foc-dev` and
  `foc-stg`.
- Each env gets its **own `Kafka` cluster, in the app namespace** (`foc`,
  `foc-dev`, `foc-stg`):

  | Env | Brokers | RF | `min.insync.replicas` |
  |---|---|---|---|
  | local, dev, stg | 1 | 1 | 1 |
  | prod | 3 | 3 | 2 |

- Topics are declared as `KafkaTopic` CRs in Git (`deploy/charts/foc-kafka/`).
- Floci's MSK is **not** used.

## Consequences

- Services use the short address `kafka-kafka-bootstrap:9093` in every env,
  because DNS resolves within the pod's namespace. There's no per-env Kafka
  config.
- dev events can't leak to stg consumers.
- We operate Kafka ourselves (upgrades, storage). The Strimzi operator
  automates most of it.
- Cheaper than MSK. MSK Serverless would also force IAM auth on clients.
