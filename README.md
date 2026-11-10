# CS3219 — Software Design and Architecture (AY2627 Sem 1)

## Friend on Campus (FoC)

**Friend on Campus (FoC)** is a peer-to-peer campus errand platform where
students can request items to be collected from stores or facilities on
campus, and other students can fulfil (and deliver) those requests. The
platform runs on a closed credit economy — credits cannot be bought,
withdrawn, or exchanged for money, and only circulate within the platform.

---

## Team Members

| Name | Role |
| ----- | ----- |
| Your Name | Your ownership |
| Your Name | Your ownership |
| Your Name | Your ownership |
| Your Name | Your ownership |
| Your Name | Your ownership |

---

## Repository Structure

This repository follows a **one-service-per-folder** structure: each
microservice (`user-service/`, `supplier-service/`, `order-service/`,
`credit-service/`) lives in its own top-level folder.

```text
.
├── user-service/
├── supplier-service/
├── order-service/
├── credit-service/
├── <n2h-service>/
└── README.md
```

- Any **nice-to-have (N2H)** feature that warrants its own service should
  be added as an **additional folder** at the same level, following the
  same per-service structure.
- Files for agentic coding tools (e.g. agent configs, prompts, skills)
  may be added as needed, but must still **respect the
  one-service-per-folder skeleton** for core implementation.

---

## AI Use Summary

**Tools:** Cursor (Auto)

**Prohibited phases avoided:** requirements elicitation and prioritization;
architecture and design decisions (service boundaries, order state machine,
Kafka transactional outbox, schemas and interfaces, load-test profile and
capacity approach, admin conflict/moderation design); idea generation for
product features; drafting of decision rationales and trade-off
justifications. Those were done by the authors. For Order Service and Load
test, **Varun Sivakumar** owns those decisions. For Admin Service,
**Sahana Avantika** owns those decisions. Cursor plans under
[`ai/plans/`](ai/plans/) are author design notes reworded for execution, not
AI-originated architecture.

**Used for:**

- Generating and editing implementation code and unit/integration tests once
  requirements and architecture were fixed
- Boilerplate (config, scaffolding, repetitive glue)
- Debugging assistance (errors, test failures, deploy/load issues)
- Refactoring and documentation wording

**Verification:** AI outputs for Order Service and Load test were reviewed,
edited where needed, and tested by **Varun Sivakumar**. AI outputs for Admin
Service were reviewed, edited where needed, and tested by **Sahana Avantika**.
Each generated the ideas and designed the implementation for their services.
The team remains accountable for correctness, security, and licensing.

**Prompts / key exchanges:** see [`ai/usage-log.md`](ai/usage-log.md).
Author design plans: [`ai/plans/`](ai/plans/).

### Order Service

**Owner:** Varun Sivakumar

Varun Sivakumar defined Order Service requirements and architecture (state
machine, outbox, HTTP/Kafka contracts, schema, proximity approach, photo
rules, deadlines, alerts). Cursor (Auto) assisted with implementation code,
tests, config/Docker, and documentation under that design. Per-file
`AI Assistance Disclosure` headers are on Java sources, application config,
Docker/compose, scripts, and design docs.

Flyway SQL migrations are **not** edited with in-file headers (checksum /
deploy safety). Collection disclosure:
[`order-service/src/main/resources/db/migration/AI_ASSISTANCE.md`](order-service/src/main/resources/db/migration/AI_ASSISTANCE.md).
Bruno collection disclosure:
[`order-service/bruno/AI_ASSISTANCE.md`](order-service/bruno/AI_ASSISTANCE.md).

Plan: [`ai/plans/order_service_plan.md`](ai/plans/order_service_plan.md).
Usage log: [`ai/usage-log.md`](ai/usage-log.md).

### Admin Service

**Owner:** Sahana Avantika

Sahana Avantika defined Admin Service requirements and architecture (conflict
state machine, HTTP/Kafka contracts, schema, AI evaluation and auto-resolve,
claim/review, moderation reports/appeals, append-only audit, gateway auth,
durable timers, evidence photo fetch). Cursor (Auto) assisted with
implementation code, tests, config/Docker, and documentation under that
design. Per-file `AI Assistance Disclosure` headers are on Python sources,
application config, Docker/compose, scripts, and design docs.

Alembic revision files are **not** edited with in-file headers (checksum /
deploy safety). Collection disclosure:
[`admin-service/alembic/versions/AI_ASSISTANCE.md`](admin-service/alembic/versions/AI_ASSISTANCE.md).

Plan: [`ai/plans/admin_service_plan.md`](ai/plans/admin_service_plan.md).
Usage log: [`ai/usage-log.md`](ai/usage-log.md).

### Load test

**Owner:** Varun Sivakumar

Varun Sivakumar designed the dual-role peak/soak load profile, seeding
approach, capacity/scale-up story, and evidence expectations. Cursor (Auto)
implemented and edited the k6 script and related docs under that design
(`load-test/k6/load.js` has an in-file header). Helm chart files and seed
scripts were Auto-**edited** with possibly mixed origin; folder disclosure:
[`load-test/AI_ASSISTANCE.md`](load-test/AI_ASSISTANCE.md).

Plan: [`ai/plans/fix_order_loadtest.md`](ai/plans/fix_order_loadtest.md).
Usage log: [`ai/usage-log.md`](ai/usage-log.md).
