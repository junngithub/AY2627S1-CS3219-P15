# ADR-0004: Per-service Kafka identity (SCRAM) with ACLs from the event catalog

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

With a plain listener, any pod that can reach Kafka can read or write any
topic. `foc.credit.commands` moves credits, so a buggy or compromised service
publishing to it could transfer money.

## Decision

- Kafka exposes a **TLS listener on 9093 with SCRAM-SHA-512** authentication
  and `simple` authorization.
- Each service that uses Kafka gets a `KafkaUser`. Strimzi generates its
  password Secret, and the chart mounts it as `KAFKA_USERNAME` /
  `KAFKA_PASSWORD`.
- ACLs mirror the canonical event catalog exactly:

  | KafkaUser | Write | Read |
  |---|---|---|
  | `user` | `foc.user.status` | |
  | `credit` | | `foc.user.status`, `foc.credit.commands` |
  | `order` | `foc.order.status`, `foc.credit.commands`, `foc.rating.commands`, `foc.admin.commands` | `foc.admin.events` |
  | `rating` | `foc.user.rating` | `foc.rating.commands` |
  | `admin` | `foc.admin.events` | `foc.admin.commands` |

- Consumers also get `Read` on their own consumer group (`<service>-*`).
- `supplier` and `badges` use no topics, so they get no `KafkaUser`.
- `foc.order.status` and `foc.user.rating` have no consumer yet. A future
  consumer is added by granting `Read` in its `KafkaUser`.

## Consequences

- A service can only publish what the contract says it publishes.
- Changing the event catalog means updating this table and the `KafkaUser`
  YAML in the same PR.
- Local, dev, stg and prod behave identically (same Strimzi config).
