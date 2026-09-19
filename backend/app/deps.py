import hashlib
from typing import AsyncGenerator
from uuid import UUID

from fastapi import Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.db import Database

db: Database | None = None


def set_db(database: Database | None) -> None:
    global db
    db = database


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    if db is None:
        raise RuntimeError("Database not initialized")
    async for session in db.get_session():
        yield session


def extract_user_id(token: str) -> UUID:
    """
    Extract user ID from token. Currently generates a deterministic UUID from the token.
    TODO: Replace with real Supabase JWT verification.
    """
    hash_digest = hashlib.sha256(token.encode()).digest()
    return UUID(bytes=hash_digest[:16])


def get_current_user(authorization: str = Header(...)) -> UUID:
    """Extract user ID from Authorization header (Bearer <token>)."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Invalid authorization header. Expected 'Bearer <token>'.",
        )
    token = authorization[7:]  # Remove "Bearer " prefix
    return extract_user_id(token)
