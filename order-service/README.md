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

Until the other services exist, `order.clients.mode` is `stub`. The API gateway is expected to decode the JWT and send `X-User-Id`, `X-User-Email`, and `X-User-Telegram`. Bruno sends those headers directly. Approved pickup and dropoff ids are `annas`, `nus-coop`, `printer-com2`, `cool-spot`, `instachef`, and `robot-cafe`.

## Images

- `Dockerfile` builds the deployable app image. It does not contain Postgres, Kafka, or SonarQube.
- `Dockerfile.local` is a local SonarQube server only.

```powershell
docker compose -f compose.local.yaml up -d
.\analyze.ps1
```

Start SonarQube with Docker. `analyze.ps1` only reruns the scan, and it reads the token already saved in `.sonar/token`. SonarQube is at [http://localhost:9000](http://localhost:9000). Log in as `admin` / `admin`.
