# Order Service

Backend for Friend on Campus errand requests.

## Profiles

- `application.yml` holds shared settings. The default profile is `local`.
- `application-local.yml` is for a process on your machine. Postgres is `localhost:5432` and Kafka is `localhost:9092`.
- `application-dev.yml` is for the app container. Database, Kafka, and photo settings are read from the environment, not from the file. Copy `.env.example` to `.env` in this directory before Compose starts. `.env` is git-ignored.

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

Open `rest/` in Bruno and select the `local` environment. Each folder has a successful call and a request for each rejected condition. `13 flow` walks one order from create through acknowledge.

Kafka messages the service publishes show up in `docker compose logs -f kafka-consumer`. To send a default message:

```powershell
docker compose exec kafka-tools bash /defaults/send.sh admin.review.started
docker compose exec kafka-tools bash /defaults/send.sh admin.case.resolved <order-uuid>
```

`kafka/messages/` holds the default payloads. `send.sh` fills a new `eventId` and replaces the sample order id when you pass one.

Create and cancel call Credit Service (`POST /api/v1/credit/reserve` and `POST /api/v1/credit/release`). Pickup and dropoff ids are Supplier Service numeric ids; only `approved` suppliers are accepted (`GET /api/v1/supplier/{id}`). The `local` profile calls User Service at `http://localhost:8080`, Credit Service at `http://localhost:3000`, and Supplier Service at `http://localhost:8081`. Deployed environments override those with `USER_SERVICE_URL`, `CREDIT_SERVICE_URL`, `SUPPLIER_SERVICE_URL`, `RATING_SERVICE_URL`, and `ADMIN_SERVICE_URL`.

The API gateway sends the user id in `X-User-Id`. `X-User-Telegram` is optional. Bruno sends those headers directly. Courier ratings and requester escalations still use local stand-ins, because Rating Service and Admin Service are not in this repository. User Service has no lookup by user id, so the order service does not call it yet.

## Images

- `Dockerfile` builds the deployable app image. It does not contain Postgres, Kafka, or SonarQube.
- `Dockerfile.local` is a local SonarQube server only.

```powershell
docker compose -f compose.local.yaml up -d
.\analyze.ps1
```

Start SonarQube with Docker. `analyze.ps1` only reruns the scan, and it reads the token already saved in `.sonar/token`. SonarQube is at [http://localhost:9000](http://localhost:9000).
