---
name: Admin Service Plan
overview: Implement the Friend on Campus admin-service backend in FastAPI, inside admin-service only. Owns conflict cases, moderation queues, audit logs, Kafka producer events, and durable AI/deadline jobs. User and order records stay in their services.
todos:
  - id: scaffold
    content: Scaffold FastAPI app, Postgres/SQLAlchemy, Alembic, Kafka producer, APScheduler, health, Dockerfile, and compose
    status: completed
  - id: users-f1
    content: Admin user search/promote/demote/suspend/reinstate via User Service, with audit and Kafka fan-out
    status: completed
  - id: conflicts-f3
    content: Conflict intake, AI evaluation, claim/under_review, resolve (manual + deadline auto), evidence photos, timers
    status: completed
  - id: moderation
    content: User reports and suspension appeals intake, advisory AI, dismiss/reject/reassess flows
    status: completed
  - id: hardening
    content: Gateway 404-not-403 auth, internal mesh-only intake paths, tests, schema docs, ops cleanup script
    status: completed
isProject: false
---

# Admin Service — requirements and implementation plan

Scope is only [`admin-service/`](../admin-service/), backend only. Do not
implement user, order, credit, supplier, rating, badges, or UI code. Those
appear only as HTTP calls or Kafka messages this service sends or consumes.

## Already decided by author (Sahana Avantika)

- **Stack:** Python 3.11, FastAPI, async SQLAlchemy, Alembic, aiokafka,
  APScheduler (SQLAlchemy job store), Postgres.
- **Conflict state machine:** `created` → `ai_evaluated` | `ai_failed` →
  `under_review` → `resolved`. One case per `order_id`.
- **Fault party:** `requester` | `courier` | `no-fault` (shared with Order /
  Badges Kafka payloads).
- **Resolve path:** single conditional UPDATE in
  `conflict_resolution.resolve` (manual from `under_review`; auto from AI
  verdict + confidence at deadline). Then publish `admin.case.resolved`.
- **Kafka:** Admin produces flat `foc.admin.events` for Order
  (`admin.review.started`, `admin.case.resolved`) plus enveloped user
  promote/demote/suspend/reinstate events. Intake from Order/User is HTTP,
  not Kafka commands.
- **Schema:** `conflict_cases`, append-only `audit_logs`, `user_reports`,
  `suspension_appeals`. External ids stored as strings; no FK into User/Order
  databases.
- **AI:** Gemini Flash advisory fault / report / appeal recommendations;
  evidence fetched from Order’s photo bucket; failures leave `ai_failed`
  without blocking admin review.
- **Timers:** durable reminder + deadline auto-resolve jobs; AI eval jobs at
  case/report/appeal creation.
- **Auth:** gateway identity headers; missing/non-admin → **404** not 403.
  Internal intake under `/api/v1/admin/internal/*` (mesh-gated).
- **Moderation:** reports and appeals queues with advisory AI, dismiss /
  reject / reinstate close-coupling to User Service status changes.

## What Cursor (Auto) may implement under that design

Scaffold, routers, services, models, schemas, jobs, tests, Docker/compose,
config, docs wording, and ops scripts — without inventing new product
requirements or changing service boundaries.

Alembic revision **files are not given in-file headers** (checksum / deploy
safety); see
[`admin-service/alembic/versions/AI_ASSISTANCE.md`](../admin-service/alembic/versions/AI_ASSISTANCE.md).
