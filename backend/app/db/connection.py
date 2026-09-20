from __future__ import annotations

import asyncio
from typing import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool

from backend.app.config import Settings, get_settings
from backend.app.db.models import Base


def create_database_from_env(settings: Settings | None = None) -> Database | None:
    settings = settings or get_settings()
    if not settings.DATABASE_INSTANCE_STRING:
        return None
    return Database(normalize_database_url(settings.DATABASE_INSTANCE_STRING))


def normalize_database_url(database_url: str) -> str:
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if database_url.startswith("postgres://"):
        return database_url.replace("postgres://", "postgresql+asyncpg://", 1)
    return database_url


class Database:
    def __init__(self, db_url: str):
        self.db_url = db_url
        self.engine = None
        self.async_session_maker = None

    def init(self):
        self.engine = create_async_engine(
            self.db_url,
            echo=False,
            pool_pre_ping=True,
            poolclass=NullPool,
        )
        self.async_session_maker = async_sessionmaker(
            self.engine, class_=AsyncSession, expire_on_commit=False
        )

    async def connect(self, retries: int = 3, retry_delay_seconds: float = 1.0) -> None:
        if retries < 1:
            raise ValueError("Database connection retries must be at least 1.")

        last_error: Exception | None = None

        for attempt in range(1, retries + 1):
            try:
                self.init()
                async with self.engine.connect() as conn:
                    await conn.execute(text("SELECT 1"))
                return
            except Exception as exc:
                last_error = exc
                await self.close()
                if attempt == retries:
                    break
                await asyncio.sleep(retry_delay_seconds)

        raise RuntimeError(
            f"Could not connect to database after {retries} attempts."
        ) from last_error

    async def close(self):
        if self.engine:
            await self.engine.dispose()

    async def get_session(self) -> AsyncGenerator[AsyncSession, None]:
        if self.async_session_maker is None:
            raise RuntimeError("Database not initialized. Call init() first.")
        async with self.async_session_maker() as session:
            yield session

    async def create_all(self):
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    async def drop_all(self):
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
