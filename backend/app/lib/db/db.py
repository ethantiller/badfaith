from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool

from backend.app.lib.db.db_tables import Base


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
