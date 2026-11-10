# AI Assistance Disclosure
# Tool: Cursor (Auto), date: 2026-11-09
# Scope: Implementation assistance for Admin Service under author-fixed requirements and architecture.
# Author review: Sahana Avantika generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.routers import conflicts, moderation, users
from app.services import kafka_consumer, kafka_producer, scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    await kafka_producer.start_producer()
    await kafka_consumer.start_consumer()
    scheduler.start()
    yield
    await kafka_consumer.stop_consumer()
    await kafka_producer.stop_producer()
    scheduler.scheduler.shutdown()


app = FastAPI(title="Admin Service", lifespan=lifespan)

app.include_router(users.router)
app.include_router(conflicts.router)
app.include_router(conflicts.internal)
app.include_router(moderation.reports)
app.include_router(moderation.appeals)
app.include_router(moderation.internal_reports)
app.include_router(moderation.internal_appeals)


@app.get("/health")
async def health():
    return {"status": "ok"}
