# AI Assistance Disclosure
# Tool: Cursor (Auto), date: 2026-11-09
# Scope: Boilerplate/config assistance for Admin Service under author-fixed requirements and architecture.
# Author review: Sahana Avantika generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.

FROM python:3.11-slim AS base

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# ---- Migrate stage ----
# Used only by the migration Job (deploy/charts/foc-service/templates/migrate-job.yaml,
# ADR-0011): applies the Alembic migrations, then exits.
FROM base AS migrate
CMD ["alembic", "upgrade", "head"]

# ---- Runtime stage ----
# Last, so a plain `docker build` (and docker compose) builds the app.
FROM base AS runtime

EXPOSE 8084

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8084"]
