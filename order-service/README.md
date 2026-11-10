# Order Service

Backend for Friend on Campus errand requests.

Design notes are in [`docs/`](docs/README.md): state diagram, sequence diagrams, database schema, and the HTTP and Kafka interfaces.

## Profiles

- `application.yml` holds shared settings. The default profile is `local`.
- `application-local.yml` is for a process on your machine. Postgres is `localhost:5432` and Kafka is `localhost:9092`.
- `application-dev.yml` is for the app container. Database, Kafka, and photo settings are read from the environment, not from the file. Copy `.env.example` to `.env` in this directory before Compose starts. `.env` is git-ignored.
- `application-k8s.yml` is for the Kubernetes deploy; `deploy/values/services/order.yaml` sets `SPRING_PROFILES_ACTIVE=k8s`. The database comes from the `PG*` keys of Secret `order-db`, Kafka from the platform's `KAFKA_*` variables (TLS listener with SCRAM-SHA-512), and photos stay on the pod's disk in `/app/photos`. Health is also served at `/health`, like every FoC service.

```powershell
copy .env.example .env
docker compose up --build
```

That starts Postgres, Kafka, MinIO, Kafka UI, a Kafka consumer, and the app with `SPRING_PROFILES_ACTIVE=dev`.

- API: [http://localhost:8083](http://localhost:8083)
- Swagger: [http://localhost:8083/swagger-ui.html](http://localhost:8083/swagger-ui.html)
- Kafka UI: [http://localhost:8184](http://localhost:8184)
- MinIO console: [http://localhost:9101](http://localhost:9101) (the photo access key and secret in `.env`)

The dev profile stores photos in the `order-photos` bucket. MinIO is the local S3 stand-in. The `local` profile keeps photos on disk in `./data/photos`.

From an IDE, start Compose, then run the app with the `local` profile.

Open `bruno/` in Bruno and select the `local` environment. Each folder has a successful call and a request for each rejected condition. `13 flow` walks one order from create through acknowledge.

Kafka messages the service publishes show up in `docker compose logs -f kafka-consumer`. To send a default message:

```powershell
docker compose exec kafka-tools bash /defaults/send.sh admin.review.started
docker compose exec kafka-tools bash /defaults/send.sh admin.case.resolved <order-uuid>
```

`kafka/messages/` holds the default payloads. `send.sh` fills a new `eventId` and replaces the sample order id when you pass one.

Create and cancel call Credit Service (`POST /api/v1/credit/internal/reserve` and `POST /api/v1/credit/internal/release`, internal-only: blocked at the gateway). Pickup ids are Supplier Service numeric ids (`approved` only via `GET /api/v1/supplier/{id}`). Dropoff is Order-owned (`delivery_point` catalogue / my-locations); see `docs/delivery-points.md`. Create and accept snapshot the caller's rating from `GET /api/v1/rating/{userId}` (`average` may be null when the user has no ratings yet). The `local` profile calls User Service at `http://localhost:8080`, Credit Service at `http://localhost:3000`, Supplier Service at `http://localhost:8081`, Rating Service at `http://localhost:8085`, and Admin Service at `http://localhost:8084`. Deployed environments override those with `USER_SERVICE_URL`, `CREDIT_SERVICE_URL`, `SUPPLIER_SERVICE_URL`, `RATING_SERVICE_URL`, and `ADMIN_SERVICE_URL`. Create and accept look up the caller's Telegram handle with `GET /api/v1/user/internal/users/{userId}/telegram`. User Service no longer requires a service token on that call.

The API gateway sends `X-User-Id` and `X-Permitted-Action`. Every order endpoint accepts the call only when `X-Permitted-Action` is `true`. Bruno sends those headers directly. Requester escalation and a missed delivery deadline call Admin Service at `POST /api/v1/admin/conflicts`.

## Images

- `Dockerfile` builds the deployable app image. It does not contain Postgres, Kafka, or SonarQube.
- `Dockerfile.local` is a local SonarQube server only.

```powershell
docker compose -f compose.local.yaml up -d
.\analyze.ps1
```

Start SonarQube with Docker. `analyze.ps1` only reruns the scan, and it reads the token already saved in `.sonar/token`. SonarQube is at [http://localhost:9000](http://localhost:9000).

## AI Use Summary

**Tools:** Cursor (Auto)

**Prohibited phases avoided:** requirements elicitation and prioritization;
architecture and design decisions (service boundaries, order state machine,
Kafka transactional outbox, schemas and interfaces, load-test profile and
capacity approach); idea generation for product features; drafting of
decision rationales and trade-off justifications. Those were done by the
authors. For Order Service and Load test, **Varun Sivakumar** owns those
decisions. Cursor plans under [`../ai/plans/`](../ai/plans/) are his design
notes reworded for execution, not AI-originated architecture.

**Used for:**

- Generating and editing implementation code and unit/integration tests once
  requirements and architecture were fixed
- Boilerplate (config, scaffolding, repetitive glue)
- Debugging assistance (errors, test failures, deploy/load issues)
- Refactoring and documentation wording

**Verification:** All AI outputs for Order Service and Load test were
reviewed, edited where needed, and tested by **Varun Sivakumar**, who
generated the ideas and designed the implementation. The team remains
accountable for correctness, security, and licensing.

**Prompts / key exchanges:** see [`../ai/usage-log.md`](../ai/usage-log.md).
Author design plans: [`../ai/plans/`](../ai/plans/).

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
[`src/main/resources/db/migration/AI_ASSISTANCE.md`](src/main/resources/db/migration/AI_ASSISTANCE.md).
Bruno collection disclosure:
[`bruno/AI_ASSISTANCE.md`](bruno/AI_ASSISTANCE.md).

Plan: [`../ai/plans/order_service_plan.md`](../ai/plans/order_service_plan.md).
Usage log: [`../ai/usage-log.md`](../ai/usage-log.md).
