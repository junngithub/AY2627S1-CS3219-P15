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
app.include_router(moderation.reports)
app.include_router(moderation.appeals)


@app.get("/health")
async def health():
    return {"status": "ok"}
