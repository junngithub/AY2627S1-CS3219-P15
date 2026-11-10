# AI Assistance Disclosure
# Tool: Cursor (Auto), date: 2026-11-09
# Scope: Implementation assistance for Admin Service under author-fixed requirements and architecture.
# Author review: Sahana Avantika generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.async_database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with SessionLocal() as session:
        yield session
