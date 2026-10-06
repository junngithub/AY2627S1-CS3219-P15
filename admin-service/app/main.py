from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.routers import conflicts, users
from app.services import kafka_producer, scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    await kafka_producer.start_producer()
    scheduler.start()
    yield
    await kafka_producer.stop_producer()
    scheduler.scheduler.shutdown()


app = FastAPI(title="Admin Service", lifespan=lifespan)

app.include_router(users.router)
app.include_router(conflicts.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
